// Brain Agent 路由
const express = require('express');
const router  = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const agentSession = require('../services/agentSession');
const brainAgent   = require('../agents/brainAgent');
const { executeTool } = require('../services/toolRegistry');
const { withTimeout, TimeoutError } = require('../utils/abortx');

// /build-ppt 端点的兜底超时——pptGenerator 内部已有单页 25s race，
// 这里作为整体上限。多页累加 + 文件 IO + pptxgenjs 写入大概在 60-90s 内。
const BUILD_PPT_ENDPOINT_BUDGET_MS = 150_000;
// lazy require: pdf-parse is problematic in Node.js without full DOM
let _parseUploadedDocuments = null;
function getDocumentParser() {
  if (!_parseUploadedDocuments) {
    _parseUploadedDocuments = require('../services/documentParser').parseUploadedDocuments;
  }
  return _parseUploadedDocuments;
}
const wm = require('../services/workspaceManager');
const { pruneAgentUploads } = require('../services/outputRetention');
const { getConversationUploadDir, toOutputUrl } = require('../services/outputPaths');

// 从工作空间读取被引用文档的内容
function resolveWorkspaceDocs(refIds = []) {
  if (!Array.isArray(refIds) || !refIds.length) return [];
  return refIds.map(id => {
    try {
      const data = wm.getContent(String(id));
      const raw = data.content;
      let text = '';
      if (typeof raw === 'string') {
        text = raw.replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ').trim();
      } else if (raw && typeof raw === 'object') {
        const extract = (node) => {
          if (!node) return '';
          if (typeof node.text === 'string') return node.text;
          if (Array.isArray(node.content)) return node.content.map(extract).join(' ');
          return '';
        };
        text = extract(raw).replace(/\s+/g, ' ').trim();
      }
      return {
        id: data.id || id,
        name: data.name || id,
        docType: data.docType || 'document',
        text: text.slice(0, 8000) + (text.length > 8000 ? '\n...[内容已截断]' : '')
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

const ALLOWED_MIMES = [
  'image/png', 'image/jpeg', 'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter(req, file, cb) {
    const ok = ALLOWED_MIMES.includes(file.mimetype)
      || file.originalname?.toLowerCase().endsWith('.pdf')
      || file.originalname?.toLowerCase().endsWith('.docx');
    cb(null, ok);
  }
});

function isMockHoldMode() {
  return process.env.LUNA_MOCK_AGENT_HOLD === '1';
}

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const { classifyLlmError, buildNextActionHint } = require('../utils/llmRetry');

function buildAgentFailurePayload(error, {
  stage = 'agent',
  retryable,
  nextAction = ''
} = {}) {
  const reason = String(error?.message || error || '未知错误');
  // 自动按 errorClass 选 nextAction 和 retryable —— 跟 brainAgent hard fail 一致
  const errorClass = classifyLlmError(error);
  const action = nextAction || buildNextActionHint(errorClass, error);
  // retryable 默认按分类决定（fatal/user_abort 不可重试，其他都可以），caller 显式覆盖优先
  const finalRetryable = typeof retryable === 'boolean'
    ? retryable
    : (errorClass !== 'fatal' && errorClass !== 'user_abort');
  return {
    message: `任务执行失败：${reason}\n\n接下来：${action}`,
    reason,
    stage,
    retryable: finalRetryable,
    errorClass,
    nextAction: action
  };
}

// 这些内部标志位标识系统注入消息 / 已中断的 assistant，
// 压缩与渲染逻辑依赖它们识别"非真实用户原话"，restore 时必须保留
const INTERNAL_FLAG_KEYS = [
  '_backgroundInject',
  '_softFailInject',
  '_crossProviderFallback',
  '_aborted',
  '_abortReason',
  '_forcedSummary'
];

function normalizeRestoreMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(item => item && ['user', 'assistant', 'tool'].includes(item.role))
    .map((item) => {
      const next = {
        role: item.role,
        content: typeof item.content === 'string' ? item.content : ''
      };
      if (item.tool_calls) next.tool_calls = item.tool_calls;
      if (item.tool_call_id) next.tool_call_id = item.tool_call_id;
      for (const key of INTERNAL_FLAG_KEYS) {
        if (item[key] !== undefined) next[key] = item[key];
      }
      if (Array.isArray(item.attachments) && item.attachments.length) {
        next.attachments = item.attachments.map((att) => ({
          id: att.id,
          name: att.name,
          mimeType: att.mimeType,
          size: att.size,
          url: att.url,
          analysis: att.analysis || '',
          error: att.error || ''
        }));
      }
      return next;
    })
    .filter(item => item.content || item.tool_calls || item.tool_call_id);
}

function restoreSessionFromSnapshot(session, snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object') return session;
  // messages 可能来自前端（已经 normalize 好）或来自 agent_state_json 回退（直接是 message 数组）。
  // 只有 messages 字段有值才覆盖；DB 回退路径通常不带 messages（messages 走 conversation_messages 表）。
  if (Array.isArray(snapshot.messages) && snapshot.messages.length) {
    session.messages = normalizeRestoreMessages(snapshot.messages);
  }
  session.bestPlan = snapshot.bestPlan || null;
  session.bestScore = Number.isFinite(snapshot.bestScore) ? snapshot.bestScore : (session.bestScore || 0);
  session.userInput = snapshot.userInput || null;
  session.docHtml = typeof snapshot.docHtml === 'string' ? snapshot.docHtml : '';
  session.brief = snapshot.brief || null;
  session.taskIntent = snapshot.taskIntent || null;
  session.executionPlan = snapshot.executionPlan || null;
  session.taskSpec = snapshot.taskSpec || null;
  session.routeToolSequence = Array.isArray(snapshot.routeToolSequence) ? snapshot.routeToolSequence : [];
  session.planItems = Array.isArray(snapshot.planItems) ? snapshot.planItems : [];
  session.researchStore = Array.isArray(snapshot.researchStore) ? snapshot.researchStore : [];
  session.askedQuestions = Array.isArray(snapshot.askedQuestions) ? snapshot.askedQuestions : (session.askedQuestions || []);
  // pendingToolCallId 是 ask_user 暂停态的关键字段——必须能跨进程恢复，
  // 否则崩溃后用户回答没法对回正确的 tool_call。
  if (snapshot.pendingToolCallId) {
    session.pendingToolCallId = snapshot.pendingToolCallId;
  }
  session.attachments = Array.isArray(snapshot.attachments)
    ? snapshot.attachments.map((att) => ({
        id: att.id,
        name: att.name,
        mimeType: att.mimeType,
        size: att.size,
        url: att.url,
        analysis: att.analysis || '',
        error: att.error || ''
      }))
    : [];
  return session;
}

function ensureAgentImageDir(conversationId = '') {
  // 有 conversationId 时落到 output/conversations/<convId>/agent-inputs/，
  // 删会话时整目录会被清掉。没有就退回旧 output/agent-inputs/，由 pruneAgentUploads 兜底。
  if (conversationId) return getConversationUploadDir(conversationId);
  const dir = path.resolve('./output/agent-inputs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function toPublicAttachments(attachments = []) {
  return attachments.map((item) => ({
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    size: item.size,
    url: item.url
  }));
}

async function persistUploadedImages(files = [], conversationId = '') {
  if (!Array.isArray(files) || files.length === 0) return [];
  const outputDir = ensureAgentImageDir(conversationId);
  // 老路径（无 conversationId）才走 keep-N + maxAge 兜底剪枝；
  // 新路径下文件由 deleteConversation 时整目录清掉，无需周期性 prune。
  if (!conversationId) {
    try { pruneAgentUploads(); } catch (error) { console.warn('[agent] pruneAgentUploads 失败:', error.message); }
  }
  const attachments = [];

  for (const file of files) {
    if (!String(file.mimetype || '').startsWith('image/')) continue;
    const ext = path.extname(file.originalname || '').toLowerCase()
      || (file.mimetype === 'image/png' ? '.png'
        : file.mimetype === 'image/webp' ? '.webp'
        : '.jpg');
    const baseName = path.basename(file.originalname || `image${ext}`, ext).replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40) || 'image';
    const fileName = `agent_${Date.now()}_${Math.random().toString(16).slice(2, 8)}_${baseName}${ext}`;
    const localPath = path.join(outputDir, fileName);
    await fs.promises.writeFile(localPath, file.buffer);
    // toOutputUrl 自己根据绝对路径生成相对 /output 的 URL，覆盖新旧两种目录布局，
    // 不再硬编码 /output/agent-inputs/。
    const publicUrl = toOutputUrl(localPath) || `/output/agent-inputs/${fileName}`;
    attachments.push({
      id: `att_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      name: file.originalname || fileName,
      mimeType: file.mimetype || 'image/jpeg',
      size: file.size || 0,
      url: publicUrl,
      localPath
    });
  }

  return attachments;
}

/**
 * POST /api/agent/start
 * 用户发送新消息，启动 Brain 循环
 */
router.post('/start', upload.array('images', 5), async (req, res) => {
  try {
    const { message, spaceId, sessionId: existingSessionId, isNewConversation, forceTool, conversationId } = req.body;
    const apiKeys = safeJsonParse(req.body.apiKeys, {});
    const restoreSession = safeJsonParse(req.body.restoreSession, null);
    const attachments = await persistUploadedImages(req.files || [], conversationId || '');
    const documents = await getDocumentParser()(req.files || []);
    const workspaceRefIds = safeJsonParse(req.body.workspaceRefs, []);
    const workspaceDocs = resolveWorkspaceDocs(workspaceRefIds);

    if ((!message || !message.trim()) && attachments.length === 0 && documents.length === 0 && workspaceDocs.length === 0) {
      return res.status(400).json({ success: false, message: '消息或文件不能为空' });
    }

    // isNewConversation=true 时强制新建 session，不复用历史消息
    // isNewConversation 未传或为 false 时，尝试复用同一对话的 session（多轮继续）
    let session = null;
    if (existingSessionId && !isNewConversation) {
      const existing = agentSession.getSession(existingSessionId);
      if (existing) {
        // 防止前端切对话后误把对话 A 的 sessionId 用在对话 B：必须严格匹配
        if (conversationId && existing.conversationId && existing.conversationId !== conversationId) {
          return res.status(409).json({ success: false, message: 'sessionId 与 conversationId 不匹配，拒绝复用' });
        }
        if (existing.status === 'running' || existing.status === 'waiting_for_user') {
          return res.status(409).json({
            success: false,
            message: existing.status === 'waiting_for_user'
              ? '当前会话正在等待用户补充信息，请使用 reply 接口继续'
              : '当前会话仍在执行中，请稍后再发送或先停止当前任务',
            sessionId: existing.sessionId,
            status: existing.status,
            streamUrl: `/api/agent/stream/${existing.sessionId}`
          });
        }
        session = existing;
        if (conversationId) agentSession.bindConversation(session, conversationId);
        session.stopRequested = false;
        session.doneEmitted = false;
        session.eventBacklog = [];
        // 启新一轮：addSseClient 不要把 DB 里上一轮的 agent_events 回放给本轮 SSE。
        // 否则前端会把 R1 的 tool_call / artifact 当成 R2 的事件再持久化一遍。
        session._skipDbReplay = true;
        if (apiKeys) Object.assign(session.apiKeys, apiKeys);
      }
    }

    if (!session) {
      session = agentSession.createSession({
        sessionId: existingSessionId && !isNewConversation ? existingSessionId : '',
        apiKeys: apiKeys || {},
        spaceId: spaceId || '',
        conversationId: conversationId || ''
      });
      // 1) 用前端 restoreSession 恢复（包含 messages / 视图态衍生的最新 brief 等）
      if (existingSessionId && !isNewConversation && restoreSession) {
        restoreSessionFromSnapshot(session, restoreSession);
      }
      // 2) 再用后端 agent_state_json 补缺：前端不记 pendingToolCallId / bestScore /
      //    askedQuestions 等内部权威字段，崩溃恢复必须从 DB 读回。已有值不覆盖。
      if (!isNewConversation && conversationId) {
        try {
          const conversationStore = require('../services/conversationStore');
          const dbAgentState = conversationStore.getAgentState(conversationId);
          if (dbAgentState && Object.keys(dbAgentState).length) {
            if (!session.pendingToolCallId && dbAgentState.pendingToolCallId) {
              session.pendingToolCallId = dbAgentState.pendingToolCallId;
            }
            if (!session.bestScore && Number.isFinite(dbAgentState.bestScore)) {
              session.bestScore = dbAgentState.bestScore;
            }
            if ((!session.askedQuestions || !session.askedQuestions.length)
                && Array.isArray(dbAgentState.askedQuestions)) {
              session.askedQuestions = dbAgentState.askedQuestions;
            }
            // 前端没传 restoreSession 时（首次 /start 从 DB 冷启动），把 brain
            // 全套权威态都补上，避免重跑工具
            if (!restoreSession) {
              if (!session.bestPlan && dbAgentState.bestPlan) session.bestPlan = dbAgentState.bestPlan;
              if (!session.brief && dbAgentState.brief) session.brief = dbAgentState.brief;
              if (!session.taskIntent && dbAgentState.taskIntent) session.taskIntent = dbAgentState.taskIntent;
              if (!session.taskSpec && dbAgentState.taskSpec) session.taskSpec = dbAgentState.taskSpec;
              if (!session.executionPlan && dbAgentState.executionPlan) session.executionPlan = dbAgentState.executionPlan;
              if (!session.userInput && dbAgentState.userInput) session.userInput = dbAgentState.userInput;
              if ((!session.planItems || !session.planItems.length) && Array.isArray(dbAgentState.planItems)) {
                session.planItems = dbAgentState.planItems;
              }
              if ((!session.routeToolSequence || !session.routeToolSequence.length)
                  && Array.isArray(dbAgentState.routeToolSequence)) {
                session.routeToolSequence = dbAgentState.routeToolSequence;
              }
              if (!session.docHtml && dbAgentState.docHtml) session.docHtml = dbAgentState.docHtml;
              if (!session.docMarkdown && dbAgentState.docMarkdown) session.docMarkdown = dbAgentState.docMarkdown;
            }
            // pendingBackgroundInjects 也要补：服务重启后 /start 入口走的就是 brain.run()，
            // run() 第一行就 drainPendingBackgroundInjects——如果不从 DB 拿回来，重启前
            // 还没消费的后台工具结果就永久丢失。
            if ((!session.pendingBackgroundInjects || !session.pendingBackgroundInjects.length)
                && Array.isArray(dbAgentState.pendingBackgroundInjects)
                && dbAgentState.pendingBackgroundInjects.length) {
              session.pendingBackgroundInjects = dbAgentState.pendingBackgroundInjects;
            }
            // 创意方向状态簇：approve_concept / run_strategy 都靠它拿用户挑的方向
            if (!session.conceptProposal && dbAgentState.conceptProposal) {
              session.conceptProposal = dbAgentState.conceptProposal;
            }
            if (!session.conceptIteration && dbAgentState.conceptIteration) {
              session.conceptIteration = dbAgentState.conceptIteration;
            }
            if (!session.conceptApproved && dbAgentState.conceptApproved) {
              session.conceptApproved = true;
              session.approvedDirection = dbAgentState.approvedDirection || null;
              session.approvedDirectionLabel = dbAgentState.approvedDirectionLabel || '';
            }
            if (!session.conceptContextBrand && dbAgentState.conceptContextBrand) {
              session.conceptContextBrand = dbAgentState.conceptContextBrand;
            }
            if (!session.lastSavedDocId && dbAgentState.lastSavedDocId) {
              session.lastSavedDocId = dbAgentState.lastSavedDocId;
              session.lastSavedDocName = dbAgentState.lastSavedDocName || null;
            }
            // 跨重启的死 in-flight 工具：同 /reply 路径处理。/start 走 brain.run()，
            // 生成的 system inject 会跟新 user 消息一起进 buildMessages 给 LLM。
            const deadInflight = Array.isArray(dbAgentState.inflightBackgroundCalls)
              ? dbAgentState.inflightBackgroundCalls
              : [];
            if (deadInflight.length && Array.isArray(session.messages)) {
              for (const item of deadInflight) {
                session.messages.push({
                  role: 'user',
                  content: `[系统注入｜后台任务在服务重启时丢失] 之前你后台化的工具 ${item.toolName}（call_id=${item.toolCallId}）的真实结果因为服务重启已经无法回收。请基于已有信息推进，不要重复调用同一工具。`,
                  _backgroundInject: true
                });
              }
              session.inflightBackgroundCalls = [];
              console.warn('[agent/start] 检测到', deadInflight.length, '个崩溃前未回收的后台工具，已注入死亡通知');
            }
          }
        } catch (err) {
          console.warn('[agent/start] agent_state_json 补缺失败:', err.message);
        }
      }
    }

    const onEvent = (eventType, data) => {
      if (eventType === 'done') session.doneEmitted = true;
      agentSession.pushEvent(session.sessionId, eventType, data);
    };

    if (isMockHoldMode()) {
      const userContent = message?.trim() || (attachments.length ? '用户上传了图片' : (documents.length ? '用户上传了文档' : ''));
      if (userContent) {
        session.messages.push({
          role: 'user',
          content: userContent,
          ...(attachments.length ? { attachments: toPublicAttachments(attachments) } : {})
        });
      }
      session.status = 'running';
      session.stopRequested = false;
      session.doneEmitted = false;
    } else {
      brainAgent.run(session, message?.trim() || '', onEvent, { attachments, documents, workspaceDocs, forceTool }).catch(err => {
        console.error('[agent/start] error:', err);
        agentSession.pushEvent(session.sessionId, 'error', buildAgentFailurePayload(err, { stage: 'agent_start' }));
        session.status = 'failed';
      });
    }

    res.json({
      success: true,
      sessionId: session.sessionId,
      streamUrl: `/api/agent/stream/${session.sessionId}`,
      attachments: toPublicAttachments(attachments),
      documents: documents.map(d => ({ id: d.id, name: d.name, type: d.type, pages: d.pages, size: d.size, error: d.error }))
    });
  } catch (error) {
    res.status(500).json({ success: false, ...buildAgentFailurePayload(error, { stage: 'agent_start' }) });
  }
});

/**
 * GET /api/agent/:sessionId/status
 * 查会话存活情况——前端切回对话或拿到 409 时用它判断要不要重连 SSE。
 *
 * 返回：
 *   - alive=false：内存里已经没这个 session（done/被 LRU 淘汰/进程重启）。前端就当历史快照看
 *   - alive=true + status='running'：后端还在跑，前端应该 reconnect SSE 接续看事件
 *   - alive=true + status='waiting_for_user'：后端等用户回 ask_user，前端应该 reconnect SSE
 *     并显示 clarification 输入框
 *   - alive=true + status='idle'：会话还在内存里但空闲，前端可以直接发新消息
 */
router.get('/:sessionId/status', (req, res) => {
  const { sessionId } = req.params;
  const session = agentSession.getSession(sessionId);
  if (!session) {
    return res.json({
      alive: false,
      status: null,
      conversationId: null,
      streamUrl: null
    });
  }
  res.json({
    alive: true,
    status: session.status || 'idle',
    conversationId: session.conversationId || null,
    streamUrl: `/api/agent/stream/${sessionId}`,
    pendingToolCallId: session.pendingToolCallId || null
  });
});

/**
 * GET /api/agent/stream/:sessionId   (SSE)
 * 订阅会话的实时事件流
 */
router.get('/stream/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = agentSession.getSession(sessionId);

  if (!session) {
    return res.status(404).json({ success: false, message: '会话不存在' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  agentSession.addSseClient(sessionId, res);

  // 心跳保活
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    agentSession.removeSseClient(sessionId, res);
  });
});

/**
 * POST /api/agent/:sessionId/reply
 * 用户回答了 ask_user 的问题，恢复 Brain 循环
 */
router.post('/:sessionId/reply', upload.array('images', 5), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { reply, conversationId } = req.body;
    const apiKeys = safeJsonParse(req.body.apiKeys, {});
    const attachments = await persistUploadedImages(req.files || [], conversationId || '');
    const documents = await getDocumentParser()(req.files || []);
    const workspaceRefIds = safeJsonParse(req.body.workspaceRefs, []);
    const workspaceDocs = resolveWorkspaceDocs(workspaceRefIds);

    let session = agentSession.getSession(sessionId);

    // 崩溃恢复：内存里没有但 DB 里有 waiting_for_user 状态的快照，复活同一 sessionId
    // 的 session 后继续走 resume。前端 SSE 重连到 /stream/:sessionId 会接到新事件流。
    if (!session && conversationId) {
      try {
        const conversationStore = require('../services/conversationStore');
        const dbAgentState = conversationStore.getAgentState(conversationId);
        if (dbAgentState
            && dbAgentState.status === 'waiting_for_user'
            && dbAgentState.pendingToolCallId
            && Array.isArray(dbAgentState.resumeMessages)
            && dbAgentState.resumeMessages.length) {
          session = agentSession.createSession({
            sessionId,
            apiKeys: apiKeys || {},
            spaceId: dbAgentState.spaceId || '',
            conversationId
          });
          // resumeMessages 已是 LLM API 格式，直接灌入；不走 normalizeRestoreMessages 否则
          // 会丢 tool_calls 结构（normalize 是给前端 UI 格式的转换用的）
          session.messages = dbAgentState.resumeMessages;
          session.pendingToolCallId = dbAgentState.pendingToolCallId;
          session.status = 'waiting_for_user';
          session.bestPlan = dbAgentState.bestPlan || null;
          session.bestScore = dbAgentState.bestScore || 0;
          session.brief = dbAgentState.brief || null;
          session.taskIntent = dbAgentState.taskIntent || null;
          session.executionPlan = dbAgentState.executionPlan || null;
          session.taskSpec = dbAgentState.taskSpec || null;
          session.routeToolSequence = Array.isArray(dbAgentState.routeToolSequence) ? dbAgentState.routeToolSequence : [];
          session.planItems = Array.isArray(dbAgentState.planItems) ? dbAgentState.planItems : [];
          session.askedQuestions = Array.isArray(dbAgentState.askedQuestions) ? dbAgentState.askedQuestions : [];
          session.userInput = dbAgentState.userInput || null;
          session.docHtml = dbAgentState.docHtml || '';
          session.docMarkdown = dbAgentState.docMarkdown || '';
          session.forceTool = dbAgentState.forceTool || '';
          // 后台工具结果队列：之前转后台的 tool 在 idle 期间回结果会塞进这里，
          // 等下次 /reply 入口的 drainPendingBackgroundInjects 拉走。崩溃前如果队列
          // 有内容、又没来得及 drain，恢复时必须把它带回来——否则 brain 看不到后台
          // 结果，相当于用户白等了一分钟工具完全失效。
          session.pendingBackgroundInjects = Array.isArray(dbAgentState.pendingBackgroundInjects)
            ? dbAgentState.pendingBackgroundInjects
            : [];
          // 创意方向状态簇：propose_concept 卡片 + 用户挑选的方向
          session.conceptProposal = dbAgentState.conceptProposal || null;
          session.conceptIteration = dbAgentState.conceptIteration || 0;
          session.conceptApproved = !!dbAgentState.conceptApproved;
          session.approvedDirection = dbAgentState.approvedDirection || null;
          session.approvedDirectionLabel = dbAgentState.approvedDirectionLabel || '';
          session.conceptContextBrand = dbAgentState.conceptContextBrand || '';
          session.lastSavedDocId = dbAgentState.lastSavedDocId || null;
          session.lastSavedDocName = dbAgentState.lastSavedDocName || null;
          // in-flight 后台工具死亡通知：崩溃前还在登记的 tool_call 们的真结果已经
          // 跟 promise 一起死了。把它们转换成"系统注入"消息塞进对话历史，让 brain
          // 下一轮 LLM 调用看到"那个工具其实没成功，决定接下来怎么做"，避免它在
          // pendingToolCallId 已平衡的前提下还以为后台工具在跑。
          const inflight = Array.isArray(dbAgentState.inflightBackgroundCalls)
            ? dbAgentState.inflightBackgroundCalls
            : [];
          if (inflight.length) {
            for (const item of inflight) {
              session.messages.push({
                role: 'user',
                content: `[系统注入｜后台任务在服务重启时丢失] 之前你后台化的工具 ${item.toolName}（call_id=${item.toolCallId}）的真实结果因为服务重启已经无法回收。请基于已有信息推进，不要重复调用同一工具。`,
                _backgroundInject: true
              });
            }
            // 清掉登记，避免下一轮 resurrect 重复注入
            session.inflightBackgroundCalls = [];
          }
          console.warn('[agent/reply] 从 agent_state_json 复活 session:', sessionId, 'conversationId=', conversationId, 'pendingBgInjects=', session.pendingBackgroundInjects.length, 'conceptApproved=', session.conceptApproved, 'inflightDead=', inflight.length);
        }
      } catch (err) {
        console.warn('[agent/reply] DB resurrect 失败:', err.message);
      }
    }

    if (!session) {
      return res.status(404).json({ success: false, message: '会话不存在' });
    }
    // 防止用户切到别的对话后，澄清回答被错误地路由到当前 session 所属的原对话
    if (conversationId && session.conversationId && session.conversationId !== conversationId) {
      return res.status(409).json({ success: false, message: 'sessionId 与 conversationId 不匹配' });
    }
    if (session.status !== 'waiting_for_user') {
      return res.status(400).json({ success: false, message: `会话状态不正确：${session.status}` });
    }
    if ((!reply || !reply.trim()) && attachments.length === 0 && documents.length === 0 && workspaceDocs.length === 0) {
      return res.status(400).json({ success: false, message: '回复或文件不能为空' });
    }

    if (apiKeys) Object.assign(session.apiKeys, apiKeys);
    session.stopRequested = false;

    session.eventBacklog = [];
    // /reply 也是续轮，跟 /start 同理：addSseClient 不要 DB-replay 旧事件
    session._skipDbReplay = true;

    const onEvent = (eventType, data) => {
      if (eventType === 'done') session.doneEmitted = true;
      agentSession.pushEvent(sessionId, eventType, data);
    };

    brainAgent.resume(session, reply?.trim() || '', onEvent, { attachments, documents, workspaceDocs }).catch(err => {
      console.error('[agent/reply] error:', err);
      agentSession.pushEvent(sessionId, 'error', buildAgentFailurePayload(err, { stage: 'agent_reply' }));
      session.status = 'failed';
    });

    res.json({
      success: true,
      streamUrl: `/api/agent/stream/${sessionId}`,
      attachments: toPublicAttachments(attachments),
      documents: documents.map(d => ({ id: d.id, name: d.name, type: d.type, pages: d.pages, size: d.size, error: d.error }))
    });
  } catch (error) {
    res.status(500).json({ success: false, ...buildAgentFailurePayload(error, { stage: 'agent_reply' }) });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, message: `文件上传失败：${err.message}` });
  }
  if (err) {
    return res.status(500).json({ success: false, ...buildAgentFailurePayload(err, { stage: 'agent_request' }) });
  }
  return next();
});

/**
 * POST /api/agent/:sessionId/build-ppt
 * 基于当前会话里已确认的策划文档生成 PPT
 */
router.post('/:sessionId/build-ppt', (req, res) => {
  const { sessionId } = req.params;
  const { docContent, apiKeys, planData, userInput, spaceId, conversationId } = req.body || {};
  let session = agentSession.getSession(sessionId);
  let effectiveSessionId = sessionId;

  if (session && conversationId && session.conversationId && session.conversationId !== conversationId) {
    return res.status(409).json({ success: false, message: 'sessionId 与 conversationId 不匹配' });
  }
  if (!session) {
    if (!planData || !userInput) {
      return res.status(404).json({ success: false, message: '会话不存在' });
    }
    session = agentSession.createSession({
      apiKeys: apiKeys || {},
      spaceId: spaceId || '',
      conversationId: conversationId || ''
    });
    effectiveSessionId = session.sessionId;
    session.bestPlan = planData;
    session.userInput = userInput;
    session.docHtml = typeof docContent === 'string' ? docContent : '';
    session.brief = userInput || null;
  } else if (conversationId) {
    agentSession.bindConversation(session, conversationId);
  }
  if (!session.bestPlan || !session.userInput) {
    return res.status(400).json({ success: false, message: '当前会话还没有可用于生成 PPT 的方案文档' });
  }

  if (apiKeys) Object.assign(session.apiKeys, apiKeys);
  if (typeof docContent === 'string' && docContent.trim()) {
    session.docHtml = docContent;
  }

  const onEvent = (eventType, data) => {
    if (eventType === 'done') session.doneEmitted = true;
    agentSession.pushEvent(effectiveSessionId, eventType, data);
  };

  session.status = 'running';
  session.doneEmitted = false;
  session.stopRequested = false;

  // 整体兜底超时——超时不抛错给客户端（HTTP 已立即返回），仅打日志 + 推 SSE error。
  // 底层 pptGenerator 已有单页 race，正常情况下不会到这层。
  withTimeout(
    executeTool('build_ppt', { note: session.docHtml || '' }, session, onEvent),
    BUILD_PPT_ENDPOINT_BUDGET_MS,
    'build_ppt_endpoint'
  )
    .then(() => {
      if (session.status === 'running') {
        session.status = 'idle';
      }
    })
    .catch((err) => {
      if (err instanceof TimeoutError) {
        console.error(`[agent/build-ppt] 整体超时（${BUILD_PPT_ENDPOINT_BUDGET_MS}ms）`);
        agentSession.pushEvent(sessionId, 'error', buildAgentFailurePayload(err, {
          stage: 'build_ppt',
          nextAction: '请重试一次；如果仍超时，请减少页数、精简文档内容，或先让我拆成更小的 PPT 生成任务。'
        }));
      } else {
        console.error('[agent/build-ppt] error:', err);
        agentSession.pushEvent(sessionId, 'error', buildAgentFailurePayload(err, {
          stage: 'build_ppt',
          nextAction: '请重试一次；如果仍失败，请先保存当前方案文档，再让我根据方案重新生成 PPT。'
        }));
      }
      session.status = 'failed';
    });

  res.json({
    success: true,
    sessionId: effectiveSessionId,
    streamUrl: `/api/agent/stream/${effectiveSessionId}`
  });
});

/**
 * POST /api/agent/:sessionId/stop
 * 停止当前会话
 */
router.post('/:sessionId/stop', (req, res) => {
  const { sessionId } = req.params;
  const { conversationId } = req.body || {};
  const session = agentSession.getSession(sessionId);

  // 兜底：session 不在内存里（LRU evicted / 进程重启了）时也要把 DB 里的 status 标
  // 成 idle，否则下次任何 /start 复用会从 agent_state_json 看到 waiting_for_user 并
  // 走 reply 流程，相当于"用户点了 stop 但服务半小时后又复活了刚才的任务"。
  if (!session && conversationId) {
    try {
      const conversationStore = require('../services/conversationStore');
      const dbAgentState = conversationStore.getAgentState(conversationId);
      if (dbAgentState && (dbAgentState.status === 'running' || dbAgentState.status === 'waiting_for_user')) {
        conversationStore.patchAgentState(conversationId, {
          ...dbAgentState,
          status: 'idle',
          pendingToolCallId: null,
          // resumeMessages 显式置 null，因为 status 不再是 waiting_for_user
          resumeMessages: null,
          // inflight 任务在 stop 时也要清——这些任务的 promise 早就死了（重启/淘汰），
          // 留着只会让下次 resurrect 误以为还有后台事在跑
          inflightBackgroundCalls: [],
          updatedAt: new Date().toISOString()
        });
        console.warn('[agent/stop] session 已 evicted/重启丢失，把 DB 状态强制置 idle:', conversationId);
      }
    } catch (err) {
      console.warn('[agent/stop] DB state 写回失败:', err.message);
    }
  }

  if (session) {
    if (conversationId && session.conversationId && session.conversationId !== conversationId) {
      return res.status(409).json({ success: false, message: 'sessionId 与 conversationId 不匹配' });
    }
    session.stopRequested = true;
    // 立刻打断当前 LLM 流式请求和当前工具的 race —— 不必等下一次 500ms 轮询。
    // brainAgent 在调用前会把 AbortController 挂到 session._currentLlmAbort / _currentToolAbort 上。
    try { session._currentLlmAbort?.abort('user_stop'); } catch {}
    try { session._currentToolAbort?.abort('user_stop'); } catch {}
    // 取消所有挂在后台的工具任务，并清空待注入队列——避免 stop 后还把结果推回来
    try { brainAgent.cancelAllBackgroundTasks(session); } catch {}
    // 给"孤儿 assistant.tool_calls"（被 stop 打断、缺对应 tool_result 的）补 stub
    // tool_result，否则下次 /start 用同 session 时 OpenAI/MiniMax API 会 400
    // "tool call result does not follow tool call (2013)"，brain 还要走 30-60s
    // 的 retry+跨厂商兜底才能恢复。补一行廉价的 stub 直接根除。
    if (Array.isArray(session.messages)) {
      const padded = [];
      for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i];
        padded.push(msg);
        if (msg && msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
          const fulfilledIds = new Set();
          // 看后面紧跟着的 tool 消息：直到下一条 user/assistant 之前都算这个 assistant 的回执
          for (let j = i + 1; j < session.messages.length; j++) {
            const next = session.messages[j];
            if (!next) continue;
            if (next.role !== 'tool') break;
            if (next.tool_call_id) fulfilledIds.add(next.tool_call_id);
          }
          for (const tc of msg.tool_calls) {
            if (!fulfilledIds.has(tc.id)) {
              padded.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify({ cancelled: true, reason: 'user_stop' })
              });
            }
          }
        }
      }
      session.messages = padded;
    }
    session.status = 'idle';
    session.doneEmitted = true;
    session.waitingForUser = false;
    session.pendingToolCallId = null;
    // 先推"终止"事件给还连着的客户端，然后清空 backlog 并关闭 SSE：
    // 顺序颠倒会让事件落进被清空的 backlog 或发到已关闭的连接。
    agentSession.pushEvent(sessionId, 'error', { message: '用户已停止任务' });
    session.eventBacklog = [];
    for (const client of session.sseClients.splice(0)) {
      try { client.end(); } catch {}
    }
  }

  res.json({ success: true });
});

module.exports = router;
