// Brain Agent 会话状态管理（内存存储）
const { v4: uuidv4 } = require('uuid');

const sessions = new Map();

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时无活动后清理
const MAX_SESSIONS   = 200;                  // 最多同时保留 200 个 session

/**
 * 创建新会话
 * @param {{ apiKeys, spaceId, sessionId }} opts
 */
function createSession({ apiKeys = {}, spaceId = '', sessionId: providedSessionId = '' } = {}) {
  // 容量保护：超过上限时逐出最旧的 idle/failed session
  if (sessions.size >= MAX_SESSIONS) {
    const evictable = [...sessions.entries()]
      .filter(([, s]) => ['idle', 'failed', 'completed'].includes(s.status))
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    if (evictable.length > 0) {
      const [evictId, evictSession] = evictable[0];
      for (const res of evictSession.sseClients) {
        try { res.end(); } catch {}
      }
      sessions.delete(evictId);
    }
  }

  const sessionId = providedSessionId || `sess_${Date.now()}_${uuidv4().slice(0, 6)}`;
  const session = {
    sessionId,
    spaceId,
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
    planItems: [],            // 当前任务计划
    attachments: [],          // 当前会话累计上传的图片
    researchStore: [],        // 累积所有 web_search 结果，供 run_strategy 强制引用
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

function updateSession(sessionId, updates) {
  const session = sessions.get(sessionId);
  if (!session) return;
  Object.assign(session, updates, { updatedAt: Date.now() });
}

function addSseClient(sessionId, res) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.sseClients.push(res);
  for (const entry of session.eventBacklog) {
    try {
      res.write(entry.raw);
    } catch {
      // 忽略断连客户端
    }
  }
}

function removeSseClient(sessionId, res) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.sseClients = session.sseClients.filter(c => c !== res);
}

/**
 * 向所有订阅此会话的 SSE 客户端推送事件
 */
function pushEvent(sessionId, eventType, data) {
  const session = sessions.get(sessionId);
  if (!session) return;
  const payload = JSON.stringify({ ...data, timestamp: Date.now() });
  const raw = `event: ${eventType}\ndata: ${payload}\n\n`;
  session.eventBacklog.push({ eventType, raw, createdAt: Date.now() });
  if (session.eventBacklog.length > 80) {
    session.eventBacklog = session.eventBacklog.slice(-80);
  }
  for (const res of session.sseClients) {
    try {
      res.write(raw);
    } catch {
      // 客户端已断开，忽略
    }
  }
}

function deleteSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
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
      for (const res of session.sseClients) {
        try { res.end(); } catch {}
      }
      sessions.delete(id);
    }
  }
}, 10 * 60 * 1000).unref(); // unref 使定时器不阻止进程退出

module.exports = { createSession, getSession, updateSession, deleteSession, addSseClient, removeSseClient, pushEvent };
