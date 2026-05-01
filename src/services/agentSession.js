// Brain Agent 会话状态管理（内存存储）
const { v4: uuidv4 } = require('uuid');

const sessions = new Map();

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时无活动后清理
const MAX_SESSIONS   = 200;                  // 最多同时保留 200 个 session

// 后端权威字段持久化：debounced 500ms 同时支持 immediate flush。
// lazy require 避免 server 启动顺序耦合（agentSession 在 server.js 早期被引入）
const FLUSH_DEBOUNCE_MS = 500;
const flushTimers = new Map();   // sessionId -> Timeout
let _conversationStore = null;
function getConversationStore() {
  if (!_conversationStore) _conversationStore = require('./conversationStore');
  return _conversationStore;
}

// 哪些字段是"后端权威、需要落盘到 agent_state_json"。
// 不包括 apiKeys（密钥不持久化）/ sseClients（不可序列化）/ eventBacklog（仅运行期）/
// _currentLlmAbort 等内部 abort 句柄。
//
// session.messages（LLM API 格式）只在 status='waiting_for_user' 时落盘，作为
// /reply resurrect 的 resume context——前端 conversation_messages 存的是 UI 格式
// （role:'ai'/'user'/'system'），无法直接喂回 LLM；waiting_for_user 时正好是分支
// 决定点，写入这一刻的 messages 才能让 resume 接续 assistant tool_calls→tool 配对。
function snapshotAgentState(session) {
  if (!session) return null;
  const snapshot = {
    sessionId: session.sessionId,
    spaceId: session.spaceId || '',
    conversationId: session.conversationId || '',
    status: session.status,
    pendingToolCallId: session.pendingToolCallId || null,
    bestPlan: session.bestPlan || null,
    bestScore: session.bestScore ?? 0,
    userInput: session.userInput || null,
    brief: session.brief || null,
    taskIntent: session.taskIntent || null,
    executionPlan: session.executionPlan || null,
    taskSpec: session.taskSpec || null,
    routeToolSequence: Array.isArray(session.routeToolSequence) ? session.routeToolSequence : [],
    planItems: Array.isArray(session.planItems) ? session.planItems : [],
    askedQuestions: Array.isArray(session.askedQuestions) ? session.askedQuestions : [],
    docHtml: typeof session.docHtml === 'string' ? session.docHtml : '',
    docMarkdown: typeof session.docMarkdown === 'string' ? session.docMarkdown : '',
    forceTool: session.forceTool || '',
    updatedAt: session.updatedAt
  };
  if (session.status === 'waiting_for_user' && Array.isArray(session.messages)) {
    snapshot.resumeMessages = session.messages;
  } else {
    // 显式置 null（merge 语义会清掉旧值），避免 resume 完成后 DB 里残留过期 messages
    snapshot.resumeMessages = null;
  }
  return snapshot;
}

function flushAgentState(sessionId, { immediate = false } = {}) {
  const session = sessions.get(sessionId);
  if (!session || !session.conversationId) return;
  // 取消挂着的 debounce timer——本次同步落盘已覆盖
  const pending = flushTimers.get(sessionId);
  if (pending) {
    clearTimeout(pending);
    flushTimers.delete(sessionId);
  }
  if (!immediate) {
    const timer = setTimeout(() => {
      flushTimers.delete(sessionId);
      // 重新读 session（debounce 期间可能已被淘汰）
      const live = sessions.get(sessionId);
      if (!live || !live.conversationId) return;
      try {
        getConversationStore().patchAgentState(live.conversationId, snapshotAgentState(live));
      } catch (error) {
        console.warn('[agentSession] flush 失败:', sessionId, error.message);
      }
    }, FLUSH_DEBOUNCE_MS);
    timer.unref?.();
    flushTimers.set(sessionId, timer);
    return;
  }
  try {
    getConversationStore().patchAgentState(session.conversationId, snapshotAgentState(session));
  } catch (error) {
    console.warn('[agentSession] flush 失败:', sessionId, error.message);
  }
}

function markDirty(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || !session.conversationId) return;
  flushAgentState(sessionId, { immediate: false });
}

/**
 * 创建新会话
 * @param {{ apiKeys, spaceId, sessionId, conversationId }} opts
 */
function createSession({ apiKeys = {}, spaceId = '', sessionId: providedSessionId = '', conversationId = '' } = {}) {
  // 容量保护：超过上限时逐出最旧的 idle/failed session
  if (sessions.size >= MAX_SESSIONS) {
    const evictable = [...sessions.entries()]
      .filter(([, s]) => ['idle', 'failed', 'completed'].includes(s.status))
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    if (evictable.length > 0) {
      const [evictId, evictSession] = evictable[0];
      // evict 前最后一次 flush，避免在 LRU 淘汰时丢未落盘的状态
      if (evictSession.conversationId) {
        try { flushAgentState(evictId, { immediate: true }); } catch {}
      }
      const pending = flushTimers.get(evictId);
      if (pending) { clearTimeout(pending); flushTimers.delete(evictId); }
      for (const res of evictSession.sseClients) {
        try { res.end(); } catch {}
      }
      sessions.delete(evictId);
      console.warn('[agentSession] LRU evict 旧 session:', evictId, 'status=', evictSession.status);
    }
  }

  const sessionId = providedSessionId || `sess_${Date.now()}_${uuidv4().slice(0, 6)}`;
  const session = {
    sessionId,
    spaceId,
    conversationId: conversationId || '',  // 绑定到具体对话，防止 sessionId 被错误对话复用造成数据污染
    apiKeys,                  // { minimaxApiKey, deepseekApiKey, minimaxModel, tavilyApiKey, jinaApiKey }
    status: 'idle',           // idle | running | waiting_for_user | completed | failed
    messages: [],             // 完整对话历史（含 tool_calls / tool results）
    sseClients: [],           // SSE res 对象列表
    eventBacklog: [],         // 最近 SSE 事件，供晚连上的客户端回放
    pendingToolCallId: null,  // ask_user 暂停时记录 tool_call_id
    bestPlan: null,           // run_strategy 完成后存储最优方案
    bestScore: 0,
    userInput: null,          // 构建策划时使用的结构化输入
    stopRequested: false,     // 用户主动停止后，供执行循环尽快退出
    docMarkdown: '',
    docHtml: '',
    brief: null,              // 当前会话已确认/推断的任务简报
    taskIntent: null,         // 当前轮次识别出的任务意图
    executionPlan: null,      // 当前轮次生成的执行规划
    taskSpec: null,           // 当前轮次的任务规格与路由约束
    routeToolSequence: [],    // 当前 route 推荐的工具序列
    planItems: [],            // 当前任务计划
    attachments: [],          // 当前会话累计上传的图片
    researchStore: [],        // 累积所有 web_search 结果，供 run_strategy 强制引用
    askedQuestions: [],       // ask_user 历史：记录每次追问与用户回复，防止跨轮重复发问
    doneEmitted: false,       // 防止重复推送 done
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  sessions.set(sessionId, session);
  return session;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

/**
 * 在尚未绑定 conversationId 时绑定，已绑定则比较是否一致。
 * 用于防止 sessionId 被前端错误地用在另一个对话里 — 任何不匹配都会
 * 让调用方主动报错，避免静默把消息写到错误的对话。
 */
function bindConversation(session, conversationId) {
  if (!session) return false;
  if (!conversationId) return true;
  if (!session.conversationId) {
    session.conversationId = conversationId;
    return true;
  }
  return session.conversationId === conversationId;
}

function updateSession(sessionId, updates) {
  const session = sessions.get(sessionId);
  if (!session) return;
  Object.assign(session, updates, { updatedAt: Date.now() });
  markDirty(sessionId);
}

function addSseClient(sessionId, res) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.sseClients.push(res);

  // 内存 backlog 有内容就用内存（快路径，正常重连场景）；为空且绑定了 conversation
  // 则从 DB agent_events 表回放（崩溃复活场景，内存 backlog 已丢）。
  if (session.eventBacklog.length > 0) {
    for (const entry of session.eventBacklog) {
      try { res.write(entry.raw); } catch {}
    }
    return;
  }

  // skipDbReplay：/start 复用 session 启新一轮时已经把 eventBacklog 清空，但 DB
  // agent_events 还存着上一轮的全套事件。这种"启新轮"场景不应该 DB replay——否则
  // 上一轮的 tool_call / artifact 会被重新推到前端，伪装成本轮事件，前端把它们持
  // 久化到 conversation_messages，下一轮看到的工具卡片全是上一轮的（R1 搜的是 SU7、
  // R2 问 YU7，UI 显示 R2 也搜的 SU7）。
  // 用 skipDbReplay flag 区分：/start 设 true，addSseClient 消费一次后清掉。
  // 真正的"内存丢失从 DB 复活"场景（比如服务重启）不会走 /start 路径，flag 不会被设上。
  if (session._skipDbReplay) {
    session._skipDbReplay = false;
    return;
  }

  if (session.conversationId) {
    try {
      const events = getConversationStore().getAgentEvents(session.conversationId);
      for (const event of events) {
        const raw = `event: ${event.eventType}\ndata: ${event.payloadJson}\n\n`;
        try { res.write(raw); } catch {}
      }
    } catch (error) {
      console.warn('[agentSession] DB event 回放失败:', sessionId, error.message);
    }
  }
}

function removeSseClient(sessionId, res) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.sseClients = session.sseClients.filter(c => c !== res);
}

// SSE 事件分桶 cap：
//  - important: done / error / clarification / tool_call / tool_result / route_update /
//    text_end / task_intent / execution_plan / task_spec / background_done / plan_update /
//    artifact / doc_preview_updated / slide_added —— 重连客户端必须看到完整轨迹，cap 大一些
//  - trivial: tool_progress / thinking / text_delta / 其它高频流式事件
//    主要给"实时观感"，重连时丢一些不影响理解
//
// artifact 必须列为 important：concept_proposal / plan_doc / ppt_slides 这些"实际成果"
// 全靠 artifact 事件传到前端，不是 important 就不会写 DB。当 propose_concept / run_strategy
// 因预算超时被转后台、用户已断开 SSE 时，artifact 事件无法重发，结果是用户看到了 brain
// 主循环 done，但永远看不到方向卡片或策划文档——典型"任务跑完了 UI 没反应"假象。
const IMPORTANT_EVENT_TYPES = new Set([
  'done', 'error', 'clarification', 'tool_call', 'tool_result',
  'route_update', 'text_end', 'task_intent', 'execution_plan',
  'task_spec', 'background_done', 'plan_update',
  'artifact', 'doc_preview_updated', 'slide_added'
]);
const IMPORTANT_BACKLOG_CAP = 200;
const TRIVIAL_BACKLOG_CAP   = 60;

function isImportantEventType(eventType) {
  return IMPORTANT_EVENT_TYPES.has(eventType);
}

/**
 * 向所有订阅此会话的 SSE 客户端推送事件
 */
function pushEvent(sessionId, eventType, data) {
  const session = sessions.get(sessionId);
  if (!session) return;
  const payload = JSON.stringify({ ...data, timestamp: Date.now() });
  const raw = `event: ${eventType}\ndata: ${payload}\n\n`;
  const entry = { eventType, raw, createdAt: Date.now(), important: isImportantEventType(eventType) };
  session.eventBacklog.push(entry);

  // 按桶分别 cap：把超出 cap 的"那一类"老事件清掉，保留对方桶完整
  const importantCount = session.eventBacklog.filter(e => e.important).length;
  const trivialCount   = session.eventBacklog.length - importantCount;
  if (importantCount > IMPORTANT_BACKLOG_CAP || trivialCount > TRIVIAL_BACKLOG_CAP) {
    let dropImportant = Math.max(0, importantCount - IMPORTANT_BACKLOG_CAP);
    let dropTrivial   = Math.max(0, trivialCount - TRIVIAL_BACKLOG_CAP);
    session.eventBacklog = session.eventBacklog.filter(e => {
      if (e.important && dropImportant > 0) { dropImportant--; return false; }
      if (!e.important && dropTrivial > 0)  { dropTrivial--;   return false; }
      return true;
    });
  }

  for (const res of session.sseClients) {
    try {
      res.write(raw);
    } catch {
      // 客户端已断开，忽略
    }
  }

  // 落盘到 agent_events 表用于崩溃复活后的回放：所有 important 事件都写入；
  // trivial 事件（text_delta / tool_progress 等高频流式）只在内存 backlog，
  // 不进 DB——晚连客户端看不到中间帧无所谓，但拿到正确的状态轨迹是必须的。
  if (session.conversationId && entry.important) {
    try {
      getConversationStore().appendAgentEvent({
        conversationId: session.conversationId,
        sessionId,
        eventType,
        payload: { ...data, timestamp: entry.createdAt },
        important: true
      });
    } catch (error) {
      // best-effort：DB 写失败不阻断 SSE 实时推送
      console.warn('[agentSession] event 落盘失败:', sessionId, eventType, error.message);
    }
  }

  // 后端权威态变化的关键事件 immediate 落盘，其余事件触发 debounced flush。
  // clarification / done / error 是分支决定点（pendingToolCallId / status 已变），
  // 必须立即落盘，避免崩溃丢失分支状态。
  if (session.conversationId) {
    if (eventType === 'clarification' || eventType === 'done' || eventType === 'error') {
      flushAgentState(sessionId, { immediate: true });
    } else if (entry.important) {
      markDirty(sessionId);
    }
  }
}

function deleteSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  // 在删除前最后一次同步落盘，避免 evict 时丢未 flush 的状态
  if (session.conversationId) {
    try { flushAgentState(sessionId, { immediate: true }); } catch {}
  }
  const pending = flushTimers.get(sessionId);
  if (pending) { clearTimeout(pending); flushTimers.delete(sessionId); }
  for (const res of session.sseClients) {
    try { res.end(); } catch {}
  }
  sessions.delete(sessionId);
}

// 每 10 分钟清理超时且已结束的 session
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    const expired = now - session.updatedAt > SESSION_TTL_MS;
    const inactive = ['idle', 'failed', 'completed'].includes(session.status);
    if (expired && inactive) {
      // TTL 淘汰前同样最后一次 flush
      if (session.conversationId) {
        try { flushAgentState(id, { immediate: true }); } catch {}
      }
      const pending = flushTimers.get(id);
      if (pending) { clearTimeout(pending); flushTimers.delete(id); }
      for (const res of session.sseClients) {
        try { res.end(); } catch {}
      }
      sessions.delete(id);
    }
  }
}, 10 * 60 * 1000).unref(); // unref 使定时器不阻止进程退出

module.exports = {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  addSseClient,
  removeSseClient,
  pushEvent,
  bindConversation,
  flushAgentState,
  markDirty,
  snapshotAgentState
};
