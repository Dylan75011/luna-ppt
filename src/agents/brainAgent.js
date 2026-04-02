// Brain Agent：ReAct 循环（Reason → Act → Observe → Reason...）
const { callMinimaxWithTools } = require('../services/llmClients');
const { TOOL_DEFINITIONS, executeTool, getToolDisplay } = require('../services/toolRegistry');
const { buildBrainSystemPrompt } = require('../prompts/brain');

const MAX_TURNS = 15;

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
  return [
    { role: 'system', content: buildBrainSystemPrompt() },
    ...session.messages
  ];
}

/**
 * 收到用户新消息，启动/继续 Brain 循环
 */
async function run(session, userMessage, onEvent) {
  session.messages.push({ role: 'user', content: userMessage });
  session.status = 'running';
  session.doneEmitted = false;
  await runLoop(session, onEvent);
}

/**
 * 用户回答了 ask_user 的问题，恢复循环
 */
async function resume(session, userReply, onEvent) {
  // 把用户回答作为 tool result 补回去
  if (session.pendingToolCallId) {
    session.messages.push({
      role: 'tool',
      tool_call_id: session.pendingToolCallId,
      content: JSON.stringify({ answer: userReply })
    });
    session.pendingToolCallId = null;
  }
  session.status = 'running';
  session.doneEmitted = false;
  await runLoop(session, onEvent);
}

/**
 * ReAct 主循环
 */
async function runLoop(session, onEvent) {
  const loopTracker = {}; // "toolName:argsHash" → 调用次数

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // 推送 thinking 事件
    onEvent('thinking', {});

    let choice;
    try {
      choice = await callMinimaxWithTools(
        buildMessages(session),
        TOOL_DEFINITIONS,
        {
          runtimeKey: session.apiKeys.minimaxApiKey,
          minimaxModel: session.apiKeys.minimaxModel,
          maxTokens: 4096,
          temperature: 0.7
        }
      );
    } catch (err) {
      console.error('[BrainAgent] LLM 调用失败:', err.message);
      onEvent('error', { message: `AI 调用失败：${err.message}` });
      session.status = 'failed';
      return;
    }

    const { message, finish_reason } = choice;

    // 存储 assistant 消息（含 tool_calls 或纯文本）
    session.messages.push({
      role: 'assistant',
      content: message.content || null,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {})
    });

    // 如果有文本内容，推送给前端（剥离思考过程，过长时截断）
    if (message.content) {
      const rawText = message.content;
      const text = stripThinkingBlocks(rawText).trim();
      if (text) {
        let displayText = text;
        if (text.length > 800) {
          displayText = text.slice(0, 800) + '\n\n[内容较长，已截断]';
        }
        if (!isInternalThinking(rawText)) {
          onEvent('text', { text: displayText });
        }
      }
    }

    // 没有工具调用 → Brain 决定自然结束本轮
    if (!message.tool_calls || message.tool_calls.length === 0) {
      session.status = 'idle';
      break;
    }

    // 处理工具调用
    for (const toolCall of message.tool_calls) {
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
          question: args.question || '请提供更多信息',
          type: args.type || 'missing_info'
        });
        return; // 暂停，等待 resume() 被调用
      }

      // ── 普通工具调用 ──────────────────────────────────────────
      const display = getToolDisplay(toolName, args);
      onEvent('tool_call', { tool: toolName, display, toolCallId: toolCall.id });

      let toolResult;
      try {
        toolResult = await executeTool(toolName, args, session, onEvent);
      } catch (err) {
        console.error(`[BrainAgent] 工具 ${toolName} 执行失败:`, err.message);
        toolResult = { error: err.message };
        onEvent('tool_progress', { message: `执行失败：${err.message}` });
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
