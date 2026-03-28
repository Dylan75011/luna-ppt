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

// API路由
app.use('/api', routes);

// 确保输出目录存在
const outputDir = path.resolve(config.outputDir);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`创建输出目录: ${outputDir}`);
}

// 主页
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>OpenClaw PPT - 智能PPT生成工具</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          background: white;
          border-radius: 20px;
          padding: 60px;
          text-align: center;
          box-shadow: 0 25px 50px rgba(0,0,0,0.2);
          max-width: 600px;
        }
        h1 {
          font-size: 48px;
          color: #333;
          margin-bottom: 20px;
        }
        .subtitle {
          color: #666;
          font-size: 20px;
          margin-bottom: 40px;
        }
        .features {
          text-align: left;
          margin: 30px 0;
        }
        .feature {
          padding: 15px 20px;
          background: #f8f9fa;
          border-radius: 10px;
          margin: 10px 0;
          display: flex;
          align-items: center;
        }
        .feature-icon {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          margin-right: 15px;
          font-size: 20px;
        }
        .btn {
          display: inline-block;
          padding: 15px 40px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          text-decoration: none;
          border-radius: 30px;
          font-size: 18px;
          margin: 10px;
          transition: transform 0.2s;
        }
        .btn:hover {
          transform: translateY(-2px);
        }
        .btn-secondary {
          background: #333;
        }
        .api-info {
          margin-top: 30px;
          padding: 20px;
          background: #f8f9fa;
          border-radius: 10px;
          text-align: left;
        }
        .api-info code {
          background: #e9ecef;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>OpenClaw PPT</h1>
        <p class="subtitle">智能PPT生成工具 - 支持模板化和AI辅助</p>

        <div class="features">
          <div class="feature">
            <div class="feature-icon">📊</div>
            <div>
              <strong>多场景模板</strong><br>
              <small>车展策划、商业计划、产品发布、会议汇报</small>
            </div>
          </div>
          <div class="feature">
            <div class="feature-icon">🤖</div>
            <div>
              <strong>AI智能生成</strong><br>
              <small>输入主题，自动生成PPT内容大纲</small>
            </div>
          </div>
          <div class="feature">
            <div class="feature-icon">🎨</div>
            <div>
              <strong>在线编辑</strong><br>
              <small>可视化编辑，实时预览</small>
            </div>
          </div>
          <div class="feature">
            <div class="feature-icon">⬇️</div>
            <div>
              <strong>一键下载</strong><br>
              <small>生成PPTX文件，快速下载</small>
            </div>
          </div>
        </div>

        <div>
          <a href="/app.html" class="btn">打开编辑器</a>
          <a href="/api/health" class="btn btn-secondary">API状态</a>
        </div>

        <div class="api-info">
          <strong>API接口:</strong><br><br>
          <code>GET /api/templates</code> - 获取模板列表<br>
          <code>GET /api/templates/:id</code> - 获取模板详情<br>
          <code>POST /api/ppt/generate</code> - 生成PPT<br>
          <code>POST /api/ai/generate-outline</code> - AI生成大纲<br>
          <code>GET /api/files/list</code> - 文件列表
        </div>
      </div>
    </body>
    </html>
  `);
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
