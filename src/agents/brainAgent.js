// Brain Agent：ReAct 循环（Reason → Act → Observe → Reason...）
const { callMinimaxWithToolsStream, callDeepseekChatText } = require('../services/llmClients');
const config = require('../config');
const { TOOL_DEFINITIONS, executeTool, getToolDisplay } = require('../services/toolRegistry');
const { validateAskUserArgs } = require('../services/tools/askUserValidator');
const { analyzeAgentImages } = require('../services/visionMcp');
const { buildBrainSystemPrompt } = require('../prompts/brain');
const { classifyTaskIntentWithLLM, isContinuationUtterance } = require('../services/intentClassifier');
const {
  createExecutionPlan,
  createTaskSpec
} = require('../services/taskPlanner');
const { buildRouteToolSequence } = require('../services/routeExecutor');
const wm = require('../services/workspaceManager');
const agentSession = require('../services/agentSession');
const { TimeoutError, AbortError } = require('../utils/abortx');
const { retryLlmCall, classifyLlmError, buildNextActionHint } = require('../utils/llmRetry');

const MAX_TURNS = 15;

// 每个工具的"前台等待预算"——超过就转后台，把控制权立刻还给模型。
// 不是工具本身的截止时间：底层调用可能继续跑完，我们只是不再阻塞主循环。
//
// budget kind:
//   - 'total':  从工具启动开始计时，到点就 backgrounded（适合无进度反馈的工具）
//   - 'idle':   只要工具还在推送进度事件（tool_progress / doc_section_added /
//               artifact 等），就视为"活着"并重置计时；连续 ms 没新进度才 backgrounded
//               （适合长流程：run_strategy / build_ppt / propose_concept 这种会
//               逐 section 输出的工具——以前用 total 会把正常生成的长任务误判为挂死）
const TOOL_BUDGET = {
  // ── idle 型：会逐步输出进度的长任务，只要还在动就一直等 ──
  build_ppt:           { kind: 'idle',  ms: 60_000 },   // 每页截图都有 progress
  run_strategy:        { kind: 'idle',  ms: 60_000 },   // 每个 section emit 一次
  review_strategy:     { kind: 'idle',  ms: 60_000 },
  propose_concept:     { kind: 'idle',  ms: 45_000 },   // 流式输出
  challenge_brief:     { kind: 'idle',  ms: 45_000 },
  // ── total 型：单次结果型，没进度事件，给个合理硬上限 ──
  generate_image:      { kind: 'total', ms: 120_000 },
  search_images:       { kind: 'total', ms: 25_000 },
  web_fetch:           { kind: 'total', ms: 25_000 },
  web_search:          { kind: 'total', ms: 20_000 },
  browser_search:      { kind: 'total', ms: 30_000 },
  browser_read_page:   { kind: 'total', ms: 25_000 },
  browser_read_notes:  { kind: 'total', ms: 30_000 },
  analyze_note_images: { kind: 'total', ms: 30_000 },
  approve_concept:     { kind: 'total', ms: 15_000 },
  review_uploaded_images: { kind: 'total', ms: 30_000 }
};
const TOOL_BUDGET_DEFAULT = { kind: 'total', ms: 30_000 };
// 兼容旧引用：保留 TOOL_BUDGET_MS / TOOL_BUDGET_DEFAULT_MS 作为 ms-only 视图
const TOOL_BUDGET_MS = Object.fromEntries(
  Object.entries(TOOL_BUDGET).map(([k, v]) => [k, v.ms])
);
const TOOL_BUDGET_DEFAULT_MS = TOOL_BUDGET_DEFAULT.ms;
// 哪些 SSE 事件类型代表"工具还活着"，用于 idle budget 重置
const PROGRESS_EVENT_TYPES = new Set([
  'tool_progress',
  'doc_section_added',
  'artifact',
  'doc_ready',
  'slide_added',
  'plan_update',
  'brief_update',
  'route_update',
  'workspace_updated'
]);
// LLM 流式：超过 N 秒没新 chunk 就视为卡死并 abort
const LLM_STREAM_IDLE_MS = 30_000;
// LLM 单次调用整体上限（含连接 + 流式总时长）。idle 超时只盯 chunk 间隔，
// 这层兜住"连接阶段就挂死"或"模型一直慢慢吐 chunk 永不结束"等极端情况。
const LLM_TOTAL_BUDGET_MS = 90_000;
// 用户停止信号的轮询间隔（毫秒）
const STOP_POLL_INTERVAL_MS = 500;

const {
  CONTEXT_TOKEN_WARN,
  estimateTokens,
  truncateToolResult,
  isCompactableTool,
  compressOldMessages,
  extractKeyState,
} = require('../services/contextManager');

/**
 * 流式输出中实时过滤 <think>...</think> 块
 * 保留 7 个字符的缓冲区以处理跨 chunk 的标签边界
 */
// 流式输出过滤器：抑制三类不该出现在 SSE text_delta 里的 XML 块——
//   1. <think>...</think>   推理标签（部分 MiniMax 模型会泄漏）
//   2. <minimax:tool_call>...</minimax:tool_call>  MiniMax 原生 XML 工具调用
//      （绕开 OpenAI tools API 的"假语法"，如果不过滤会被前端当文本气泡显示）
//   3. <invoke name="X">...</invoke>  上面包装的内层（也可能不带外层 minimax 包装）
//
// 三类块都是"开标签 → 抑制到闭标签出现"的状态机。同时尾缓冲 25 字符防止闭标签被
// 跨 chunk 切断时漏掉抑制结束。
class ThinkFilter {
  constructor() {
    this.buf = '';
    this.inSuppress = null; // null 或 { closeTag, blockName }
  }

  // 找出 buf 里"最早出现"的可抑制开标签，返回 { idx, len, closeTag, blockName } 或 null
  _findEarliestOpenTag() {
    const candidates = [];
    const t = this.buf;
    const ti = t.indexOf('<think>');
    if (ti !== -1) candidates.push({ idx: ti, len: 7, closeTag: '</think>', blockName: 'think' });
    const mi = t.indexOf('<minimax:tool_call>');
    if (mi !== -1) candidates.push({ idx: mi, len: 19, closeTag: '</minimax:tool_call>', blockName: 'minimax_tool_call' });
    // <invoke name="..."> ：开标签长度可变，找到 < invoke 后的第一个 >
    const inv = t.match(/<invoke\b[^>]*>/i);
    if (inv) candidates.push({ idx: inv.index, len: inv[0].length, closeTag: '</invoke>', blockName: 'invoke' });
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.idx - b.idx);
    return candidates[0];
  }

  push(delta) {
    this.buf += delta;
    let out = '';

    while (this.buf.length > 0) {
      if (this.inSuppress) {
        const end = this.buf.indexOf(this.inSuppress.closeTag);
        if (end !== -1) {
          this.buf = this.buf.slice(end + this.inSuppress.closeTag.length);
          this.inSuppress = null;
        } else {
          // 还在抑制块里，保留末尾防 closeTag 被切断（最长 </minimax:tool_call> = 20 字符）
          const keep = this.inSuppress.closeTag.length;
          if (this.buf.length > keep + 30) this.buf = this.buf.slice(-(keep + 1));
          break;
        }
      } else {
        const open = this._findEarliestOpenTag();
        if (open) {
          out += this.buf.slice(0, open.idx);
          this.buf = this.buf.slice(open.idx + open.len);
          this.inSuppress = { closeTag: open.closeTag, blockName: open.blockName };
        } else {
          // 没找到开标签 — 但末尾可能有一个未完成的 < ，留 25 字符兜底防"开标签跨 chunk 切断"
          // 例如 chunk 1 末尾是 "<minimax:tool_c"，chunk 2 开头是 "all>..."
          const TAIL_RESERVE = 25;
          const lastLT = this.buf.lastIndexOf('<');
          if (lastLT !== -1 && lastLT >= this.buf.length - TAIL_RESERVE) {
            out += this.buf.slice(0, lastLT);
            this.buf = this.buf.slice(lastLT);
          } else {
            out += this.buf;
            this.buf = '';
          }
          break;
        }
      }
    }
    return out;
  }

  flush() {
    // 流结束，输出剩余缓冲
    const remaining = this.buf;
    const wasInSuppress = !!this.inSuppress;
    this.buf = '';
    this.inSuppress = null;
    // 仍在抑制块内（开标签来了但闭标签没等到）→ 内容是 think/tool_call XML，丢弃
    if (wasInSuppress) return '';
    // 兜底再做一次完整块剥离，处理"开标签 + 闭标签都在 buf 末尾且没等到下一个 chunk"的边缘 case
    return remaining
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/gi, '')
      .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
      .trim();
  }
}

function isStopRequested(session) {
  return !!session?.stopRequested;
}

// buildNextActionHint 已经搬到 src/utils/llmRetry.js（跟 classifyLlmError 同居），
// 这样 routes 等其他层也能用同一份逻辑。这里只是 import 一下。

// ────────────────────────────────────────────────────────────────────────────
// 后台任务回收：tool race 超时后，输掉的那个 promise 不丢弃，挂到 session 上继续
// 等。完成时把结果作为"系统注入"的 user message 推回对话历史，让模型下一轮
// LLM 调用时自然看到。
// ────────────────────────────────────────────────────────────────────────────

const BACKGROUND_RESULT_MAX_CHARS = 6000;

function formatBackgroundResult(toolName, toolCallId, status, payload) {
  const header = `[系统注入｜后台任务返回] 之前你后台化的工具 ${toolName}（call_id=${toolCallId}）已返回。`;
  if (status === 'error') {
    const msg = (payload && payload.message) || String(payload || 'unknown error');
    return `${header}\n执行失败：${msg}\n如有必要可换路径推进，请勿重复调用同一工具。`;
  }
  let body;
  try {
    body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  } catch {
    body = String(payload);
  }
  if (body.length > BACKGROUND_RESULT_MAX_CHARS) {
    body = body.slice(0, BACKGROUND_RESULT_MAX_CHARS) + '\n…[已截断]';
  }
  return `${header}\n结果：${body}\n请在合适时机利用这些信息，不要重复调用同一工具。`;
}

function enqueueBackgroundTask(session, { toolCallId, toolName, promise }) {
  if (!session.backgroundTasks) session.backgroundTasks = new Map();
  const meta = {
    toolName,
    toolCallId,
    startedAt: Date.now(),
    cancelled: false
  };
  session.backgroundTasks.set(toolCallId, meta);

  // 同步写一份"轻量级登记"到可序列化的 inflightBackgroundCalls：
  // backgroundTasks 存 promise 对象不能持久化，进程崩了所有 in-flight 工具的"真结果"全
  // 永久丢失（因为 promise 死了）。但 brain 看消息历史的话只看到 {backgrounded:true} stub
  // 还以为工具在跑——等永远等不到 → 用户卡死。
  // 登记这一份后，崩溃重启时 resurrect 路径会扫描它，把"还登记着但已经死"的 tool_call
  // 转成系统注入消息告诉 brain"这次后台化失败了，决定怎么办"。
  if (!Array.isArray(session.inflightBackgroundCalls)) session.inflightBackgroundCalls = [];
  session.inflightBackgroundCalls.push({
    toolCallId,
    toolName,
    startedAt: meta.startedAt
  });
  try { agentSession.flushAgentState(session.sessionId, { immediate: true }); } catch {}

  const finish = (status, payload) => {
    if (meta.cancelled) return;
    if (session.backgroundTasks?.get(toolCallId) !== meta) return;
    session.backgroundTasks.delete(toolCallId);

    // 从 inflight 登记里摘掉——这条已经成功回收
    if (Array.isArray(session.inflightBackgroundCalls)) {
      session.inflightBackgroundCalls = session.inflightBackgroundCalls
        .filter(x => x.toolCallId !== toolCallId);
    }

    const elapsedMs = Date.now() - meta.startedAt;
    try {
      agentSession.pushEvent(session.sessionId, 'background_done', {
        toolCallId, toolName, status, elapsedMs
      });
    } catch {}

    const injectMsg = {
      role: 'user',
      content: formatBackgroundResult(toolName, toolCallId, status, payload),
      _backgroundInject: true
    };

    if (session.status === 'running' || session.status === 'waiting_for_user') {
      // 主循环还在转 / 等用户：直接进对话历史，下次 buildMessages 自然带上
      session.messages.push(injectMsg);
    } else {
      // 已经 idle / failed：暂存，等下一次 run/resume 入口处合并
      if (!Array.isArray(session.pendingBackgroundInjects)) session.pendingBackgroundInjects = [];
      session.pendingBackgroundInjects.push(injectMsg);
      // 立即 flush 到 DB——idle 状态下后台结果是"必须保住的成果"，进程崩了恢复
      // 才能不白等。flushAgentState immediate 走 best-effort，写失败不阻断主流程。
      try { agentSession.flushAgentState(session.sessionId, { immediate: true }); } catch {}
    }
  };

  // 注意：这里不 await——promise 在 race 失败后继续在事件循环里跑，结果到了再走 finish
  Promise.resolve(promise).then(
    (result) => finish('success', result),
    (err) => finish('error', err)
  );
}

function drainPendingBackgroundInjects(session) {
  if (!Array.isArray(session.pendingBackgroundInjects) || !session.pendingBackgroundInjects.length) return;
  for (const msg of session.pendingBackgroundInjects) {
    session.messages.push({ role: msg.role, content: msg.content });
  }
  session.pendingBackgroundInjects = [];
  // 队列已清，立即把空状态落盘——否则 DB 里残留的旧条目下次 resurrect 会被双重消费
  try { agentSession.flushAgentState(session.sessionId, { immediate: true }); } catch {}
}

/**
 * 主动压缩历史以应对 context length exceeded。
 * 保留 system + 最近 keepRecent 条；前面的全部走 compressOldMessages 折叠成一条 system 摘要。
 * 切点会避开 "assistant(tool_calls) 和它的 tool 之间"——避免破坏 OpenAI tool 协议。
 *
 * @returns {boolean} 是否真的做了压缩（消息太短就不动）
 */
function compressSessionMessagesForRecovery(session, keepRecent = 6) {
  if (!Array.isArray(session.messages) || session.messages.length <= keepRecent + 1) return false;

  let splitIdx = session.messages.length - keepRecent;
  // 切点向前移到一个安全位置：不能是 tool message（tool 必须紧跟它的 assistant tool_calls）
  while (splitIdx > 0 && splitIdx < session.messages.length) {
    const cur = session.messages[splitIdx];
    if (cur.role === 'tool') { splitIdx--; continue; }
    // 如果 splitIdx 这条是 assistant 但前面 tool_calls 在 older 里，也要往前挪
    // 简化：只关心 tool 不能是 recent 的第一条，其它情况让 compressOldMessages 自己处理
    break;
  }
  if (splitIdx <= 0) return false;

  const older = session.messages.slice(0, splitIdx);
  const recent = session.messages.slice(splitIdx);
  const compressed = compressOldMessages(older);
  if (!compressed.length) return false;

  const before = session.messages.length;
  session.messages = [...compressed, ...recent];
  console.warn(`[BrainAgent] context 压缩：${before} 条 → ${session.messages.length} 条（折叠最早 ${older.length} 条为摘要）`);
  return true;
}

// 在 abort / hard-fail 出口把"已 SSE 流给前端但还没入 messages"的半截 assistant
// 文本补回 session.messages，避免前端渲染出来的内容在历史里凭空消失。
function persistPartialAssistantText(session, partial, reason = 'aborted') {
  const text = (partial || '').trim();
  if (!text) return false;
  session.messages.push({
    role: 'assistant',
    content: text,
    _aborted: true,
    _abortReason: reason
  });
  return true;
}

function cancelAllBackgroundTasks(session) {
  if (!session.backgroundTasks) return;
  for (const meta of session.backgroundTasks.values()) {
    meta.cancelled = true;
  }
  session.backgroundTasks.clear();
  session.pendingBackgroundInjects = [];
}

// ────────────────────────────────────────────────────────────────────────────
// 跨厂商兜底：minimax 软失败时切到 deepseek-chat 给用户一段交代。
// 独立 provider 独立故障模式 —— 当 minimax 网络/服务不稳时成功率显著高。
// 不需要 tool calling，纯文本流式输出。
// ────────────────────────────────────────────────────────────────────────────

const FALLBACK_TOTAL_TIMEOUT_MS = 30_000;
const FALLBACK_HISTORY_MAX_CHARS = 6000;

function canUseFallbackProvider(session) {
  if (config.fallbackProvider === 'off') return false;
  // session 上的 key 优先（用户在 UI 设置面板填的），fallback 到 env config
  return !!(session?.apiKeys?.deepseekApiKey || config.deepseekApiKey);
}

/**
 * 把 session.messages 整理成 deepseek-chat 能消化的纯文本对话：
 *  - tool role 消息 → 转成 user 摘要 "（工具 X 返回：...）"
 *  - assistant 含 tool_calls → 保留 content 或转成"（调用了工具 X）"
 *  - 总长度截断在 FALLBACK_HISTORY_MAX_CHARS
 *
 * 这是为了避免不同 provider 之间 tool calling 协议格式不兼容（minimax 留下的
 * tool_call_id 给 deepseek 会 400）。
 */
function stripToolCallHistory(messages) {
  const flat = [];
  for (const m of messages) {
    if (m.role === 'system') {
      flat.push({ role: 'system', content: m.content || '' });
      continue;
    }
    if (m.role === 'user') {
      flat.push({ role: 'user', content: m.content || '' });
      continue;
    }
    if (m.role === 'assistant') {
      // 含 tool_calls 的 assistant：保留 content，加一个工具调用摘要
      const toolNames = Array.isArray(m.tool_calls)
        ? m.tool_calls.map(tc => tc.function?.name).filter(Boolean).join(', ')
        : '';
      const text = m.content || (toolNames ? `（调用了工具：${toolNames}）` : '');
      if (text) flat.push({ role: 'assistant', content: text });
      continue;
    }
    if (m.role === 'tool') {
      // tool 结果转成 user 摘要，让 deepseek 知道工具发生了什么
      let summary;
      try {
        const parsed = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
        if (parsed?.error) summary = `（工具失败：${parsed.error}）`;
        else if (parsed?.backgrounded) summary = `（工具转后台运行中）`;
        else summary = `（工具返回：${JSON.stringify(parsed).slice(0, 400)}）`;
      } catch {
        summary = `（工具返回：${String(m.content || '').slice(0, 400)}）`;
      }
      flat.push({ role: 'user', content: summary });
      continue;
    }
  }

  // 合并相邻的同 role 消息，避免 user/user 重复（deepseek 接受但更整洁）
  const merged = [];
  for (const m of flat) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role && m.role !== 'system') {
      last.content = `${last.content}\n${m.content}`;
    } else {
      merged.push({ ...m });
    }
  }

  // 总长度截断（保留最近的对话，从尾部往前截）
  let totalChars = merged.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  while (totalChars > FALLBACK_HISTORY_MAX_CHARS && merged.length > 2) {
    // 删除靠前的非 system 消息
    const idx = merged.findIndex(m => m.role !== 'system');
    if (idx === -1) break;
    totalChars -= merged[idx].content?.length || 0;
    merged.splice(idx, 1);
  }

  return merged;
}

/**
 * 调用 deepseek-chat 给用户一段交代。
 * 返回 fullText 字符串，stream 时通过 onEvent('text_delta') 实时输出。
 * 调用失败抛错（caller 走 minimax 软失败兜底）。
 */
async function runCrossProviderFallback(session, lastError, onEvent) {
  const flat = stripToolCallHistory(session.messages);

  // 注入一个明确的 fallback 指令
  flat.push({
    role: 'user',
    content: `[系统注入｜跨厂商兜底] 上一次主模型调用失败：${lastError?.message || 'unknown'}\n请你（备用模型）基于以上对话历史，直接给用户一段简短的中文回答：\n1. 简要承认 AI 暂时遇到问题\n2. 给出当前阶段已有的结论或下一步建议\n3. 不要调用任何工具、不要重新生成完整方案\n字数控制在 200 字内。`
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new TimeoutError('fallback_total', FALLBACK_TOTAL_TIMEOUT_MS)), FALLBACK_TOTAL_TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();

  // 让 stop 按钮也能打断 fallback
  const stopWatchdog = setInterval(() => {
    if (isStopRequested(session)) ac.abort('user_stop');
  }, STOP_POLL_INTERVAL_MS);
  if (typeof stopWatchdog.unref === 'function') stopWatchdog.unref();
  session._currentLlmAbort = ac;

  let hasStreamed = false;
  try {
    const text = await callDeepseekChatText(
      flat,
      {
        runtimeKey: session.apiKeys?.deepseekApiKey,
        signal: ac.signal,
        maxTokens: 800
      },
      (delta) => {
        if (delta) {
          if (!hasStreamed) hasStreamed = true;
          onEvent('text_delta', { delta });
        }
      }
    );
    if (hasStreamed) onEvent('text_end', {});
    return text;
  } finally {
    clearTimeout(timer);
    clearInterval(stopWatchdog);
    if (session._currentLlmAbort === ac) session._currentLlmAbort = null;
  }
}

/**
 * 统一的"带预算 + 可中断 + 超时转后台"的工具调用入口。
 * 主 ReAct 循环和 runAutoRoutePrelude 共用这一份逻辑——避免裸 await 漏网。
 *
 * @returns {Promise<{ result: any, status: 'ok'|'backgrounded'|'aborted'|'error', error?: Error }>}
 *   - 'ok': 工具正常返回，result 是真实结果
 *   - 'backgrounded': 超时转后台，result 是 { backgrounded: true, ... }；caller 应继续推进
 *   - 'aborted': 用户主动 stop，caller 应立刻 return
 *   - 'error': 工具自己抛错，result 是 { error: msg }；caller 应继续（已有错误处理上下文）
 */
async function runToolWithBudget({ session, onEvent: outerOnEvent, toolCallId, toolName, args, budgetMs, budgetKind }) {
  const toolAc = new AbortController();
  session._currentToolAbort = toolAc;

  // budget 配置：显式 budgetMs/budgetKind > 表里查 > 默认
  const cfg = TOOL_BUDGET[toolName] || TOOL_BUDGET_DEFAULT;
  const budget = budgetMs ?? cfg.ms;
  const kind = budgetKind ?? cfg.kind;

  // 包一层 onEvent：进度类事件（doc_section_added / artifact / tool_progress 等）
  // 触发 lastProgressAt 刷新；只对 idle 模式生效，total 模式忽略
  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  const onEvent = (type, data) => {
    if (PROGRESS_EVENT_TYPES.has(type)) lastProgressAt = Date.now();
    return outerOnEvent(type, data);
  };

  // 单 watchdog 同时管 stop / total / idle 超时
  const watchdog = setInterval(() => {
    if (isStopRequested(session)) { toolAc.abort('user_stop'); return; }
    if (kind === 'total') {
      if (Date.now() - startedAt > budget) toolAc.abort(new TimeoutError(`tool:${toolName}:total`, budget));
    } else {
      if (Date.now() - lastProgressAt > budget) toolAc.abort(new TimeoutError(`tool:${toolName}:idle`, budget));
    }
  }, STOP_POLL_INTERVAL_MS);
  if (typeof watchdog.unref === 'function') watchdog.unref();

  const realPromise = Promise.resolve().then(() => executeTool(toolName, args, session, onEvent));

  try {
    const result = await Promise.race([
      realPromise,
      new Promise((_, reject) => {
        toolAc.signal.addEventListener('abort', () => {
          const reason = toolAc.signal.reason;
          if (reason instanceof TimeoutError) reject(reason);
          else reject(new AbortError(reason));
        }, { once: true });
      })
    ]);
    return { result, status: 'ok' };
  } catch (err) {
    if (err instanceof AbortError && (err.reason === 'user_stop' || isStopRequested(session))) {
      realPromise.catch(() => {}); // 防 unhandled rejection
      return { result: null, status: 'aborted', error: err };
    }
    if (err instanceof TimeoutError || err?.code === 'TIMEOUT') {
      enqueueBackgroundTask(session, { toolCallId, toolName, promise: realPromise });
      const idleOrTotal = kind === 'idle' ? `${Math.round(budget / 1000)}s 无新进展` : `${Math.round(budget / 1000)}s 未返回`;
      const result = {
        backgrounded: true,
        tool: toolName,
        budget_ms: budget,
        budget_kind: kind,
        message: `工具 ${toolName} ${idleOrTotal}，已转入后台继续执行。结果回来时会作为系统注入消息推送给你；你现在可以基于已有信息继续推进，或直接告知用户当前阶段进展，请勿重复调用同一工具。`
      };
      console.warn(`[BrainAgent] 工具 ${toolName} 超时（kind=${kind}, ${budget}ms），转后台`);
      onEvent('tool_progress', { message: `${toolName} 已转后台（${idleOrTotal}）` });
      return { result, status: 'backgrounded' };
    }
    console.error(`[BrainAgent] 工具 ${toolName} 执行失败:`, err.message);
    onEvent('tool_progress', { message: `执行失败：${err.message}` });
    return { result: { error: err.message }, status: 'error', error: err };
  } finally {
    clearInterval(watchdog);
    if (session._currentToolAbort === toolAc) session._currentToolAbort = null;
  }
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

// 每个 session 的 prompt 体积日志限速器：避免每轮都打满 stdout
const PROMPT_SIZE_LOG_INTERVAL_MS = 30_000;

function logPromptSize(session, systemPrompt, trimmedMessages) {
  const now = Date.now();
  if (session._lastPromptSizeLogAt && now - session._lastPromptSizeLogAt < PROMPT_SIZE_LOG_INTERVAL_MS) return;
  session._lastPromptSizeLogAt = now;
  const sysChars = systemPrompt.length;
  const histChars = trimmedMessages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0);
  const sysTok = estimateTokens(systemPrompt);
  const totalTok = sysTok + trimmedMessages.reduce((s, m) => s + estimateTokens(JSON.stringify(m)), 0);
  console.log(`[BrainAgent] prompt size: system=${sysChars}c/${sysTok}t  history=${histChars}c  total≈${totalTok}t  msgs=${trimmedMessages.length}`);
}

// 把"连续多条 _aborted assistant"合并：每次 retry 都失败的 attempt 各 push 一条
// 半截 assistant，会让下一轮 LLM 看到三四条自己讲了一半的话，容易觉得"已经讲完了
// 不再补充"。这里取最后一条作为内容，再加一行内联标注，避免 brain 误解状态。
function collapseAbortedAssistants(messages) {
  const out = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (m._aborted && m.role === 'assistant' && last && last._aborted && last.role === 'assistant') {
      last.content = m.content; // 取最新一条作为半截内容
      last._abortReason = m._abortReason || last._abortReason;
      continue;
    }
    out.push({ ...m });
  }
  // 给尾部最后一条 _aborted assistant 加内联提示，方便下一轮 LLM 识别"上轮被中断"
  for (let i = out.length - 1; i >= 0; i--) {
    const cur = out[i];
    if (cur.role !== 'assistant') break;
    if (cur._aborted) {
      const note = '\n\n（上一段回复在中断前到此为止，请继续补全或基于现状重新回应。）';
      if (typeof cur.content === 'string' && !cur.content.endsWith(note)) {
        cur.content = cur.content + note;
      }
      break;
    }
  }
  return out;
}

function buildMessages(session) {
  const spaceContextWithLastDoc = session.spaceContext
    ? {
        ...session.spaceContext,
        lastSavedDocId: session.lastSavedDocId || null,
        lastSavedDocName: session.lastSavedDocName || null
      }
    : null;

  const compactSummary = extractKeyState(session);

  const systemPrompt = buildBrainSystemPrompt(
    spaceContextWithLastDoc,
    session.executionPlan || null,
    session.taskSpec || null,
    session.routeToolSequence || [],
    compactSummary,
    Array.isArray(session.askedQuestions) ? session.askedQuestions : [],
    session.taskIntent || null
  );

  // 注意：collapseAbortedAssistants 操作克隆副本，不动 session.messages 本体
  const collapsedSource = collapseAbortedAssistants(session.messages);
  // toolNameMap 必须基于折叠后的数组，否则 idx 与 trimmed 错位
  const toolNameMap = buildToolNameMap(collapsedSource);

  const trimmed = collapsedSource.map((message, idx) => {
    const next = {
      role: message.role,
      content: message.content
    };
    // 清洗 tool_calls：确保 arguments 始终是合法 JSON 字符串，
    // 防止 MiniMax 截断或生成非法 JSON 后被 API 以 400 拒绝
    if (message.tool_calls) {
      next.tool_calls = message.tool_calls.map(tc => {
        const raw = tc.function?.arguments ?? '{}';
        let safeArgs = raw;
        try { JSON.parse(raw); } catch { safeArgs = '{}'; }
        return { ...tc, function: { ...tc.function, arguments: safeArgs } };
      });
    }
    if (message.tool_call_id) next.tool_call_id = message.tool_call_id;

    if (message.role === 'tool' && typeof message.content === 'string') {
      const toolName = toolNameMap[idx] || 'unknown';
      next.content = truncateToolResult(toolName, message.content);
    }
    return next;
  });

  const totalTokens = estimateTokens(systemPrompt)
    + trimmed.reduce((sum, m) => sum + estimateTokens(JSON.stringify(m)), 0);

  if (totalTokens > CONTEXT_TOKEN_WARN && trimmed.length > 6) {
    let splitIndex = trimmed.length - 6;

    const firstRecentMsg = trimmed[splitIndex];
    if (firstRecentMsg.role === 'tool') {
      for (let i = splitIndex - 1; i >= 0; i--) {
        const msg = trimmed[i];
        if (msg.role === 'assistant' && msg.tool_calls) {
          if (msg.tool_calls.some(tc => tc.id === firstRecentMsg.tool_call_id)) {
            splitIndex = i;
            break;
          }
        }
      }
    }

    const recent = trimmed.slice(splitIndex);
    const older  = trimmed.slice(0, splitIndex);

    const compressed = compressOldMessages(older);

    const out = [{ role: 'system', content: systemPrompt }, ...compressed, ...recent];
    logPromptSize(session, systemPrompt, [...compressed, ...recent]);
    return out;
  }

  logPromptSize(session, systemPrompt, trimmed);
  return [{ role: 'system', content: systemPrompt }, ...trimmed];
}

function buildToolNameMap(messages) {
  const map = {};
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const fnName = tc.function?.name || tc.name;
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j].role === 'tool' && messages[j].tool_call_id === tc.id) {
            map[j] = fnName;
            break;
          }
        }
      }
    }
  }
  return map;
}

function canCallBuildPpt(session) {
  return !!session?.bestPlan && !!session?.userInput;
}

function buildConceptSelectionArgs(session) {
  const directions = Array.isArray(session?.conceptProposal?.directions)
    ? session.conceptProposal.directions
    : [];
  if (!directions.length) return null;

  const optionForDirection = (direction) => {
    const label = String(direction.label || '').trim() || 'A';
    const codeName = String(direction.codeName || direction.themeName || '').trim();
    const upside = String(direction.upside || direction.positioning || '方向清晰、便于推进').trim();
    const risk = String(direction.risk || '需要在后续方案里继续压实执行细节').trim();
    return {
      label: codeName ? `押 ${label} ${codeName}` : `押 ${label} 方向`,
      value: `按 ${label} 方向继续`,
      description: `收益：${upside}；代价：${risk}`
    };
  };

  return {
    header: '挑一条押注',
    question: '三条方向已经摆出来了，你更敢为哪一条背书？先听直觉选就行。',
    type: 'suggestion',
    options: [
      ...directions.slice(0, 3).map(optionForDirection),
      {
        label: '都不够好，换一批',
        value: '这三条都不太对，换一批',
        description: '我会带着你的反馈重出一版；代价：会多消耗一轮时间。'
      }
    ].slice(0, 4)
  };
}

function pauseForAskUser(session, onEvent, toolCallId, args, turn) {
  session.pendingToolCallId = toolCallId;
  session.status = 'waiting_for_user';

  if (!Array.isArray(session.askedQuestions)) session.askedQuestions = [];
  const _trim = (x) => String(x || '').trim();
  session.askedQuestions.push({
    header: _trim(args.header),
    question: _trim(args.question).slice(0, 160),
    type: _trim(args.type) || 'missing_info',
    optionLabels: (Array.isArray(args.options) ? args.options : [])
      .map(o => _trim(o && o.label))
      .filter(Boolean),
    askedAtTurn: turn,
    answer: null
  });
  if (session.askedQuestions.length > 6) {
    session.askedQuestions = session.askedQuestions.slice(-6);
  }

  onEvent('clarification', {
    header: args.header || '',
    question: args.question || '请提供更多信息',
    type: args.type || 'missing_info',
    options: Array.isArray(args.options) ? args.options : []
  });
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

async function runAutoRoutePrelude(session, onEvent, context = {}) {
  const routeToolSequence = buildRouteToolSequence(session.taskSpec, {
    planItems: session.planItems,
    workspaceDocs: context.workspaceDocs || []
  });
  session.routeToolSequence = routeToolSequence;

  onEvent('route_update', {
    taskMode: session.taskSpec?.taskMode || '',
    primaryRoute: session.taskSpec?.primaryRoute || '',
    fallbackRoutes: session.taskSpec?.fallbackRoutes || [],
    toolSequence: routeToolSequence.map((step) => ({
      toolName: step.toolName,
      autoExecutable: step.autoExecutable,
      reason: step.reason || ''
    }))
  });

  const autoSteps = routeToolSequence.filter((step) => step.autoExecutable);
  if (!autoSteps.length) return;

  const assistantToolCalls = autoSteps.map((step, index) => ({
    id: `route_auto_${Date.now()}_${index}`,
    type: 'function',
    function: {
      name: step.toolName,
      arguments: JSON.stringify(step.args || {})
    }
  }));

  session.messages.push({
    role: 'assistant',
    content: null,
    tool_calls: assistantToolCalls
  });

  for (let index = 0; index < autoSteps.length; index += 1) {
    const step = autoSteps[index];
    const toolCall = assistantToolCalls[index];
    onEvent('tool_call', {
      tool: step.toolName,
      display: getToolDisplay(step.toolName, step.args || {}),
      toolCallId: toolCall.id,
      auto: true,
      reason: step.reason || ''
    });
    // 复用主循环的 race + auto-background 机制——避免 prelude 阶段被任意工具卡死
    const { result: toolResult, status: toolStatus } = await runToolWithBudget({
      session, onEvent, toolCallId: toolCall.id, toolName: step.toolName, args: step.args || {}
    });
    if (toolStatus === 'aborted') return; // 用户 stop：prelude 早退，主循环也不会再起
    onEvent('tool_result', buildToolResultEvent(step.toolName, toolResult));
    session.messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: truncateToolResult(step.toolName, JSON.stringify(toolResult))
    });
  }
}


function toIntentMeta(type = 'chat') {
  const map = {
    chat: {
      label: '普通对话',
      hint: ''
    },
    image_search: {
      label: '找图配图',
      hint: '用户当前主要意图是”找图/配图/图片参考”。优先调用 search_images，除非用户明确要案例、数据或行业信息，否则不要改走 web_search。'
    },
    image_generate: {
      label: 'AI生图',
      hint: '用户想用 AI 生成全新图片，或修改/替换已有图片。调用 generate_image，不要用 search_images 代替。'
    },
    research: {
      label: '信息搜索',
      hint: '用户当前主要意图是“搜索信息/案例/关键事实”。优先调用 web_search；只有值得深读的页面再调用 web_fetch。'
    },
    doc_edit: {
      label: '文档修改',
      hint: '用户当前主要意图是”基于现有文档修改/续写/润色”。优先读取并更新文档，不要默认重走完整 research -> strategy 流程。'
    },
    strategy: {
      label: '方案策划',
      hint: '用户当前主要意图是“做策划方案”。信息足够时直接推进 update_brief -> write_todos -> web_search -> run_strategy。'
    },
    ppt: {
      label: 'PPT生成',
      hint: '用户当前主要意图是“生成或修改 PPT”。如果还没有方案，先确认依据；如果已有方案，再判断是否进入 build_ppt。'
    }
  };

  return map[type] || map.chat;
}

// 工具直达模式（前端"+"按钮锁定的工具）→ 强制意图
// 跳过 LLM 分类，直接告诉 brain 用指定工具
const FORCE_TOOL_INTENT_MAP = {
  generate_image: {
    type: 'image_generate',
    label: 'AI生图',
    hint: '【用户已手动选择"生图"工具】请直接调用 generate_image 生成图片。不要走 web_search / search_images / 策划 / PPT 等流程。如果用户描述不够具体，可以基于已知信息合理发挥；只有在描述完全无法推断主题时才用 ask_user 追问一句。'
  },
  build_ppt: {
    type: 'ppt',
    label: 'PPT',
    hint: '【用户已手动选择"PPT"工具】请根据当前会话状态智能决定：如果已有完整策划方案（session.bestPlan），直接调用 build_ppt 生成/重生成；如果没有方案但已有足够上下文（上传的文档/空间引用/历史消息），先最小化地走 update_brief → run_strategy 拿到方案，再立即 build_ppt，不要再反复追问研究方向。跳过意图澄清。'
  },
  web_search: {
    type: 'research',
    label: '网页搜索',
    hint: '【用户已手动选择"网页搜索"工具】请直接调用 web_search 搜资料。不要改走 search_images / 策划 / PPT。如果需要深读再调 web_fetch，搜完用 3-5 句总结关键发现即可。'
  },
  propose_concept: {
    type: 'strategy',
    label: '创意方向',
    hint: '【用户已手动选择"创意方向"工具】请直接调用 propose_concept 给出 3 个差异化创意方向。不要走完整策划流程，不要生成 PPT。每个方向一句话核心概念 + 一句执行要点即可。'
  }
};

function buildForcedIntent(forceTool) {
  const meta = FORCE_TOOL_INTENT_MAP[forceTool];
  if (!meta) return null;
  return {
    type: meta.type,
    label: meta.label,
    confidence: 1,
    hint: meta.hint,
    reason: `force_tool:${forceTool}`,
    needsClarification: false,
    suggestedType: '',
    forcedTool: forceTool
  };
}

const CLARIFY_HINT = '当前用户意图不够明确。先用一句话和用户确认想要的产物（找图 / 查资料 / 改文档 / 出方案 / 出 PPT），再决定后续动作。在确认前不要调用任何任务工具，也不要默认走 research / strategy / doc_edit / ppt 流程。';

function buildClarifyIntent({ confidence = 0, reason = '', suggestedType = '' } = {}) {
  return {
    type: 'chat',
    label: '普通对话',
    confidence,
    hint: CLARIFY_HINT,
    reason,
    needsClarification: true,
    suggestedType: suggestedType || ''
  };
}

// 明显的闲聊输入：无附件/文档，文本短且不含任务动词，跳过 LLM 分类节省 1-2s
const CHAT_ACTION_VERBS = /[问查搜找生成改写出做搞帮看创建制作分析研究优化调整生产修改]/u;
const CHAT_TASK_NOUNS = /(ppt|PPT|幻灯片|演示文稿|图|图片|配图|背景图|效果图|素材|方案|策划|文档|稿子|提案|案例|趋势|竞品|数据)/u;
const CHAT_SHORTCIRCUIT_MAX_LEN = 30;

function isObviousChatMessage(text, documents, workspaceDocs, attachments) {
  if (documents.length || workspaceDocs.length || attachments.length) return false;
  if (text.length > CHAT_SHORTCIRCUIT_MAX_LEN) return false;
  if (CHAT_ACTION_VERBS.test(text)) return false;
  if (CHAT_TASK_NOUNS.test(text)) return false;
  return true;
}

async function detectTaskIntent(text = '', {
  documents = [],
  workspaceDocs = [],
  attachments = [],
  session = null,
  intentClassifier = null
} = {}) {
  const normalizedText = String(text || '').trim();

  // 完全没有输入：直接落到普通对话，不需要分类
  if (!normalizedText && !documents.length && !workspaceDocs.length && !attachments.length) {
    return {
      type: 'chat',
      label: '普通对话',
      confidence: 0.2,
      hint: '',
      reason: '',
      needsClarification: false,
      suggestedType: ''
    };
  }

  const priorIntentType = session?.taskIntent?.type || '';
  if (priorIntentType && priorIntentType !== 'chat' && isContinuationUtterance(normalizedText)) {
    const meta = toIntentMeta(priorIntentType);
    return {
      type: priorIntentType,
      label: meta.label,
      confidence: 0.9,
      hint: meta.hint || '',
      reason: 'continuation_of_prior_intent',
      needsClarification: false,
      suggestedType: ''
    };
  }

  // isObviousChatMessage（≤30字 + 无任务动词 → chat）这个启发式被废弃。
  //
  // 它的问题：阈值/动词表都很粗，会把"岚图，新车上市发布会"这种 24 字的任务输入也拽成
  // chat。一旦错分类，prompt 会说"建议工具：无 / 推荐步骤：直接回复"——LLM 失去工具
  // nudge 后容易把 function_call 当文本叙述（输出 [web_search] xxx 这种假语法），
  // 而且这个假语法会污染对话历史，后续轮模型会模仿继续输出。
  //
  // 全量走 LLM 分类成本可控：classifier 自己做了 (text, priorIntentType) 缓存，
  // 续接语短路（"继续/接着"）也在 classifier 里直接命中 prior intent 不调 LLM。
  // 真要省的只是首轮"你好"那种纯寒暄的 1-2s——可接受。

  const classifier = intentClassifier || classifyTaskIntentWithLLM;
  if (typeof classifier !== 'function') {
    return buildClarifyIntent({ reason: 'classifier_unavailable' });
  }

  let classified;
  try {
    classified = await classifier(normalizedText, { documents, workspaceDocs, attachments, session });
  } catch (error) {
    return buildClarifyIntent({ reason: error?.message || 'classifier_error' });
  }

  const conf = Number(classified?.confidence) || 0;
  const meta = toIntentMeta(classified?.type);

  // 低置信或模型自己说要澄清 → 不要硬猜，转为澄清对话
  const threshold = Number.parseFloat(process.env.INTENT_CONFIDENCE_THRESHOLD);
  const confThreshold = Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : 0.5;
  if (conf < confThreshold || classified?.needsClarification) {
    return buildClarifyIntent({
      confidence: conf,
      reason: classified?.reason || '',
      suggestedType: classified?.type || ''
    });
  }

  return {
    type: classified.type,
    label: meta.label,
    confidence: conf,
    hint: meta.hint || '',
    reason: classified.reason || '',
    needsClarification: false,
    suggestedType: ''
  };
}

async function prepareUserInputMessage(text, attachments = [], documents = [], session, onEvent, workspaceDocs = [], forceTool = '') {
  const normalizedText = String(text || '').trim();
  const parts = [];
  // 前端"+"按钮锁定的工具直达模式：跳过 LLM 意图分类，直接用强制意图
  const forcedIntent = forceTool ? buildForcedIntent(forceTool) : null;
  const detectedIntent = forcedIntent || await detectTaskIntent(normalizedText, { documents, workspaceDocs, attachments, session });
  const executionPlan = createExecutionPlan({
    text: normalizedText,
    intent: detectedIntent,
    session,
    documents,
    workspaceDocs,
    attachments
  });
  const taskSpec = createTaskSpec(executionPlan);
  const routeToolSequence = buildRouteToolSequence(taskSpec, {
    planItems: executionPlan?.planItems || [],
    workspaceDocs
  });

  session.taskIntent = detectedIntent;
  session.executionPlan = executionPlan;
  session.taskSpec = taskSpec;
  session.routeToolSequence = routeToolSequence;
  if (Array.isArray(executionPlan?.planItems)) {
    session.planItems = executionPlan.planItems;
  }
  onEvent('task_intent', {
    taskIntent: detectedIntent
  });
  onEvent('plan_update', {
    items: Array.isArray(executionPlan?.planItems) ? executionPlan.planItems : [],
    source: 'task_planner',
    mode: executionPlan?.mode || '',
    targetType: executionPlan?.targetType || ''
  });
  onEvent('execution_plan', { plan: executionPlan });
  onEvent('task_spec', { taskSpec });
  onEvent('route_update', {
    taskMode: taskSpec?.taskMode || '',
    primaryRoute: taskSpec?.primaryRoute || '',
    fallbackRoutes: taskSpec?.fallbackRoutes || [],
    toolSequence: routeToolSequence.map((step) => ({
      toolName: step.toolName,
      autoExecutable: step.autoExecutable,
      reason: step.reason || ''
    }))
  });

  // 注：detectedIntent.hint / executionPlan / taskSpec 不再注入 system prompt（见 brain.js
  // buildBrainSystemPrompt 注释）—— 让 brain LLM 看完整对话历史 + 工具定义自己决定怎么走，
  // 不被每轮重新分类的"建议工具=无"这类约束误导。这些字段仍然挂在 session 上供前端 UI 显示用。

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

  // 记下本轮是否是 "+ 工具直达" 模式（pill 在前端可持续亮，每轮发送都会带 forceTool 过来）
  session.forceTool = options.forceTool || '';
  const prepared = await prepareUserInputMessage(userMessage, options.attachments || [], options.documents || [], session, onEvent, options.workspaceDocs || [], session.forceTool);
  appendSessionAttachments(session, prepared.attachments);
  // 上一轮结束后回来的后台任务结果，先注入再 push 用户消息
  drainPendingBackgroundInjects(session);
  session.messages.push({
    role: 'user',
    content: prepared.content,
    ...(prepared.attachments.length ? { attachments: prepared.attachments } : {})
  });
  session.status = 'running';
  session.stopRequested = false;
  session.doneEmitted = false;
  session._softFailAttempted = false; // 每个新用户回合都有一次软失败兜底机会
  session._compressAttempted = false; // 每个新用户回合都允许一次 context length 自救
  session._invalidArgsRecovered = false; // 每回合一次清坏 tool_call 自救
  await runAutoRoutePrelude(session, onEvent, options);
  await runLoop(session, onEvent);
}

/**
 * 用户回答了 ask_user 的问题，恢复循环
 */
async function resume(session, userReply, onEvent, options = {}) {
  // resume 时复用 session 上已锁定的 forceTool（clarification 回答不应丢失工具模式）
  const forceTool = options.forceTool || session.forceTool || '';
  session.forceTool = forceTool;
  const prepared = await prepareUserInputMessage(userReply, options.attachments || [], options.documents || [], session, onEvent, options.workspaceDocs || [], forceTool);
  appendSessionAttachments(session, prepared.attachments);
  // resume 前先把 pending 后台任务结果注入（顺序：背景任务在前，用户回复 / tool result 在后）
  drainPendingBackgroundInjects(session);
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
    // 关键节点立即落盘：clarification 已被回答，DB 里残留的 pendingToolCallId
    // 必须立即清掉，否则崩溃恢复时会以为还在等用户回答。
    try { agentSession.flushAgentState(session.sessionId, { immediate: true }); } catch {}
  }

  // 把用户的回答补到 askedQuestions 最后一条 pending 记录上
  if (Array.isArray(session.askedQuestions) && session.askedQuestions.length) {
    const lastAsk = session.askedQuestions[session.askedQuestions.length - 1];
    if (lastAsk && lastAsk.answer == null) {
      lastAsk.answer = String(prepared.content || '').trim().slice(0, 200);
      lastAsk.answeredAt = new Date().toISOString();
    }
  }
  session.status = 'running';
  session.stopRequested = false;
  session.doneEmitted = false;
  session._softFailAttempted = false;
  session._compressAttempted = false; // 每个新用户回合都允许一次 context length 自救
  session._invalidArgsRecovered = false; // 每回合一次清坏 tool_call 自救
  session._directReplyRecovered = false; // 每回合一次 direct_reply 空响应兜底

  // 清理上一轮的"不要调用任何工具"系统注入：那是上轮 LLM 软失败时的临时纾解
  // 指令，本轮新用户输入到了，那个限制不该跨回合粘住。否则后续每一轮 brain 都
  // 看到"不要再调用任何工具"会一直只 narrate 不调工具——典型卡死表现：用户
  // 让进 run_strategy / build_ppt 都被解读成"我用文本回应就行"。
  if (Array.isArray(session.messages) && session.messages.length) {
    const before = session.messages.length;
    session.messages = session.messages.filter((m) => !m._softFailInject);
    const removed = before - session.messages.length;
    if (removed > 0) {
      console.log(`[BrainAgent] 新用户回合开始，清理 ${removed} 条 _softFailInject 历史`);
    }
  }

  await runAutoRoutePrelude(session, onEvent, options);
  await runLoop(session, onEvent);
}

// MAX_TURNS 用满后的强制文本收尾。
// 在 messages 后注入一条 system 指令 + tool_choice='none' 强制 LLM 只能产出文本，
// 让用户拿到一份"我做到这步、剩什么、建议怎么继续"的阶段性总结，而不是被静默 idle。
async function runForcedTextSummary(session, onEvent) {
  const FORCED_SUMMARY_TIMEOUT_MS = 25_000;

  session.messages.push({
    role: 'user',
    content: `[系统注入｜行动预算耗尽] 你已经连续推进了 ${MAX_TURNS} 步还没自然收敛。现在只能用文本回答，不要再调用任何工具。请基于当前对话和已执行工具的结果，给用户一段简短的阶段性总结：\n1. 目前已完成的关键动作（1-2 句）\n2. 还差什么、为什么没继续推（1-2 句）\n3. 下一步具体建议（用户该让你做 A 还是 B，列 1-2 个明确的下一步）\n字数控制在 200 字内。`,
    _softFailInject: true
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new TimeoutError('forced_summary', FORCED_SUMMARY_TIMEOUT_MS)), FORCED_SUMMARY_TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();
  const stopWatchdog = setInterval(() => {
    if (isStopRequested(session)) ac.abort('user_stop');
  }, STOP_POLL_INTERVAL_MS);
  if (typeof stopWatchdog.unref === 'function') stopWatchdog.unref();
  session._currentLlmAbort = ac;

  const filter = new ThinkFilter();
  let fullText = '';
  let hasStreamed = false;
  try {
    const result = await callMinimaxWithToolsStream(
      buildMessages(session),
      TOOL_DEFINITIONS,
      {
        runtimeKey: session.apiKeys.minimaxApiKey,
        minimaxModel: session.apiKeys.minimaxModel,
        maxTokens: 800,
        temperature: 0.5,
        tool_choice: 'none', // 关键：禁止再调工具
        signal: ac.signal
      },
      (chunk) => {
        if (chunk.type !== 'text_delta') return;
        const clean = filter.push(chunk.delta);
        if (clean) {
          fullText += clean;
          if (!hasStreamed) hasStreamed = true;
          onEvent('text_delta', { delta: clean });
        }
      }
    );
    const tail = filter.flush();
    if (tail) {
      fullText += tail;
      onEvent('text_delta', { delta: tail });
    }
    if (hasStreamed || tail) onEvent('text_end', {});

    // 优先用 stream 里累积的可见文本；如果模型走的是 non-stream 通道，回退取 result
    const finalText = (fullText.trim() || (result?.message?.content || '').trim());
    if (finalText) {
      session.messages.push({
        role: 'assistant',
        content: finalText,
        _forcedSummary: true
      });
    }
  } finally {
    clearTimeout(timer);
    clearInterval(stopWatchdog);
    if (session._currentLlmAbort === ac) session._currentLlmAbort = null;
  }
}

// 普通问答路径：意图分类已经判定为 direct_reply 时，不允许模型再调用工具。
// 否则像“你咋知道的？”这种轻量追问会被历史任务状态牵着走，误触发 ask_user /
// research / strategy，用户侧看起来就是一条普通消息卡进任务流。
async function runDirectReplyOnly(session, onEvent) {
  const DIRECT_REPLY_TIMEOUT_MS = 30_000;

  onEvent('thinking', {});

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new TimeoutError('direct_reply', DIRECT_REPLY_TIMEOUT_MS)), DIRECT_REPLY_TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();
  const stopWatchdog = setInterval(() => {
    if (isStopRequested(session)) ac.abort('user_stop');
  }, STOP_POLL_INTERVAL_MS);
  if (typeof stopWatchdog.unref === 'function') stopWatchdog.unref();
  session._currentLlmAbort = ac;

  const filter = new ThinkFilter();
  let fullText = '';
  let hasStreamed = false;
  try {
    const result = await callMinimaxWithToolsStream(
      buildMessages(session),
      TOOL_DEFINITIONS,
      {
        runtimeKey: session.apiKeys.minimaxApiKey,
        minimaxModel: session.apiKeys.minimaxModel,
        maxTokens: 1200,
        temperature: 0.6,
        tool_choice: 'none',
        signal: ac.signal
      },
      (chunk) => {
        if (chunk.type !== 'text_delta') return;
        const clean = filter.push(chunk.delta);
        if (clean) {
          fullText += clean;
          hasStreamed = true;
          onEvent('text_delta', { delta: clean });
        }
      }
    );
    const tail = filter.flush();
    if (tail) {
      fullText += tail;
      onEvent('text_delta', { delta: tail });
    }
    if (hasStreamed || tail) onEvent('text_end', {});

    let finalText = (fullText.trim() || (result?.message?.content || '').trim());

    // direct_reply 也会撞空响应陷阱：classifier 把"整体方案预算大概多少"这种看
    // 起来像 chat 的事实问题判 chat low-conf → wrapper 转 clarify → 进 direct_reply。
    // 此时 LLM 拿到的还是 strategy 完整对话历史，但被 tool_choice='none' 锁了，可能
    // 直接静默吐 \n\n\n 退出。runLoop 主路径有兜底重试，direct_reply 路径之前没有，
    // 用户表现就是发了消息但 brain 一句话没说就 idle。这里加一次强制收尾重试：
    // 用 nudge 注入再调一次，仍 tool_choice='none'。
    if (!finalText && !session._directReplyRecovered) {
      session._directReplyRecovered = true;
      console.warn('[BrainAgent] direct_reply 收到空响应，注入 nudge 重试一次');
      onEvent('tool_progress', { message: 'AI 沉默了一下，让我再问一次...' });
      session.messages.push({
        role: 'user',
        content: '系统提示：你刚才一句话都没说就把控制权交回来了，用户那边是空白等待。请基于当前对话状态直接给用户一段实质性回复（解释、阶段性结论、下一步建议都行），不要静默结束。'
      });
      try {
        const retry = await callMinimaxWithToolsStream(
          buildMessages(session),
          TOOL_DEFINITIONS,
          {
            runtimeKey: session.apiKeys.minimaxApiKey,
            minimaxModel: session.apiKeys.minimaxModel,
            maxTokens: 1200,
            temperature: 0.6,
            tool_choice: 'none',
            signal: ac.signal
          },
          (chunk) => {
            if (chunk.type !== 'text_delta') return;
            const clean = filter.push(chunk.delta);
            if (clean) {
              fullText += clean;
              hasStreamed = true;
              onEvent('text_delta', { delta: clean });
            }
          }
        );
        const tail2 = filter.flush();
        if (tail2) {
          fullText += tail2;
          onEvent('text_delta', { delta: tail2 });
        }
        if (hasStreamed || tail2) onEvent('text_end', {});
        finalText = (fullText.trim() || (retry?.message?.content || '').trim());
      } catch (retryErr) {
        console.warn('[BrainAgent] direct_reply 兜底重试失败:', retryErr.message);
      }
    }

    if (finalText) {
      session.messages.push({
        role: 'assistant',
        content: finalText
      });
    }
  } finally {
    clearTimeout(timer);
    clearInterval(stopWatchdog);
    if (session._currentLlmAbort === ac) session._currentLlmAbort = null;
  }
}

/**
 * ReAct 主循环
 */
async function runLoop(session, onEvent) {
  const loopTracker = {}; // "toolName:argsHash" → 调用次数
  const toolNameCounts = {}; // "toolName" → 调用次数（不区分参数）
  let emptyResponseRecovered = false; // 本轮已注入 nudge 兜底，避免死循环
  let turn = 0;

  // 单轮调用次数硬上限（不区分参数）：防止 brain 同一类工具失控刷调用，
  // context 雪球+LLM 超时连锁触发软失败兜底。strategy 流程典型踩坑：
  //   update_brief → web_search × 5+ → context blow up → LLM fail
  // 触达上限后给 brain 注入 tool_result 错误并塞一句强 nudge 让其收敛。
  const TOOL_NAME_LIMITS = {
    web_search: 4,    // 4 次散搜够用，再多基本是 brain 跳过 challenge_brief 在硬撑
    web_fetch: 3,     // 深读 ≤3 个页面够了，更多说明 brain 选 URL 没收敛
    search_images: 4
  };

  if (session.taskSpec?.primaryRoute === 'direct_reply') {
    try {
      await runDirectReplyOnly(session, onEvent);
      session.status = 'idle';
    } catch (err) {
      if (isStopRequested(session)) {
        session.status = 'idle';
        return;
      }
      onEvent('error', {
        message: `AI 调用失败：${err.message}`,
        reason: err.message,
        stage: 'direct_reply',
        retryable: true
      });
      session.status = 'failed';
    }
    if (session.status === 'idle' && !session.doneEmitted) {
      session.doneEmitted = true;
      onEvent('done', {
        mode: 'brain',
        taskIntent: session.taskIntent || null,
        brief: session.brief || null,
        executionPlan: session.executionPlan || null,
        taskSpec: session.taskSpec || null,
        planItems: Array.isArray(session.planItems) ? session.planItems : [],
        hasPlan: !!session.bestPlan,
        score: session.bestScore || 0,
        backgroundPending: session.backgroundTasks?.size || 0
      });
    }
    return;
  }

  for (turn = 0; turn < MAX_TURNS; turn++) {
    if (isStopRequested(session)) {
      session.status = 'idle';
      return;
    }

    // 推送 thinking 事件
    onEvent('thinking', {});

    let choice;
    console.log(`[BrainAgent] turn=${turn} 开始 LLM 调用，messages=${session.messages.length}`);

    // 跨 attempt 共享：失败/abort 时保留最后一次 attempt 已流式的可见文本，
    // 让 caller 在所有 retry 用尽后还能把"半截 assistant 回复"补回 messages，
    // 避免前端已 SSE 渲染过的内容在 session.messages 里完全消失（状态不一致）。
    let lastStreamedText = '';

    // 单次 attempt：建独立 AbortController + watchdog + 流式解析。失败抛错给 retryLlmCall。
    const attemptOnce = async () => {
      // 每次新 attempt 重置流式累积（上一次失败的半截不该拼到这次成功的回复前面）
      lastStreamedText = '';

      const llmAc = new AbortController();
      session._currentLlmAbort = llmAc;
      const llmStartedAt = Date.now();
      let lastChunkAt = Date.now();
      let chunkCount = 0;
      const llmWatchdog = setInterval(() => {
        if (isStopRequested(session)) { llmAc.abort('user_stop'); return; }
        const totalElapsed = Date.now() - llmStartedAt;
        if (totalElapsed > LLM_TOTAL_BUDGET_MS) {
          console.warn(`[BrainAgent] LLM 调用整体超时（${totalElapsed}ms > ${LLM_TOTAL_BUDGET_MS}ms），abort`);
          llmAc.abort(new TimeoutError('llm_total_budget', LLM_TOTAL_BUDGET_MS));
          return;
        }
        const idle = Date.now() - lastChunkAt;
        if (idle > LLM_STREAM_IDLE_MS) {
          console.warn(`[BrainAgent] LLM 流空闲超时（${idle}ms > ${LLM_STREAM_IDLE_MS}ms），abort`);
          llmAc.abort(new TimeoutError('llm_stream_idle', LLM_STREAM_IDLE_MS));
        }
      }, STOP_POLL_INTERVAL_MS);
      if (typeof llmWatchdog.unref === 'function') llmWatchdog.unref();

      const filter = new ThinkFilter();
      let hasStreamedText = false;

      try {
        const result = await callMinimaxWithToolsStream(
          buildMessages(session),
          TOOL_DEFINITIONS,
          {
            runtimeKey: session.apiKeys.minimaxApiKey,
            minimaxModel: session.apiKeys.minimaxModel,
            maxTokens: 4096,
            temperature: 0.7,
            signal: llmAc.signal
          },
          (chunk) => {
            lastChunkAt = Date.now();
            chunkCount++;
            if (chunk.type !== 'text_delta') return;
            const clean = filter.push(chunk.delta);
            if (clean) {
              lastStreamedText += clean;
              if (!hasStreamedText) hasStreamedText = true;
              onEvent('text_delta', { delta: clean });
            }
          }
        );
        const tail = filter.flush();
        if (tail) {
          lastStreamedText += tail;
          onEvent('text_delta', { delta: tail });
        }
        if (hasStreamedText || tail) onEvent('text_end', {});
        console.log(`[BrainAgent] turn=${turn} LLM 完成，chunks=${chunkCount}，elapsed=${Date.now() - llmStartedAt}ms，tool_calls=${result?.message?.tool_calls?.length || 0}`);
        return result;
      } catch (err) {
        // 抛出前抢救一下 ThinkFilter 缓冲里没 flush 完的非 think 内容
        try {
          const tail = filter.flush();
          if (tail) lastStreamedText += tail;
        } catch {}
        // 超时错误统一加可读信息
        if (err instanceof TimeoutError || err?.code === 'TIMEOUT') {
          const reason = llmAc.signal.reason;
          if (reason instanceof TimeoutError && reason.message?.includes('llm_total_budget')) {
            err.message = `LLM 调用整体超时（>${LLM_TOTAL_BUDGET_MS / 1000}s）`;
          } else {
            err.message = `LLM 流响应超时（${LLM_STREAM_IDLE_MS / 1000}s 无新内容）`;
          }
        }
        throw err;
      } finally {
        clearInterval(llmWatchdog);
        if (session._currentLlmAbort === llmAc) session._currentLlmAbort = null;
      }
    };

    const retryAc = new AbortController();
    const retryStopWatchdog = setInterval(() => {
      if (isStopRequested(session)) retryAc.abort('user_stop');
    }, STOP_POLL_INTERVAL_MS);
    if (typeof retryStopWatchdog.unref === 'function') retryStopWatchdog.unref();
    session._currentLlmAbort = retryAc;

    try {
      choice = await retryLlmCall(attemptOnce, {
        signal: retryAc.signal,
        onAttempt: ({ attempt, total }) => {
          if (attempt > 0) console.log(`[BrainAgent] turn=${turn} LLM attempt ${attempt + 1}/${total}`);
        },
        onRetry: ({ attempt, error, waitMs }) => {
          onEvent('tool_progress', { message: `网络/服务异常 (${error.message})，${Math.round(waitMs / 1000)}s 后重试 (${attempt + 2})...` });
        }
      });
      // LLM 成功响应 → 重置跨回合连续失败计数（熔断器）
      session._hardFailCount = 0;
    } catch (err) {
      console.error('[BrainAgent] LLM 调用失败（重试已用尽）:', err.message);
      if (isStopRequested(session)) {
        persistPartialAssistantText(session, lastStreamedText, 'user_stop');
        session.status = 'idle';
        return;
      }

      // ── 洞 1 修复：context length exceeded 自救：主动压缩历史后重试 ──
      const errClsEarly = classifyLlmError(err);
      if (errClsEarly === 'retryable_compress' && !session._compressAttempted) {
        session._compressAttempted = true;
        const compressed = compressSessionMessagesForRecovery(session);
        if (compressed) {
          console.warn(`[BrainAgent] turn=${turn} context 太长，已自动压缩历史，重试本轮`);
          onEvent('tool_progress', { message: '上下文太长，已自动压缩历史后重试...' });
          continue; // 重新进入本轮
        }
        console.warn('[BrainAgent] context 太长但消息不足以压缩，落到 L2 软失败');
      }

      // ── 400 invalid function arguments：清理历史中的坏 tool_call 后重试 ──
      // 之前限制 `turn === 0` 太严，中后期 LLM 同样可能产出非法 args（如长结构化
      // 字段被截断）。改为本回合一次性自救：用 _invalidArgsRecovered flag 防死循环。
      const is400InvalidArgs = /400.*invalid.*function|invalid.*arguments.*json|2013/i.test(err.message);
      if (is400InvalidArgs && !session._invalidArgsRecovered) {
        console.warn(`[BrainAgent] turn=${turn} 检测到 tool_call arguments 非法，清理历史后重试...`);
        const msgs = session.messages;
        let lastAssistIdx = -1;
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'assistant' && Array.isArray(msgs[i].tool_calls)) {
            lastAssistIdx = i;
            break;
          }
        }
        if (lastAssistIdx >= 0) {
          const badIds = new Set(msgs[lastAssistIdx].tool_calls.map(tc => tc.id));
          session.messages = msgs.filter((m, i) => {
            if (i === lastAssistIdx) return false;
            if (m.role === 'tool' && badIds.has(m.tool_call_id)) return false;
            return true;
          });
          session._invalidArgsRecovered = true;
          console.warn(`[BrainAgent] 已移除 index=${lastAssistIdx} 的 tool_calls，继续重试`);
          continue;
        }
      }

      // ── L2 软失败兜底：transport 重试用尽，但本轮还没尝试过软失败模式 ──
      const errCls = classifyLlmError(err);
      if (errCls !== 'fatal' && errCls !== 'user_abort' && !session._softFailAttempted) {
        session._softFailAttempted = true;

        // ─ L2.a 优先尝试跨厂商兜底（deepseek-chat） ──
        // 主模型已经失败，再用同一 provider 大概率连续失败；切独立 provider 成功率显著高
        if (canUseFallbackProvider(session)) {
          console.warn('[BrainAgent] 进入跨厂商兜底（deepseek-chat）');
          onEvent('tool_progress', { message: '主模型异常，切换到备用模型给你一个交代...' });
          try {
            const fallbackText = await runCrossProviderFallback(session, err, onEvent);
            if (fallbackText && fallbackText.trim()) {
              // 成功：把回答写进对话历史（标记来自 fallback），结束本轮
              session.messages.push({
                role: 'assistant',
                content: fallbackText,
                _crossProviderFallback: true
              });
              session._hardFailCount = 0; // fallback 给出交代也算"恢复"了，重置熔断
              session.status = 'idle';
              return;
            }
            console.warn('[BrainAgent] 跨厂商兜底返回空文本，退回 minimax 软失败');
          } catch (fallbackErr) {
            if (isStopRequested(session)) { session.status = 'idle'; return; }
            console.warn('[BrainAgent] 跨厂商兜底也失败:', fallbackErr.message);
            // 落到下面的 minimax 软失败逻辑
          }
        }

        // ─ L2.b 退回 minimax 软失败：把错误作为系统注入消息推回，让模型用文本给用户一个交代 ──
        session.messages.push({
          role: 'user',
          content: `[系统注入｜上一次调用失败] AI 调用失败：${err.message}\n请基于当前对话和已有信息，直接给用户一段简短的阶段性总结或下一步建议。不要再调用任何工具。`,
          _softFailInject: true
        });
        console.warn(`[BrainAgent] 进入 minimax 软失败兜底（errCls=${errCls}）`);
        onEvent('tool_progress', { message: 'AI 调用失败，让模型给你一个阶段性交代...' });
        continue; // 重新进入本轮循环跑兜底
      }

      // 真正的 hard fail —— 给前端一份 "可重试 + 最后一条用户消息" 的 payload，
      // 让用户能一键 retry，不必重新输入。fatal 类（401/quota）则不可重试。
      // 同时维护跨回合熔断器：连续失败 ≥ 3 次时附加更强的提示，让用户停一下别硬撞墙。
      // 半截 assistant 文本（已经 SSE 推给前端的）也要补进 messages，避免历史不一致
      persistPartialAssistantText(session, lastStreamedText, 'hard_fail');
      session._hardFailCount = (session._hardFailCount || 0) + 1;
      const finalCls = classifyLlmError(err);
      const lastUserMsg = [...session.messages]
        .reverse()
        .find(m => m.role === 'user' && !m._backgroundInject && !m._softFailInject);
      const baseMsg = `AI 调用失败：${err.message}`;
      const nextAction = buildNextActionHint(finalCls, err);
      const fullMsg = session._hardFailCount >= 3
        ? `${baseMsg}\n\n接下来：${nextAction}\n\n⚠️ 系统已连续 ${session._hardFailCount} 次调用失败。这往往不是某条消息本身的问题，请稍等几分钟让上游服务恢复，或重启 dev:api 排查。`
        : `${baseMsg}\n\n接下来：${nextAction}`;
      onEvent('error', {
        message: fullMsg,
        reason: err.message,
        nextAction,
        retryable: finalCls !== 'fatal' && finalCls !== 'user_abort',
        errorClass: finalCls,
        consecutiveFailures: session._hardFailCount,
        lastUserMessage: lastUserMsg?.content || ''
      });
      session.status = 'failed';
      return;
    } finally {
      clearInterval(retryStopWatchdog);
      if (session._currentLlmAbort === retryAc) session._currentLlmAbort = null;
    }

    if (isStopRequested(session)) {
      // LLM 已完整返回但 stop 信号同时到达：把已完成的 assistant 内容先入历史再退出，
      // 否则前端 SSE 已渲染但 messages 里凭空消失会造成下一轮 brain 看不到自己刚说过的话
      const partial = (choice?.message?.content || '').trim();
      if (partial) {
        session.messages.push({
          role: 'assistant',
          content: partial,
          ...(choice.message.tool_calls ? { tool_calls: choice.message.tool_calls } : {})
        });
      }
      session.status = 'idle';
      return;
    }

    const { message } = choice;

    // 空响应陷阱：brain LLM 偶尔会输出"空 content + 无 tool_calls"就交回控制权
    // （观测：route_auto write_todos 之后 LLM 把第一个 tool_call 当成已完成标记，
    // 自己什么也不说就 stop）。前端表现是空 narration，用户必须打"?"才能续上。
    // 兜底：本轮注入一次 nudge 让 brain 再来一遍，避免静默吞回复。
    const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    const contentText = (message.content || '').trim();
    if (!hasToolCalls && !contentText && !emptyResponseRecovered) {
      emptyResponseRecovered = true;
      console.warn(`[BrainAgent] turn=${turn} 检测到空响应 + 无工具调用，注入 nudge 重试`);
      onEvent('tool_progress', { message: 'AI 沉默了一下，让我再问一次...' });
      session.messages.push({
        role: 'user',
        content: '系统提示：你刚才一句话都没说就交出了控制权，用户那边是空白等待。请基于当前对话状态，要么继续调用合适的工具推进任务，要么直接给用户一段实质性回复（澄清、阶段性结论、下一步建议都行），不要静默结束这一轮。'
      });
      continue;
    }

    // 存储 assistant 消息（含 tool_calls 或纯文本）
    session.messages.push({
      role: 'assistant',
      content: message.content || null,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {})
    });

    // 没有工具调用 → Brain 决定自然结束本轮
    if (!hasToolCalls) {
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

      // ── 单工具名硬上限（防搜索/抓页失控）──────────────────────
      // 越过 limit 时给本次 tool_call 直接返 error，brain 看见 error 会停下来收敛。
      // 不再继续转给真正的工具执行，避免无谓消耗 + 进一步堆 context。
      const nameLimit = TOOL_NAME_LIMITS[toolName];
      if (nameLimit) {
        toolNameCounts[toolName] = (toolNameCounts[toolName] || 0) + 1;
        if (toolNameCounts[toolName] > nameLimit) {
          console.warn(`[BrainAgent] ${toolName} 本轮已调 ${toolNameCounts[toolName]} 次（上限 ${nameLimit}），强制收敛`);
          const display = getToolDisplay(toolName, args);
          onEvent('tool_call', { tool: toolName, display, toolCallId: toolCall.id });
          const overLimitResult = {
            success: false,
            error: `本轮 ${toolName} 调用已达上限（${nameLimit} 次）。请基于已经搜到的资料直接收敛——继续推进 challenge_brief / propose_concept / update_brief 等下一步动作，或者用文字给用户阶段性总结。不要再调用 ${toolName}。`
          };
          onEvent('tool_result', buildToolResultEvent(toolName, overLimitResult));
          session.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: truncateToolResult(toolName, JSON.stringify(overLimitResult))
          });
          continue;
        }
      }

      // ── ask_user：特殊处理，暂停循环 ──────────────────────────
      if (toolName === 'ask_user') {
        // 质量体检：拦住浅问（缺 description、只有 1 个 option、suggestion 没带 options 等）
        const validation = validateAskUserArgs(args);
        if (!validation.valid) {
          console.warn(`[BrainAgent] ask_user 调用被拒：${validation.error}`);
          onEvent('tool_call', { tool: toolName, display: getToolDisplay(toolName, args), toolCallId: toolCall.id });
          const toolResult = { success: false, error: validation.error, guidance: validation.guidance };
          onEvent('tool_result', buildToolResultEvent(toolName, toolResult));
          session.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: truncateToolResult(toolName, JSON.stringify(toolResult))
          });
          session.messages.push({
            role: 'user',
            content: `系统提示：你上一次的 ask_user 调用不合格（${validation.error}）。${validation.guidance}\n请重新构造 ask_user 调用，不要换成普通文本发问。`
          });
          continue;
        }

        pauseForAskUser(session, onEvent, toolCall.id, args, turn);
        return; // 暂停，等待 resume() 被调用
      }

      // ── challenge_brief 软护栏：strategy 流程下，update_brief 之后、web_search 之前，
      //     brain 应调一次 challenge_brief 扫硬伤（看 prompt "硬性约束"那一节）。
      //     实测 brain 偶尔会跳过它直接堆 web_search，结果 brief 红旗没暴露 + 5 轮搜
      //     完撞 context 上限。这里在第一次调 web_search 时检查：brief 存在但
      //     challenge_brief 没跑过 → 给本次调用返 error，brain 看到 error 会改调
      //     challenge_brief。下一次 web_search 不再拦，让 brain 正常推进。
      if (toolName === 'challenge_brief') {
        session._challengeBriefCalled = true;
      }
      if (
        toolName === 'web_search'
        && session.brief
        && !session._challengeBriefCalled
        && !session._challengeBriefNudged
        && session.taskSpec?.taskMode === 'strategy'
      ) {
        session._challengeBriefNudged = true;
        const display = getToolDisplay(toolName, args);
        onEvent('tool_call', { tool: toolName, display, toolCallId: toolCall.id });
        const nudgeResult = {
          success: false,
          error: '本轮是 strategy 流程且 brief 已就位，按规则你必须先调用一次 challenge_brief 扫硬伤（资深总监视角看预算/目标/调性矛盾），再继续 web_search。请把这次 web_search 改成 challenge_brief 调用。这次 nudge 只发一次，下次 web_search 会正常执行。'
        };
        onEvent('tool_result', buildToolResultEvent(toolName, nudgeResult));
        session.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: truncateToolResult(toolName, JSON.stringify(nudgeResult))
        });
        continue;
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
          content: truncateToolResult(toolName, JSON.stringify(toolResult))
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

      const { result: toolResult, status: toolStatus } = await runToolWithBudget({
        session, onEvent, toolCallId: toolCall.id, toolName, args
      });

      if (toolStatus === 'aborted') {
        session.status = 'idle';
        return;
      }

      if (isStopRequested(session)) {
        session.status = 'idle';
        return;
      }

      onEvent('tool_result', buildToolResultEvent(toolName, toolResult));

      // 把工具结果存入对话历史。
      // 在 push 时即截断（按 TOOL_TRUNCATION_CONFIG）：
      //  - 防止全量 payload 一直驻留内存 / 被持久化进 sqlite
      //  - 后续 buildMessages 里的 truncate 仍作为幂等兜底
      session.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: truncateToolResult(toolName, JSON.stringify(toolResult))
      });

      // propose_concept 成功后不再等下一轮 LLM 来构造 ask_user。
      // 这一步是确定性 UI 闸口：工具已把 A/B/C 方向渲染成卡片，后端可直接
      // 暂停并让用户挑方向，避免卡在"工具完成 → 模型再调用 ask_user"的交接处。
      if (toolName === 'propose_concept' && toolResult?.success) {
        const askArgs = buildConceptSelectionArgs(session);
        if (askArgs) {
          const askValidation = validateAskUserArgs(askArgs);
          if (askValidation.valid) {
            const askToolCallId = `auto_ask_concept_${Date.now()}`;
            session.messages.push({
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: askToolCallId,
                type: 'function',
                function: {
                  name: 'ask_user',
                  arguments: JSON.stringify(askArgs)
                }
              }]
            });
            pauseForAskUser(session, onEvent, askToolCallId, askArgs, turn);
            return;
          }
          console.warn(`[BrainAgent] 自动创意方向 ask_user 构造失败：${askValidation.error}`);
        }
      }

      // build_ppt 内部已发出 done 事件，直接退出循环
      if (toolName === 'build_ppt' && toolResult?.success) {
        session.status = 'idle';
        return;
      }
    }
  }

  if (session.status === 'running') {
    // 跑满了 MAX_TURNS 还没自然结束（模型一直在调工具不收敛） ——
    // 不再静默 idle，强制让 brain 用纯文本（tool_choice='none'）收尾给用户一份阶段性总结
    if (turn === MAX_TURNS) {
      console.warn(`[BrainAgent] 跑满 MAX_TURNS=${MAX_TURNS} 仍未收敛，强制文本总结`);
      try {
        await runForcedTextSummary(session, onEvent);
      } catch (e) {
        console.warn('[BrainAgent] 强制文本总结失败，回退静态提示:', e.message);
        onEvent('text', {
          text: `本轮已经迭代 ${MAX_TURNS} 步还没收敛，先停一下避免无限推进。\n\n建议你直接告诉我下一步重点，或回复"汇总当前进展"让我整理结论。`
        });
      }
    }
    session.status = 'idle';
  }

  if (session.status === 'idle' && !session.doneEmitted) {
    session.doneEmitted = true;
    // backgroundPending 让前端知道：brain 主循环结束了，但还有后台工具在跑
    // （典型场景：propose_concept / run_strategy 因 45s 无新进展被转后台）。
    // 前端拿到 >0 时不应该关 SSE 也不应该解锁输入框，否则后台 artifact /
    // clarification 推回来用户永远收不到 → 看起来像"卡住没反应"。
    onEvent('done', {
      mode: 'brain',
      taskIntent: session.taskIntent || null,
      brief: session.brief || null,
      executionPlan: session.executionPlan || null,
      taskSpec: session.taskSpec || null,
      planItems: Array.isArray(session.planItems) ? session.planItems : [],
      hasPlan: !!session.bestPlan,
      score: session.bestScore || 0,
      backgroundPending: session.backgroundTasks?.size || 0
    });
  }
}

// 单条 tool_result SSE 事件里 `details` 的最大体积。
// 之前 details 全量 pretty-print，长 web_search / read_notes 一条几十 KB，
// 80 条 backlog 重连 replay 体积太大。截到 5KB 既够前端展开调试，又不爆 SSE。
const TOOL_RESULT_DETAILS_CAP = 5000;

function buildToolResultEvent(toolName, toolResult) {
  const safeResult = toolResult && typeof toolResult === 'object' ? toolResult : { value: toolResult };
  let details = JSON.stringify(safeResult, null, 2);
  if (details.length > TOOL_RESULT_DETAILS_CAP) {
    details = details.slice(0, TOOL_RESULT_DETAILS_CAP)
      + `\n... [details 已截断，原始长度 ${details.length} 字符]`;
  }

  switch (toolName) {
    case 'generate_image':
      return {
        tool: toolName,
        ok: !!safeResult.success,
        summary: safeResult.success
          ? `图片已生成：${safeResult.intent || safeResult.prompt?.slice(0, 30) || ''}`
          : (safeResult.error || 'AI生图失败'),
        details
      };
    case 'search_images':
      return {
        tool: toolName,
        ok: !!safeResult.success,
        summary: safeResult.success
          ? `找到 ${safeResult.count || 0} 张图片`
          : (safeResult.error || '找图失败'),
        details
      };
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
          ? (safeResult.degraded
              ? `方案已生成（${safeResult.sectionCount || 0} 个章节，**降级兜底版**：模型结构化输出异常）并在右侧展示。回复时必须提示用户"这一版偏保守/兜底"，建议再跑一次或继续调整；不要复述方案内容。`
              : `方案已生成（${safeResult.sectionCount || 0} 个章节）并在右侧文档面板展示。回复时**不要**复述方案内容/亮点/章节（用户已看到），只用 1-2 句告诉用户方案好了，并询问下一步（出 PPT / 评审 / 继续改）。`)
          : (safeResult.error || '方案生成失败'),
        details
      };
    case 'review_strategy':
      return {
        tool: toolName,
        ok: !!safeResult.success,
        summary: safeResult.success
          ? `评审完成，得分 ${safeResult.score}${safeResult.passed ? '（通过）' : '（待优化）'}`
          : (safeResult.error || '评审失败'),
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

module.exports = {
  run,
  resume,
  detectTaskIntent,
  cancelAllBackgroundTasks,
  // 下面是内部 helper，仅供 scripts/smoke-* 和单元测试使用，请勿在产品逻辑里依赖
  __internal: {
    runToolWithBudget,
    enqueueBackgroundTask,
    drainPendingBackgroundInjects,
    formatBackgroundResult,
    stripToolCallHistory,
    canUseFallbackProvider,
    compressSessionMessagesForRecovery
  }
};
