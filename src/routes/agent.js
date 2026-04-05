// Brain Agent 路由
const express = require('express');
const router  = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const agentSession = require('../services/agentSession');
const brainAgent   = require('../agents/brainAgent');
const { executeTool } = require('../services/toolRegistry');
// lazy require: pdf-parse is problematic in Node.js without full DOM
let _parseUploadedDocuments = null;
function getDocumentParser() {
  if (!_parseUploadedDocuments) {
    _parseUploadedDocuments = require('../services/documentParser').parseUploadedDocuments;
  }
  return _parseUploadedDocuments;
}
const wm = require('../services/workspaceManager');

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
  return process.env.OPENCLAW_MOCK_AGENT_HOLD === '1';
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
  session.messages = normalizeRestoreMessages(snapshot.messages);
  session.bestPlan = snapshot.bestPlan || null;
  session.userInput = snapshot.userInput || null;
  session.docHtml = typeof snapshot.docHtml === 'string' ? snapshot.docHtml : '';
  session.brief = snapshot.brief || null;
  session.planItems = Array.isArray(snapshot.planItems) ? snapshot.planItems : [];
  session.researchStore = Array.isArray(snapshot.researchStore) ? snapshot.researchStore : [];
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

function ensureAgentImageDir() {
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

async function persistUploadedImages(files = []) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const outputDir = ensureAgentImageDir();
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
    attachments.push({
      id: `att_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      name: file.originalname || fileName,
      mimeType: file.mimetype || 'image/jpeg',
      size: file.size || 0,
      url: `/output/agent-inputs/${fileName}`,
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
    const { message, spaceId, sessionId: existingSessionId, isNewConversation } = req.body;
    const apiKeys = safeJsonParse(req.body.apiKeys, {});
    const restoreSession = safeJsonParse(req.body.restoreSession, null);
    const attachments = await persistUploadedImages(req.files || []);
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
      if (existing && existing.status !== 'running' && existing.status !== 'waiting_for_user') {
        session = existing;
        session.stopRequested = false;
        session.doneEmitted = false;
        session.eventBacklog = [];
        if (apiKeys) Object.assign(session.apiKeys, apiKeys);
      }
    }

    if (!session) {
      session = agentSession.createSession({
        sessionId: existingSessionId && !isNewConversation ? existingSessionId : '',
        apiKeys: apiKeys || {},
        spaceId: spaceId || ''
      });
      if (existingSessionId && !isNewConversation && restoreSession) {
        restoreSessionFromSnapshot(session, restoreSession);
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
      brainAgent.run(session, message?.trim() || '', onEvent, { attachments, documents, workspaceDocs }).catch(err => {
        console.error('[agent/start] error:', err);
        agentSession.pushEvent(session.sessionId, 'error', { message: err.message });
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
    res.status(500).json({ success: false, message: error.message || '启动失败' });
  }
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
    const { reply } = req.body;
    const apiKeys = safeJsonParse(req.body.apiKeys, {});
    const attachments = await persistUploadedImages(req.files || []);
    const documents = await getDocumentParser()(req.files || []);
    const workspaceRefIds = safeJsonParse(req.body.workspaceRefs, []);
    const workspaceDocs = resolveWorkspaceDocs(workspaceRefIds);

    const session = agentSession.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: '会话不存在' });
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

    const onEvent = (eventType, data) => {
      if (eventType === 'done') session.doneEmitted = true;
      agentSession.pushEvent(sessionId, eventType, data);
    };

    brainAgent.resume(session, reply?.trim() || '', onEvent, { attachments, documents, workspaceDocs }).catch(err => {
      console.error('[agent/reply] error:', err);
      agentSession.pushEvent(sessionId, 'error', { message: err.message });
      session.status = 'failed';
    });

    res.json({
      success: true,
      streamUrl: `/api/agent/stream/${sessionId}`,
      attachments: toPublicAttachments(attachments),
      documents: documents.map(d => ({ id: d.id, name: d.name, type: d.type, pages: d.pages, size: d.size, error: d.error }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || '回复失败' });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, message: `文件上传失败：${err.message}` });
  }
  if (err) {
    return res.status(500).json({ success: false, message: err.message || '请求处理失败' });
  }
  return next();
});

/**
 * POST /api/agent/:sessionId/build-ppt
 * 基于当前会话里已确认的策划文档生成 PPT
 */
router.post('/:sessionId/build-ppt', (req, res) => {
  const { sessionId } = req.params;
  const { docContent, apiKeys, planData, userInput, spaceId } = req.body || {};
  let session = agentSession.getSession(sessionId);
  let effectiveSessionId = sessionId;

  if (!session) {
    if (!planData || !userInput) {
      return res.status(404).json({ success: false, message: '会话不存在' });
    }
    session = agentSession.createSession({
      apiKeys: apiKeys || {},
      spaceId: spaceId || ''
    });
    effectiveSessionId = session.sessionId;
    session.bestPlan = planData;
    session.userInput = userInput;
    session.docHtml = typeof docContent === 'string' ? docContent : '';
    session.brief = userInput || null;
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

  executeTool('build_ppt', { note: session.docHtml || '' }, session, onEvent)
    .then(() => {
      if (session.status === 'running') {
        session.status = 'idle';
      }
    })
    .catch((err) => {
      console.error('[agent/build-ppt] error:', err);
      agentSession.pushEvent(sessionId, 'error', { message: err.message });
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
  const session = agentSession.getSession(sessionId);

  if (session) {
    session.stopRequested = true;
    session.status = 'idle';
    session.doneEmitted = true;
    session.eventBacklog = [];
    agentSession.pushEvent(sessionId, 'error', { message: '用户已停止任务' });
  }

  res.json({ success: true });
});

module.exports = router;
