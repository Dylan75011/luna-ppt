// Brain Agent：ReAct 循环（Reason → Act → Observe → Reason...）
const { callMinimaxWithToolsStream } = require('../services/llmClients');
const { TOOL_DEFINITIONS, executeTool, getToolDisplay } = require('../services/toolRegistry');
const { analyzeAgentImages } = require('../services/visionMcp');
const { buildBrainSystemPrompt } = require('../prompts/brain');
const wm = require('../services/workspaceManager');

const MAX_TURNS = 15;

// 单条工具结果最大保留字符数（约 250 token）
const TOOL_RESULT_MAX_CHARS = 1000;
// 估算 token 数（中英混合约 0.4 token/字符）
function estimateTokens(text) {
  return Math.ceil((text || '').length * 0.4);
}
// 整体对话历史 token 警戒线（超过时截断早期工具结果）
const CONTEXT_TOKEN_WARN = 10000;

/**
 * 流式输出中实时过滤 <think>...</think> 块
 * 保留 7 个字符的缓冲区以处理跨 chunk 的标签边界
 */
class ThinkFilter {
  constructor() {
    this.buf = '';
    this.inThink = false;
  }

  push(delta) {
    this.buf += delta;
    let out = '';

    while (this.buf.length > 0) {
      if (this.inThink) {
        const end = this.buf.indexOf('</think>');
        if (end !== -1) {
          this.buf = this.buf.slice(end + 8);
          this.inThink = false;
        } else {
          // 仍在 think 块内，保留末尾以防 </think> 被截断
          if (this.buf.length > 50) this.buf = this.buf.slice(-9);
          break;
        }
      } else {
        const start = this.buf.indexOf('<think>');
        if (start !== -1) {
          out += this.buf.slice(0, start);
          this.buf = this.buf.slice(start + 7);
          this.inThink = true;
        } else {
          // 无 think 块 — 安全输出，末尾保留 6 字符防截断
          const safe = this.buf.length > 7 ? this.buf.slice(0, -7) : '';
          out += safe;
          this.buf = this.buf.slice(safe.length);
          break;
        }
      }
    }
    return out;
  }

  flush() {
    // 流结束，输出剩余缓冲
    const remaining = this.buf;
    const wasInThink = this.inThink;
    this.buf = '';
    this.inThink = false;
    // 若仍在 think 块内（标签未关闭），buffer 内容是思考过程，直接丢弃
    if (wasInThink) return '';
    return remaining.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }
}

function isStopRequested(session) {
  return !!session?.stopRequested;
}

function isInternalThinking(text) {
  if (!text || typeof text !== 'string') return false;
  
  const trimmedText = text.trim();
  
  if (trimmedText.startsWith('<think>') || trimmedText.includes('</think>')) {
    return true;
  }
  
  const internalPatterns = [
    /^(让我想想|我先思考|我思考一下|我来分析一下)/,
    /^步骤[是为：:]/,
    /^计划如下/,
    /^首先[，,]/,
    /^(根据|按照).*规则/,
    /^(用户只提供了|已知条件是)/
  ];
  
  if (internalPatterns.some(pattern => pattern.test(trimmedText))) {
    return true;
  }
  
  return false;
}

function stripThinkingBlocks(text) {
  const startTag = '<think>';
  const endTag = '</think>';
  let result = '';
  let current = text;
  while (true) {
    const startIdx = current.indexOf(startTag);
    if (startIdx === -1) {
      result += current;
      break;
    }
    result += current.slice(0, startIdx);
    const endIdx = current.indexOf(endTag, startIdx + startTag.length);
    if (endIdx === -1) {
      break;
    }
    current = current.slice(endIdx + endTag.length);
  }
  return result.trim();
}

function buildMessages(session) {
  const systemPrompt = buildBrainSystemPrompt(session.spaceContext || null);

  // 第一步：对每条 tool 消息的 content 做截断，防止搜索/抓取结果撑爆 token
  const trimmed = session.messages.map((message) => {
    const next = {
      role: message.role,
      content: message.content
    };
    if (message.tool_calls)   next.tool_calls   = message.tool_calls;
    if (message.tool_call_id) next.tool_call_id = message.tool_call_id;

    if (message.role === 'tool' && typeof message.content === 'string'
        && message.content.length > TOOL_RESULT_MAX_CHARS) {
      next.content = message.content.slice(0, TOOL_RESULT_MAX_CHARS) + '\n...[结果已截断]';
    }
    return next;
  });

  // 第二步：估算总 token，超出警戒线时删除最早的工具往返（user→assistant+tool_calls→tool）
  const totalTokens = estimateTokens(systemPrompt)
    + trimmed.reduce((sum, m) => sum + estimateTokens(JSON.stringify(m)), 0);

  if (totalTokens > CONTEXT_TOKEN_WARN && trimmed.length > 6) {
    // 保留最近 6 条，其余只保留 user/assistant 文字，丢弃 tool 结果
    const recent = trimmed.slice(-6);
    const older  = trimmed.slice(0, -6).filter(m => m.role !== 'tool').map(m => {
      if (m.role === 'assistant' && m.tool_calls) {
        // assistant 只保留文字部分，去掉 tool_calls
        return { role: 'assistant', content: m.content || '[工具调用，已归档]' };
      }
      return m;
    });
    return [{ role: 'system', content: systemPrompt }, ...older, ...recent];
  }

  return [{ role: 'system', content: systemPrompt }, ...trimmed];
}

function canCallBuildPpt(session) {
  return !!session?.bestPlan && !!session?.userInput;
}

function toPublicAttachments(attachments = []) {
  return attachments.map((item) => ({
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    size: item.size,
    url: item.url,
    analysis: item.analysis || '',
    error: item.error || ''
  }));
}

function appendSessionAttachments(session, attachments = []) {
  if (!attachments.length) return;
  const existing = Array.isArray(session.attachments) ? session.attachments : [];
  const next = [...existing];
  attachments.forEach((item) => {
    if (!next.find((entry) => entry.id === item.id)) {
      next.push({ ...item });
    }
  });
  session.attachments = next;
}

function buildImageContextBlock(attachments = []) {
  const usable = attachments.filter((item) => item.analysis || item.error);
  if (!usable.length) return '';

  return [
    '以下是用户本轮上传图片，已通过 MiniMax MCP understand_image 分析，可视为用户提供的视觉上下文：',
    ...usable.map((item, index) => {
      if (item.analysis) {
        return `[图片${index + 1}：${item.name || '未命名图片'}]\n${item.analysis}`;
      }
      return `[图片${index + 1}：${item.name || '未命名图片'}]\n分析失败：${item.error}`;
    })
  ].join('\n\n');
}

// 单份文档注入的最大字符数（约 2000 token）
const DOC_TEXT_MAX_CHARS = 8000;

function buildDocumentContextBlock(documents = []) {
  if (!documents || !documents.length) return '';

  const parts = documents.map((doc, index) => {
    if (doc.error) {
      return `[文档${index + 1}：${doc.name}]\n解析失败：${doc.error}`;
    }
    const pageInfo = doc.pages ? `，共 ${doc.pages} 页` : '';
    const truncated = doc.text.length > DOC_TEXT_MAX_CHARS;
    const text = truncated ? doc.text.slice(0, DOC_TEXT_MAX_CHARS) + '\n...[内容已截断，仅展示前段]' : doc.text;
    return `[文档${index + 1}：${doc.name}${pageInfo}]\n${text}`;
  });

  return [
    '以下是用户上传的文档内容，请结合这些文档完成任务：',
    ...parts
  ].join('\n\n---\n\n');
}

function buildWorkspaceDocContextBlock(workspaceDocs = []) {
  if (!workspaceDocs || !workspaceDocs.length) return '';
  const parts = workspaceDocs.map((doc, index) =>
    `[空间文档${index + 1}：${doc.name}（${doc.docType === 'ppt' ? 'PPT' : '文档'}）]\n${doc.text || '（内容为空）'}`
  );
  return [
    '以下是用户从工作空间中引用的文档，作为本次任务的背景上下文：',
    ...parts
  ].join('\n\n---\n\n');
}

async function prepareUserInputMessage(text, attachments = [], documents = [], session, onEvent, workspaceDocs = []) {
  const normalizedText = String(text || '').trim();
  const parts = [];

  if (attachments.length) {
    onEvent('text', { text: '我先看一下你发来的图片内容。' });
    const analyzedAttachments = await analyzeAgentImages(attachments, {
      minimaxApiKey: session.apiKeys.minimaxApiKey,
      userText: normalizedText
    });
    const imageContext = buildImageContextBlock(analyzedAttachments);
    if (normalizedText) parts.push(normalizedText);
    if (imageContext) parts.push(imageContext);

    const docContext = buildDocumentContextBlock(documents);
    if (docContext) parts.push(docContext);

    const wsContext = buildWorkspaceDocContextBlock(workspaceDocs);
    if (wsContext) parts.push(wsContext);

    return {
      content: parts.join('\n\n') || '用户上传了图片，请结合图片内容理解需求并作答。',
      attachments: toPublicAttachments(analyzedAttachments)
    };
  }

  if (normalizedText) parts.push(normalizedText);

  if (documents.length) {
    parts.push('用户本轮上传了文档。若用户意图是基于这份文档继续完善方案或直接生成 PPT，请优先把文档内容视为当前任务依据。');
    const docContext = buildDocumentContextBlock(documents);
    if (docContext) parts.push(docContext);
  }

  if (workspaceDocs.length) {
    const wsContext = buildWorkspaceDocContextBlock(workspaceDocs);
    if (wsContext) parts.push(wsContext);
  }

  const hasContent = normalizedText || documents.length || workspaceDocs.length;
  return {
    content: parts.join('\n\n') || (hasContent ? '用户引用了文档，请结合文档内容理解需求并作答。' : ''),
    attachments: []
  };
}

/**
 * 收到用户新消息，启动/继续 Brain 循环
 */
async function run(session, userMessage, onEvent, options = {}) {
  // 首次启动时加载空间上下文，注入文档列表
  if (session.spaceId && !session.spaceContext) {
    try {
      session.spaceContext = wm.getSpaceContext(session.spaceId);
    } catch (e) {
      console.warn('[BrainAgent] 获取空间上下文失败:', e.message);
    }
  }

  const prepared = await prepareUserInputMessage(userMessage, options.attachments || [], options.documents || [], session, onEvent, options.workspaceDocs || []);
  appendSessionAttachments(session, prepared.attachments);
  session.messages.push({
    role: 'user',
    content: prepared.content,
    ...(prepared.attachments.length ? { attachments: prepared.attachments } : {})
  });
  session.status = 'running';
  session.stopRequested = false;
  session.doneEmitted = false;
  await runLoop(session, onEvent);
}

/**
 * 用户回答了 ask_user 的问题，恢复循环
 */
async function resume(session, userReply, onEvent, options = {}) {
  const prepared = await prepareUserInputMessage(userReply, options.attachments || [], options.documents || [], session, onEvent, options.workspaceDocs || []);
  appendSessionAttachments(session, prepared.attachments);
  // 把用户回答作为 tool result 补回去
  if (session.pendingToolCallId) {
    session.messages.push({
      role: 'tool',
      tool_call_id: session.pendingToolCallId,
      content: JSON.stringify({
        answer: prepared.content,
        attachments: prepared.attachments
      })
    });
    session.pendingToolCallId = null;
  }
  session.status = 'running';
  session.stopRequested = false;
  session.doneEmitted = false;
  await runLoop(session, onEvent);
}

/**
 * ReAct 主循环
 */
async function runLoop(session, onEvent) {
  const loopTracker = {}; // "toolName:argsHash" → 调用次数

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (isStopRequested(session)) {
      session.status = 'idle';
      return;
    }

    // 推送 thinking 事件
    onEvent('thinking', {});

    let choice;
    try {
      const filter = new ThinkFilter();
      let hasStreamedText = false;

      choice = await callMinimaxWithToolsStream(
        buildMessages(session),
        TOOL_DEFINITIONS,
        {
          runtimeKey: session.apiKeys.minimaxApiKey,
          minimaxModel: session.apiKeys.minimaxModel,
          maxTokens: 4096,
          temperature: 0.7
        },
        (chunk) => {
          if (chunk.type !== 'text_delta') return;
          const clean = filter.push(chunk.delta);
          if (clean) {
            if (!hasStreamedText) {
              hasStreamedText = true;
            }
            onEvent('text_delta', { delta: clean });
          }
        }
      );

      // 刷出过滤器中剩余缓冲
      const tail = filter.flush();
      if (tail) onEvent('text_delta', { delta: tail });

      // 通知前端本轮文字流结束
      if (hasStreamedText || tail) onEvent('text_end', {});

    } catch (err) {
      console.error('[BrainAgent] LLM 调用失败:', err.message);
      if (isStopRequested(session)) {
        session.status = 'idle';
        return;
      }
      onEvent('error', { message: `AI 调用失败：${err.message}` });
      session.status = 'failed';
      return;
    }

    if (isStopRequested(session)) {
      session.status = 'idle';
      return;
    }

    const { message } = choice;

    // 存储 assistant 消息（含 tool_calls 或纯文本）
    session.messages.push({
      role: 'assistant',
      content: message.content || null,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {})
    });

    // 没有工具调用 → Brain 决定自然结束本轮
    if (!message.tool_calls || message.tool_calls.length === 0) {
      session.status = 'idle';
      break;
    }

    // 处理工具调用
    for (const toolCall of message.tool_calls) {
      if (isStopRequested(session)) {
        session.status = 'idle';
        return;
      }

      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        args = {};
      }
      const toolName = toolCall.function.name;

      // ── 循环检测 ──────────────────────────────────────────────
      const sig = `${toolName}:${stableStringify(args)}`;
      loopTracker[sig] = (loopTracker[sig] || 0) + 1;

      if (loopTracker[sig] === 3) {
        // 注入警告，让 Brain 换策略
        session.messages.push({
          role: 'user',
          content: '注意：你刚才重复调用了同一个工具。请根据已有信息直接推进，不要继续重复搜索。'
        });
      }
      if (loopTracker[sig] >= 5) {
        onEvent('text', { text: '检测到重复操作，我先基于当前信息推进。' });
        session.status = 'idle';
        return;
      }

      // ── ask_user：特殊处理，暂停循环 ──────────────────────────
      if (toolName === 'ask_user') {
        session.pendingToolCallId = toolCall.id;
        session.status = 'waiting_for_user';
        onEvent('clarification', {
          header: args.header || '',
          question: args.question || '请提供更多信息',
          type: args.type || 'missing_info',
          options: Array.isArray(args.options) ? args.options : []
        });
        return; // 暂停，等待 resume() 被调用
      }

      // ── build_ppt：硬护栏，必须先有策划方案 ─────────────────────
      if (toolName === 'build_ppt' && !canCallBuildPpt(session)) {
        const toolResult = {
          success: false,
          error: '还没有策划方案，请先调用 run_strategy'
        };
        onEvent('tool_call', { tool: toolName, display: getToolDisplay(toolName, args), toolCallId: toolCall.id });
        onEvent('tool_result', buildToolResultEvent(toolName, toolResult));
        session.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult)
        });
        session.messages.push({
          role: 'user',
          content: '系统提示：build_ppt 前置条件未满足。你必须先调用 run_strategy，拿到完整策划方案和 doc_ready 之后，才能生成 PPT。不要再次提前调用 build_ppt。'
        });
        continue;
      }

      // ── 普通工具调用 ──────────────────────────────────────────
      const display = getToolDisplay(toolName, args);
      onEvent('tool_call', { tool: toolName, display, toolCallId: toolCall.id });

      let toolResult;
      try {
        toolResult = await executeTool(toolName, args, session, onEvent);
      } catch (err) {
        console.error(`[BrainAgent] 工具 ${toolName} 执行失败:`, err.message);
        if (isStopRequested(session)) {
          session.status = 'idle';
          return;
        }
        toolResult = { error: err.message };
        onEvent('tool_progress', { message: `执行失败：${err.message}` });
      }

      if (isStopRequested(session)) {
        session.status = 'idle';
        return;
      }

      onEvent('tool_result', buildToolResultEvent(toolName, toolResult));

      // 把工具结果存入对话历史
      session.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult)
      });

      // build_ppt 内部已发出 done 事件，直接退出循环
      if (toolName === 'build_ppt' && toolResult?.success) {
        session.status = 'idle';
        return;
      }
    }
  }

  if (session.status === 'running') {
    session.status = 'idle';
  }

  if (session.status === 'idle' && !session.doneEmitted) {
    session.doneEmitted = true;
    onEvent('done', {
      mode: 'brain',
      brief: session.brief || null,
      planItems: Array.isArray(session.planItems) ? session.planItems : [],
      hasPlan: !!session.bestPlan,
      score: session.bestScore || 0
    });
  }
}

function buildToolResultEvent(toolName, toolResult) {
  const safeResult = toolResult && typeof toolResult === 'object' ? toolResult : { value: toolResult };
  const details = JSON.stringify(safeResult, null, 2);

  switch (toolName) {
    case 'write_todos':
      return {
        tool: toolName,
        ok: !safeResult.error,
        summary: safeResult.count ? `已更新 ${safeResult.count} 项计划` : '计划已更新',
        details
      };
    case 'update_brief':
      return {
        tool: toolName,
        ok: !safeResult.error,
        summary: `已整理任务简报${safeResult?.brief?.brand ? `：${safeResult.brief.brand}` : ''}`,
        details
      };
    case 'review_uploaded_images':
      return {
        tool: toolName,
        ok: !!safeResult.success,
        summary: safeResult.success
          ? `已重新查看 ${safeResult.count || 0} 张图片`
          : (safeResult.error || '图片查看失败'),
        details
      };
    case 'web_search':
      return {
        tool: toolName,
        ok: !!safeResult.found,
        summary: safeResult.found
          ? `找到 ${safeResult.count || 0} 条搜索结果（${safeResult.source || 'unknown'}）`
          : (safeResult.warning || '没有找到合适结果'),
        details
      };
    case 'web_fetch':
      return {
        tool: toolName,
        ok: !!safeResult.success,
        summary: safeResult.success ? '已读取页面全文' : '页面读取失败',
        details
      };
    case 'run_strategy':
      return {
        tool: toolName,
        ok: !!safeResult.success,
        summary: safeResult.success
          ? `方案已形成，评分 ${safeResult.score || 0}`
          : (safeResult.error || '方案生成失败'),
        details
      };
    case 'build_ppt':
      return {
        tool: toolName,
        ok: !!safeResult.success,
        summary: safeResult.success
          ? `PPT 已生成，共 ${safeResult.pageCount || 0} 页`
          : (safeResult.error || 'PPT 生成失败'),
        details
      };
    case 'read_workspace_doc':
      return {
        tool: toolName,
        ok: !!safeResult.success,
        summary: safeResult.success
          ? `已读取：${safeResult.name || safeResult.doc_id}`
          : (safeResult.error || '读取失败'),
        details
      };
    case 'save_to_workspace':
      return {
        tool: toolName,
        ok: !!safeResult.success,
        summary: safeResult.success
          ? `已保存到空间：${safeResult.name}`
          : (safeResult.error || '保存失败'),
        details
      };
    case 'update_workspace_doc':
      return {
        tool: toolName,
        ok: !!safeResult.success,
        summary: safeResult.success
          ? `已更新文档：${safeResult.name}`
          : (safeResult.error || '更新失败'),
        details
      };
    default:
      return {
        tool: toolName,
        ok: !safeResult.error,
        summary: safeResult.error || '工具执行完成',
        details
      };
  }
}

/**
 * 稳定序列化（忽略 key 顺序差异）
 */
function stableStringify(obj) {
  try {
    const keys = Object.keys(obj).sort();
    const sorted = {};
    keys.forEach(k => { sorted[k] = obj[k]; });
    return JSON.stringify(sorted);
  } catch {
    return String(obj);
  }
}

module.exports = { run, resume };
