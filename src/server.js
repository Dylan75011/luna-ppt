// OpenClaw PPT 生成服务
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const routes = require('./routes');

// 加载环境变量
require('dotenv').config();

const app = express();

// 中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件
app.use(express.static(path.join(__dirname, '../public')));
app.use('/output', express.static(path.resolve('./output')));

// API路由
app.use('/api', routes);

// 确保输出目录存在
const outputDir = path.resolve(config.outputDir);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`创建输出目录: ${outputDir}`);
}

// 确保 data/docs 目录存在
const dataDir = path.resolve('./data/docs');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`创建数据目录: ${dataDir}`);
}

// 主页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 启动服务
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║                                               ║
║   OpenClaw PPT 服务已启动                      ║
║                                               ║
║   本地访问: http://localhost:${PORT}             ║
║   API状态:  http://localhost:${PORT}/api/health ║
║                                               ║
║   按 Ctrl+C 停止服务                          ║
║                                               ║
╚═══════════════════════════════════════════════╝
  `);
});

module.exports = app;
