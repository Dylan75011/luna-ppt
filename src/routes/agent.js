// Brain Agent 路由
const express = require('express');
const router  = express.Router();
const agentSession = require('../services/agentSession');
const brainAgent   = require('../agents/brainAgent');
const { executeTool } = require('../services/toolRegistry');

/**
 * POST /api/agent/start
 * 用户发送新消息，启动 Brain 循环
 */
router.post('/start', (req, res) => {
  const { message, spaceId, apiKeys, sessionId: existingSessionId } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, message: '消息不能为空' });
  }

  // 如果传入了 sessionId 且 session 处于可复用状态，继续使用该 session
  let session = null;
  if (existingSessionId) {
    const existing = agentSession.getSession(existingSessionId);
    if (existing && (existing.status === 'idle' || existing.status === 'failed')) {
      session = existing;
      session.doneEmitted = false;  // 重置，允许本轮重新推送 done
      session.eventBacklog = [];    // 清空旧事件，防止新 SSE 客户端重放
      if (apiKeys) Object.assign(session.apiKeys, apiKeys);
    }
  }

  if (!session) {
    session = agentSession.createSession({
      apiKeys: apiKeys || {},
      spaceId: spaceId || ''
    });
  }

  const onEvent = (eventType, data) => {
    if (eventType === 'done') session.doneEmitted = true;
    agentSession.pushEvent(session.sessionId, eventType, data);
  };

  // 异步执行，不等待
  brainAgent.run(session, message.trim(), onEvent).catch(err => {
    console.error('[agent/start] error:', err);
    agentSession.pushEvent(session.sessionId, 'error', { message: err.message });
    session.status = 'failed';
  });

  res.json({
    success: true,
    sessionId: session.sessionId,
    streamUrl: `/api/agent/stream/${session.sessionId}`
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
router.post('/:sessionId/reply', (req, res) => {
  const { sessionId } = req.params;
  const { reply, apiKeys } = req.body;

  const session = agentSession.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ success: false, message: '会话不存在' });
  }
  if (session.status !== 'waiting_for_user') {
    return res.status(400).json({ success: false, message: `会话状态不正确：${session.status}` });
  }
  if (!reply || !reply.trim()) {
    return res.status(400).json({ success: false, message: '回复不能为空' });
  }

  // 如果本次携带了新的 apiKeys，合并进去（防止 key 刷新场景）
  if (apiKeys) Object.assign(session.apiKeys, apiKeys);

  // 清空 backlog，防止新 SSE 客户端重放旧的 clarification 事件
  session.eventBacklog = [];

  const onEvent = (eventType, data) => {
    if (eventType === 'done') session.doneEmitted = true;
    agentSession.pushEvent(sessionId, eventType, data);
  };

  brainAgent.resume(session, reply.trim(), onEvent).catch(err => {
    console.error('[agent/reply] error:', err);
    agentSession.pushEvent(sessionId, 'error', { message: err.message });
    session.status = 'failed';
  });

  res.json({
    success: true,
    streamUrl: `/api/agent/stream/${sessionId}`
  });
});

/**
 * POST /api/agent/:sessionId/build-ppt
 * 基于当前会话里已确认的策划文档生成 PPT
 */
router.post('/:sessionId/build-ppt', (req, res) => {
  const { sessionId } = req.params;
  const { docContent, apiKeys } = req.body || {};
  const session = agentSession.getSession(sessionId);

  if (!session) {
    return res.status(404).json({ success: false, message: '会话不存在' });
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
    agentSession.pushEvent(sessionId, eventType, data);
  };

  session.status = 'running';
  session.doneEmitted = false;

  executeTool('build_ppt', { note: session.docHtml || '' }, session, onEvent)
    .catch((err) => {
      console.error('[agent/build-ppt] error:', err);
      agentSession.pushEvent(sessionId, 'error', { message: err.message });
      session.status = 'failed';
    });

  res.json({
    success: true,
    streamUrl: `/api/agent/stream/${sessionId}`
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
    session.status = 'idle';
    agentSession.pushEvent(sessionId, 'error', { message: '用户已停止任务' });
  }

  res.json({ success: true });
});

module.exports = router;
