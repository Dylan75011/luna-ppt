const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.resolve('./data');
const DB_FILE = path.join(DATA_DIR, 'platform.sqlite');
const CORRUPT_DIR = path.join(DATA_DIR, 'corrupted');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

ensureDataDir();

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    state_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_message_at TEXT
  );

  CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_workspace_updated
    ON conversations(workspace_id, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_messages_conversation_sort
    ON conversation_messages(conversation_id, sort_order ASC);

  -- Brain SSE 事件回放表：晚连/重连/崩溃复活后，客户端可重放重要事件流。
  -- 用 INTEGER PRIMARY KEY AUTOINCREMENT 作隐式时序（递增不复用），免维护 sort_order；
  -- FK ON DELETE CASCADE 在 conversation 删除时自动清理避免孤儿数据。
  CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    important INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_agent_events_conv_id
    ON agent_events(conversation_id, id);
`);

// 后端 Brain 自治持久化列。前端 saveConversation 写 state_json（前端视图态），
// 后端 flushAgentState 写本列（brief / taskIntent / bestPlan / pendingToolCallId 等
// brain 内部权威字段），二者互不覆盖。idempotent：列已存在则跳过。
try {
  db.exec(`ALTER TABLE conversations ADD COLUMN agent_state_json TEXT NOT NULL DEFAULT '{}'`);
} catch (error) {
  if (!/duplicate column/i.test(String(error.message))) {
    console.warn('[conversationStore] agent_state_json 列迁移异常（非"列已存在"）：', error.message);
  }
}

const stmts = {
  listConversations: db.prepare(`
    SELECT
      c.id,
      c.workspace_id AS workspaceId,
      c.title,
      c.status,
      c.created_at AS createdAt,
      c.updated_at AS updatedAt,
      c.last_message_at AS lastMessageAt,
      COUNT(m.id) AS messageCount
    FROM conversations c
    LEFT JOIN conversation_messages m ON m.conversation_id = c.id
    WHERE c.workspace_id = ?
    GROUP BY c.id
    ORDER BY c.updated_at DESC, c.id DESC
  `),
  getConversation: db.prepare(`
    SELECT
      id,
      workspace_id AS workspaceId,
      title,
      status,
      state_json AS stateJson,
      created_at AS createdAt,
      updated_at AS updatedAt,
      last_message_at AS lastMessageAt
    FROM conversations
    WHERE id = ?
  `),
  getMessages: db.prepare(`
    SELECT
      id,
      payload_json AS payloadJson,
      created_at AS createdAt
    FROM conversation_messages
    WHERE conversation_id = ?
    ORDER BY sort_order ASC
  `),
  insertConversation: db.prepare(`
    INSERT INTO conversations (
      id, workspace_id, title, status, state_json, created_at, updated_at, last_message_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateConversation: db.prepare(`
    UPDATE conversations
    SET title = ?, status = ?, state_json = ?, updated_at = ?, last_message_at = ?
    WHERE id = ?
  `),
  deleteConversationMessages: db.prepare(`
    DELETE FROM conversation_messages WHERE conversation_id = ?
  `),
  insertMessage: db.prepare(`
    INSERT INTO conversation_messages (
      id, conversation_id, sort_order, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `),
  deleteConversation: db.prepare(`
    DELETE FROM conversations WHERE id = ?
  `),
  deleteByWorkspace: db.prepare(`
    DELETE FROM conversations WHERE workspace_id = ?
  `),
  upsertMessage: db.prepare(`
    INSERT INTO conversation_messages (id, conversation_id, sort_order, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      sort_order = excluded.sort_order,
      payload_json = excluded.payload_json
  `),
  getMaxSortOrder: db.prepare(`
    SELECT COALESCE(MAX(sort_order), -1) AS maxOrder
    FROM conversation_messages WHERE conversation_id = ?
  `),
  countMessages: db.prepare(`
    SELECT COUNT(*) AS cnt FROM conversation_messages WHERE conversation_id = ?
  `),
  listMessageIds: db.prepare(`
    SELECT id FROM conversation_messages WHERE conversation_id = ?
  `),
  deleteMessageById: db.prepare(`
    DELETE FROM conversation_messages WHERE conversation_id = ? AND id = ?
  `),
  touchConversation: db.prepare(`
    UPDATE conversations
    SET updated_at = ?, last_message_at = ?, state_json = COALESCE(?, state_json), title = COALESCE(?, title), status = COALESCE(?, status)
    WHERE id = ?
  `),
  getAgentState: db.prepare(`
    SELECT agent_state_json AS agentStateJson FROM conversations WHERE id = ?
  `),
  updateAgentState: db.prepare(`
    UPDATE conversations
    SET agent_state_json = ?, updated_at = ?
    WHERE id = ?
  `),
  insertAgentEvent: db.prepare(`
    INSERT INTO agent_events (conversation_id, session_id, event_type, payload_json, important, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  listAgentEvents: db.prepare(`
    SELECT event_type AS eventType, payload_json AS payloadJson, important, created_at AS createdAt
    FROM agent_events
    WHERE conversation_id = ?
    ORDER BY id ASC
  `),
  pruneAgentEvents: db.prepare(`
    DELETE FROM agent_events
    WHERE conversation_id = ?
      AND id NOT IN (
        SELECT id FROM agent_events
        WHERE conversation_id = ?
        ORDER BY id DESC
        LIMIT ?
      )
  `),
  countAgentEvents: db.prepare(`
    SELECT COUNT(*) AS cnt FROM agent_events WHERE conversation_id = ?
  `)
};

// 防御阈值：当 payload.messages 比 DB 现有少这么多条时，拒绝整次写入。
// 之前的实现是先 DELETE FROM ... 再批量 INSERT —— 一旦前端误传空数组或残缺
// 数组，就会把整段聊天历史抹掉。现在改成"upsert + 仅删除真正多余的 id"，
// 并加一道 sanity check 拦截明显异常的快照。
const SAVE_SHRINK_HARD_LIMIT = 50;

// 写入观测：总写次数、retry 次数、最近一次 retry 时间戳。
// 暴露 getWriteStats() 给 /api/health 或排障脚本读，频繁 retry 是迁出 DatabaseSync
// 的强信号（多进程部署 / 长读阻塞）。
const writeStats = {
  totalWrites: 0,
  totalRetries: 0,
  totalFailed: 0,
  lastRetryAt: null,
  lastFailureAt: null,
  lastFailureMessage: ''
};

function isRetryableSqliteError(err) {
  const msg = String(err?.message || '');
  // node:sqlite 抛出的 BUSY 信息一般含 "database is locked" 或 "SQLITE_BUSY"。
  // 不要匹配 "database disk image is malformed" 这类不可重试的错误。
  return /SQLITE_BUSY\b|database is locked|database table is locked/i.test(msg);
}

// 同步 retry 包装：DatabaseSync 是 sync API，不能 setTimeout 等待；
// 在单 Node 进程下 BUSY 极罕见，立即重试通常就能成功（锁会在下一刻释放）。
// 多进程或长读场景下需要真退避，等观测到再升级。
function withSqliteRetry(label, fn, maxRetries = 5) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = fn();
      writeStats.totalWrites++;
      return result;
    } catch (err) {
      lastErr = err;
      if (!isRetryableSqliteError(err) || attempt >= maxRetries) {
        if (isRetryableSqliteError(err)) {
          writeStats.totalFailed++;
          writeStats.lastFailureAt = new Date().toISOString();
          writeStats.lastFailureMessage = err.message;
          console.error(`[conversationStore] ${label} 重试 ${maxRetries} 次仍 BUSY，放弃:`, err.message);
        }
        throw err;
      }
      writeStats.totalRetries++;
      writeStats.lastRetryAt = new Date().toISOString();
      console.warn(`[conversationStore] ${label} retry #${attempt + 1} BUSY:`, err.message);
    }
  }
  throw lastErr; // unreachable
}

function getWriteStats() {
  return { ...writeStats };
}

function saveConversationTxn(conversationId, payload) {
  const conversation = stmts.getConversation.get(conversationId);
  if (!conversation) throw new Error(`会话不存在: ${conversationId}`);

  const now = new Date().toISOString();
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const lastMessageAt = payload.lastMessageAt || messages.at(-1)?.createdAt || conversation.lastMessageAt || now;

  // 把 message.id 在 payload 里全部填好（缺失的就地补一次），后面用作 upsert 主键。
  const normalized = messages.map((message) => {
    if (message && typeof message === 'object' && message.id) return message;
    return { ...(message || {}), id: `msg_${uuidv4().replace(/-/g, '').slice(0, 16)}` };
  });
  const incomingIds = new Set(normalized.map((m) => m.id));

  // Sanity check：若 payload 显式传了 messages 字段，但与 DB 现有数据相比剧烈缩水，
  // 拒写。空数组 / 漏几十条都属于异常，绝不是正常的快照保存。
  if (Array.isArray(payload.messages)) {
    const { cnt: existingCount = 0 } = stmts.countMessages.get(conversationId) || {};
    const shrink = existingCount - normalized.length;
    if (existingCount > 0 && (normalized.length === 0 || shrink >= SAVE_SHRINK_HARD_LIMIT)) {
      const err = new Error(
        `saveConversationTxn 拒绝写入：消息数从 ${existingCount} 缩到 ${normalized.length}（疑似空快照）`
      );
      err.code = 'SUSPICIOUS_SNAPSHOT_SHRINK';
      console.error('[conversationStore]', err.message, conversationId);
      throw err;
    }
  }

  db.exec('BEGIN');
  try {
    stmts.updateConversation.run(
      payload.title || conversation.title,
      payload.status || conversation.status || 'active',
      JSON.stringify(payload.state || {}),
      now,
      lastMessageAt,
      conversationId
    );

    // upsert：保留消息行；同 id 行被覆盖（含 sort_order 与 payload）。
    normalized.forEach((message, index) => {
      stmts.upsertMessage.run(
        message.id,
        conversationId,
        index,
        JSON.stringify(message),
        message.createdAt || now
      );
    });

    // 清理：只删除"在 DB 里但不在 payload 里"的多余消息，而不是全表扫光重灌。
    const existingIds = stmts.listMessageIds.all(conversationId).map((row) => row.id);
    existingIds.forEach((id) => {
      if (!incomingIds.has(id)) {
        stmts.deleteMessageById.run(conversationId, id);
      }
    });

    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (rollbackErr) {
      console.error('[conversationStore] saveConversationTxn ROLLBACK 失败:', rollbackErr.message);
    }
    console.error('[conversationStore] saveConversationTxn 失败:', conversationId, error.message);
    throw error;
  }
}

function createConversation(workspaceId, title = '新对话') {
  const now = new Date().toISOString();
  const id = `conv_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  stmts.insertConversation.run(id, workspaceId, title, 'active', '{}', now, now, null);
  return getConversation(id);
}

function listConversations(workspaceId) {
  return stmts.listConversations.all(workspaceId);
}

function getConversation(id) {
  const conversation = stmts.getConversation.get(id);
  if (!conversation) return null;
  return {
    ...conversation,
    state: safeJson(conversation.stateJson, {}, `conversation.state:${id}`)
  };
}

function getConversationDetail(id) {
  const conversation = getConversation(id);
  if (!conversation) return null;
  const messages = stmts.getMessages.all(id).map(row => ({
    ...safeJson(row.payloadJson, {}, `message.payload:${id}/${row.id}`),
    id: row.id,
    createdAt: row.createdAt
  }));
  return {
    ...conversation,
    messages
  };
}

function saveConversationSnapshot(id, payload = {}) {
  saveConversationTxn(id, payload);
  return getConversationDetail(id);
}

/**
 * Incrementally upsert a single message (no DELETE). Safe under interleaved
 * writes — used during SSE streaming so partial assistant text is persisted
 * frequently without risking stale full-snapshot overwrites.
 */
function appendMessage(conversationId, message, { state, title, status } = {}) {
  const conversation = stmts.getConversation.get(conversationId);
  if (!conversation) throw new Error(`会话不存在: ${conversationId}`);
  if (!message || !message.id) throw new Error('appendMessage: message.id 必填');

  const now = new Date().toISOString();
  return withSqliteRetry(`appendMessage(${conversationId.slice(0, 12)},${message.id})`, () => {
    db.exec('BEGIN');
    try {
      // If the message is new, assign it sort_order = max+1; if it already exists,
      // keep its existing sort_order by reading it back first.
      const existing = db.prepare(
        'SELECT sort_order AS sortOrder FROM conversation_messages WHERE id = ? AND conversation_id = ?'
      ).get(message.id, conversationId);
      let sortOrder;
      if (existing) {
        sortOrder = existing.sortOrder;
      } else {
        const row = stmts.getMaxSortOrder.get(conversationId);
        sortOrder = (row?.maxOrder ?? -1) + 1;
      }
      stmts.upsertMessage.run(
        message.id,
        conversationId,
        sortOrder,
        JSON.stringify(message),
        message.createdAt || now
      );
      stmts.touchConversation.run(
        now,
        message.createdAt || now,
        state !== undefined ? JSON.stringify(state) : null,
        title || null,
        status || null,
        conversationId
      );
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (rollbackErr) {
        console.error('[conversationStore] appendMessage ROLLBACK 失败:', rollbackErr.message);
      }
      // BUSY 错误让 withSqliteRetry 处理，其它错误打日志后抛出
      if (!isRetryableSqliteError(error)) {
        console.error('[conversationStore] appendMessage 失败:', conversationId, message?.id, error.message);
      }
      throw error;
    }
  });
}

function getAgentState(conversationId) {
  if (!conversationId) return null;
  const row = stmts.getAgentState.get(conversationId);
  if (!row) return null;
  return safeJson(row.agentStateJson, {}, `agentState:${conversationId}`);
}

/**
 * 后端 Brain 自治持久化：把 brief / taskIntent / bestPlan / pendingToolCallId 等
 * 后端权威字段写入 agent_state_json 列。读-改-写在 Node 单线程内是原子的（DatabaseSync），
 * 不需要事务包裹。前端的 saveConversation 不会触碰这一列。
 */
function patchAgentState(conversationId, partial) {
  if (!conversationId || !partial || typeof partial !== 'object') return null;
  try {
    return withSqliteRetry(`patchAgentState(${conversationId.slice(0, 12)})`, () => {
      const conversation = stmts.getConversation.get(conversationId);
      if (!conversation) return null;
      const existing = safeJson(
        stmts.getAgentState.get(conversationId)?.agentStateJson,
        {},
        `agentState:${conversationId}`
      );
      const merged = { ...existing, ...partial, updatedAt: new Date().toISOString() };
      stmts.updateAgentState.run(JSON.stringify(merged), new Date().toISOString(), conversationId);
      return merged;
    });
  } catch (error) {
    console.error('[conversationStore] patchAgentState 失败:', conversationId, error.message);
    return null;
  }
}

// agent_events: 单 conversation 保留最近 N 条，超过即时 prune（在每次插入后做轻量清理）。
// 200 是分桶上限的总和（important 200 + trivial 60 = 260；这里用 500 作为单一阈值简化）。
const AGENT_EVENT_KEEP_PER_CONVERSATION = 500;
let _eventInsertCount = 0;

function appendAgentEvent({ conversationId, sessionId, eventType, payload, important = false }) {
  if (!conversationId || !eventType) return;
  try {
    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    stmts.insertAgentEvent.run(
      conversationId,
      sessionId || '',
      eventType,
      payloadJson,
      important ? 1 : 0,
      new Date().toISOString()
    );
    // 每 50 次插入做一次轻量 prune；不每次都做避免热路径上 DELETE 太频繁
    _eventInsertCount = (_eventInsertCount + 1) % 50;
    if (_eventInsertCount === 0) {
      try {
        stmts.pruneAgentEvents.run(conversationId, conversationId, AGENT_EVENT_KEEP_PER_CONVERSATION);
      } catch (pruneErr) {
        console.warn('[conversationStore] pruneAgentEvents 失败:', pruneErr.message);
      }
    }
  } catch (error) {
    // event 落盘是 best-effort，失败不要中断 SSE 推送
    console.warn('[conversationStore] appendAgentEvent 失败:', conversationId, eventType, error.message);
  }
}

function getAgentEvents(conversationId) {
  if (!conversationId) return [];
  try {
    return stmts.listAgentEvents.all(conversationId);
  } catch (error) {
    console.warn('[conversationStore] getAgentEvents 失败:', conversationId, error.message);
    return [];
  }
}

function deleteConversation(id) {
  stmts.deleteConversation.run(id);
}

// 返回被删除的 conversation id 列表，便于路由层逐个 cleanupConversationTmp。
function deleteWorkspaceConversations(workspaceId) {
  const rows = stmts.listConversations.all(workspaceId);
  const ids = rows.map((row) => row.id);
  stmts.deleteByWorkspace.run(workspaceId);
  return ids;
}

// 把损坏的 JSON 原样落盘到 data/corrupted/，便于事后恢复 / 比对，
// 而不是像之前那样只 console.warn 然后静默返回 {}（下一次写就把它彻底盖掉了）。
function dumpCorruptPayload(scope, text, error) {
  try {
    if (!fs.existsSync(CORRUPT_DIR)) fs.mkdirSync(CORRUPT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeScope = String(scope || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 60);
    const filePath = path.join(CORRUPT_DIR, `${safeScope}-${stamp}.json`);
    fs.writeFileSync(filePath, String(text ?? ''));
    console.error(
      `[conversationStore] JSON 解析失败（${scope}）：${error.message}；原文已备份到 ${filePath}`
    );
    return filePath;
  } catch (dumpErr) {
    console.error('[conversationStore] 备份损坏 JSON 失败:', dumpErr.message);
    return '';
  }
}

function safeJson(text, fallback, scope = 'safeJson') {
  if (text == null) return fallback;
  try {
    return JSON.parse(text);
  } catch (error) {
    dumpCorruptPayload(scope, text, error);
    return fallback;
  }
}

module.exports = {
  createConversation,
  listConversations,
  getConversation,
  getConversationDetail,
  saveConversationSnapshot,
  appendMessage,
  deleteConversation,
  deleteWorkspaceConversations,
  getAgentState,
  patchAgentState,
  appendAgentEvent,
  getAgentEvents,
  getWriteStats
};
