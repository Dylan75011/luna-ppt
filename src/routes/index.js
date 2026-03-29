// 路由汇总
const express = require('express');
const router = express.Router();

const templatesRouter = require('./templates');
const pptRouter = require('./ppt');
const aiRouter = require('./ai');
const filesRouter = require('./files');
const multiAgentRouter = require('./multiAgent');
const workspaceRouter = require('./workspace');

// 挂载路由
router.use('/templates', templatesRouter);
router.use('/ppt', pptRouter);
router.use('/ai', aiRouter);
router.use('/files', filesRouter);
router.use('/multi-agent', multiAgentRouter);
router.use('/workspace', workspaceRouter);

// 健康检查
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'OpenClaw PPT服务运行中',
    version: '1.0.0'
  });
});

module.exports = router;
