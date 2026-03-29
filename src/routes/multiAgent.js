// 多 Agent 路由
const express = require('express');
const router = express.Router();
const taskManager = require('../services/taskManager');
const { runMultiAgent, runPptBuilder } = require('../services/multiAgentOrchestrator');

// POST /api/multi-agent/generate
router.post('/generate', (req, res) => {
  const {
    brand, productCategory, eventType, topic, scale, budget, brandColor, style,
    requirements, apiKeys, spaceId, spaceContextSummary, spaceContextKeyPoints, spaceContextDocs
  } = req.body;

  if (!brand || !productCategory || !eventType || !topic || !scale || !budget) {
    return res.status(400).json({
      success: false,
      message: '缺少必填字段：brand / productCategory / eventType / topic / scale / budget'
    });
  }

  // apiKeys 由前端设置面板提供，优先级高于 .env
  const runtimeKeys = {
    minimaxApiKey:  (apiKeys && apiKeys.minimaxApiKey)  || '',
    deepseekApiKey: (apiKeys && apiKeys.deepseekApiKey) || '',
    minimaxModel:   (apiKeys && apiKeys.minimaxModel)   || ''
  };

  const userInput = {
    brand,
    productCategory,
    eventType,
    topic,
    scale,
    budget,
    brandColor: brandColor || '1A1A1A',
    style: style || '',
    requirements: requirements || '',
    spaceId: spaceId || '',
    spaceContextSummary: spaceContextSummary || '',
    spaceContextKeyPoints: Array.isArray(spaceContextKeyPoints) ? spaceContextKeyPoints : [],
    spaceContextDocs: Array.isArray(spaceContextDocs) ? spaceContextDocs : []
  };
  const task = taskManager.createTask(userInput);

  // 异步执行，不等待
  runMultiAgent(task.taskId, userInput, runtimeKeys).catch(err => {
    console.error('[Route] runMultiAgent error:', err);
  });

  res.json({
    success: true,
    taskId: task.taskId,
    streamUrl: `/api/multi-agent/stream/${task.taskId}`
  });
});

// GET /api/multi-agent/stream/:taskId  (SSE)
router.get('/stream/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = taskManager.getTask(taskId);

  if (!task) {
    return res.status(404).json({ success: false, message: '任务不存在' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // 如果任务已完成，直接推送最终结果
  if (task.status === 'completed' && task.result) {
    res.write(`event: done\ndata: ${JSON.stringify(task.result)}\n\n`);
    res.end();
    return;
  }

  if (task.status === 'failed') {
    res.write(`event: error\ndata: ${JSON.stringify({ message: task.error, code: 'PIPELINE_ERROR' })}\n\n`);
    res.end();
    return;
  }

  // 注册 SSE 客户端
  taskManager.addSseClient(taskId, res);

  // 发送心跳，防止超时
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    taskManager.removeSseClient(taskId, res);
  });
});

// GET /api/multi-agent/status/:taskId
router.get('/status/:taskId', (req, res) => {
  const task = taskManager.getTask(req.params.taskId);
  if (!task) return res.status(404).json({ success: false, message: '任务不存在' });

  res.json({
    taskId: task.taskId,
    status: task.status,
    currentStage: task.currentStage,
    round: task.round,
    progress: task.progress,
    result: task.status === 'completed' ? task.result : null,
    error: task.status === 'failed' ? task.error : null
  });
});

// POST /api/multi-agent/:taskId/build-ppt
// 用户在文档面板确认后，触发 PPT 生成阶段（内部自动并行搜索配图）
router.post('/:taskId/build-ppt', (req, res) => {
  const { taskId } = req.params;
  const { docContent } = req.body;

  const task = taskManager.getTask(taskId);
  if (!task) {
    return res.status(404).json({ success: false, message: '任务不存在' });
  }
  if (task.status !== 'awaiting_confirmation') {
    return res.status(400).json({ success: false, message: `任务状态不正确：${task.status}` });
  }

  // 异步执行，不等待；图片搜索在 runPptBuilder 内部并行触发
  runPptBuilder(taskId, docContent || task.docHtml).catch(err => {
    console.error('[Route] runPptBuilder error:', err);
  });

  res.json({ success: true, streamUrl: `/api/multi-agent/stream/${taskId}` });
});

module.exports = router;
