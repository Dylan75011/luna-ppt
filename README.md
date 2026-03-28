# OpenClaw PPT

智能PPT生成工具 - 支持模板化和AI辅助的PPT生成

## 功能特性

- **多场景模板**: 预设5种专业模板（车展策划、产品发布、商业计划、会议汇报、简约通用）
- **AI智能生成**: 输入主题，自动生成PPT内容大纲
- **在线编辑**: 可视化编辑界面，实时预览
- **一键下载**: 生成PPTX文件，快速下载

## 快速开始

### 安装依赖

```bash
npm install
```

### 配置环境变量

复制 `.env.example` 为 `.env`，并设置必要的环境变量：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
PORT=3000
TAVILY_API_KEY=your_tavily_api_key_here
OUTPUT_DIR=./output
```

### 启动服务

```bash
npm start
```

访问 http://localhost:3000 打开编辑器界面。

### AI功能

要启用AI生成功能，需要配置 Tavily API：

1. 访问 [Tavily API](https://tavily.com) 获取API Key
2. 在 `.env` 文件中设置 `TAVILY_API_KEY`

## 项目结构

```
openclaw-ppt/
├── src/
│   ├── server.js           # Express服务器入口
│   ├── config.js           # 配置文件
│   ├── routes/             # API路由
│   │   ├── index.js
│   │   ├── templates.js    # 模板API
│   │   ├── ppt.js          # PPT生成API
│   │   ├── ai.js           # AI生成API
│   │   └── files.js        # 文件API
│   ├── services/           # 核心服务
│   │   ├── pptGenerator.js    # PPT生成器
│   │   ├── templateManager.js  # 模板管理
│   │   └── aiAssistant.js      # AI助手
│   └── templates/           # 预设模板JSON
├── public/                  # 前端静态资源
│   ├── index.html          # 首页
│   ├── app.html            # 编辑器页面
│   ├── css/style.css
│   └── js/app.js
├── tests/                  # 测试文件
├── package.json
└── README.md
```

## API接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/templates` | 获取模板列表 |
| GET | `/api/templates/:id` | 获取模板详情 |
| POST | `/api/ppt/generate` | 生成PPT |
| POST | `/api/ai/generate-outline` | AI生成大纲 |
| POST | `/api/ai/generate-full` | AI生成完整PPT |
| GET | `/api/files/list` | 文件列表 |
| GET | `/api/files/download/:filename` | 下载文件 |

## 预设模板

1. **auto_show** - 车展策划方案
2. **product_launch** - 产品发布会
3. **business_plan** - 商业计划书
4. **meeting** - 会议汇报
5. **simple** - 简约通用

## 技术栈

- **后端**: Node.js + Express
- **PPT生成**: PptxGenJS
- **AI搜索**: Tavily API
- **前端**: 原生HTML/CSS/JavaScript

## 使用示例

### Web界面使用

1. 打开 http://localhost:3000
2. 选择模板或使用AI生成
3. 编辑内容
4. 点击「生成PPT」
5. 下载生成的PPTX文件

### API调用

```bash
# 获取模板列表
curl http://localhost:3000/api/templates

# AI生成PPT大纲
curl -X POST http://localhost:3000/api/ai/generate-full \
  -H "Content-Type: application/json" \
  -d '{"topic": "华为智界2025上海车展", "templateType": "auto_show"}'

# 生成PPT
curl -X POST http://localhost:3000/api/ppt/generate \
  -H "Content-Type: application/json" \
  -d '{"templateId": "auto_show"}'
```

## License

MIT
