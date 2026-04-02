// Brain Agent 会话状态管理（内存存储）
const { v4: uuidv4 } = require('uuid');

const sessions = new Map();

/**
 * 创建新会话
 * @param {{ apiKeys, spaceId }} opts
 */
function createSession({ apiKeys = {}, spaceId = '' } = {}) {
  const sessionId = `sess_${Date.now()}_${uuidv4().slice(0, 6)}`;
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
    docMarkdown: '',
    docHtml: '',
    brief: null,              // 当前会话已确认/推断的任务简报
    planItems: [],            // 当前任务计划
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

module.exports = { createSession, getSession, updateSession, addSseClient, removeSseClient, pushEvent };
