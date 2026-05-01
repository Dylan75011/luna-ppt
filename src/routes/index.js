// 路由汇总
const express = require('express');
const router = express.Router();

const templatesRouter = require('./templates');
const pptRouter = require('./ppt');
const filesRouter = require('./files');
const workspaceRouter = require('./workspace');
const agentRouter     = require('./agent');

// 挂载路由
router.use('/templates', templatesRouter);
router.use('/ppt', pptRouter);
router.use('/files', filesRouter);
router.use('/workspace', workspaceRouter);
router.use('/agent', agentRouter);

// 健康检查
router.get('/health', (req, res) => {
  let writeStats = null;
  try {
    writeStats = require('../services/conversationStore').getWriteStats();
  } catch {}
  res.json({
    success: true,
    message: 'Luna PPT服务运行中',
    version: '1.0.0',
    db: writeStats  // SQLite 写入统计：retry / failed 计数累加是迁出 DatabaseSync 的强信号
  });
});

module.exports = router;
