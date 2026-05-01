# 实施说明

## 项目结构

```
luna-ppt/
├── src/                          # 后端
│   ├── agents/
│   │   ├── baseAgent.js          # Agent 基类（callLLMJson / callLLMStream）
│   │   ├── brainAgent.js          # Brain Agent（ReAct 循环）
│   │   ├── pptBuilderAgent.js    # PPT 结构生成
│   │   └── imageAgent.js          # 配图搜索 + AI 生图
│   │
│   ├── services/
│   │   ├── agentSession.js        # 会话管理（SSE 状态，内存 Map）
│   │   ├── toolRegistry.js        # 工具定义与执行器
│   │   ├── llmClients.js          # MiniMax / DeepSeek 客户端封装
│   │   ├── webSearch.js           # 搜索服务（降级链）
│   │   ├── webFetch.js            # 网页抓取（Jina Reader）
│   │   ├── visionMcp.js           # 图片理解（MiniMax VLM）
│   │   ├── documentParser.js      # PDF / DOCX 解析
│   │   ├── previewRenderer.js     # PPT JSON → HTML
│   │   ├── pptGenerator.js        # PPT JSON → PPTX（pptxgenjs）
│   │   ├── slideDesigner.js       # 幻灯片设计器（新版 layout）
│   │   ├── workspaceManager.js    # 文档空间管理（JSON 文件）
│   │   ├── platformMemory.js      # 平台记忆（JSON 文件）
│   │   ├── conversationStore.js   # 会话历史（SQLite）
│   │   ├── imageSearch.js         # Pexels 搜索 + MiniMax 图片生成
│   │   ├── imageAnalyzer.js       # 图片分析（亮度/对比度/安全区域）
│   │   ├── outputPaths.js         # 输出路径工具
│   │   └── ...
│   │
│   ├── skills/                    # 策划技能
│   │   ├── strategize.js         # 方案生成（MiniMax）
│   │   ├── critique.js           # 方案评审（DeepSeek V4-Pro）
│   │   └── writeDoc.js           # 文档渲染
│   │
│   ├── prompts/                  # 提示词模板
│   │   ├── brain.js              # Brain Agent 系统提示词
│   │   ├── strategy.js           # 策略提示词
│   │   ├── critic.js             # 评审提示词
│   │   ├── pptBuilder.js        # PPT Builder 提示词（16KB）
│   │   └── docWriter.js          # 文档写作提示词
│   │
│   ├── utils/
│   │   └── llmUtils.js           # LLM 调用封装（重试 / JSON 提取 / Markdown 过滤）
│   │
│   ├── routes/
│   │   ├── agent.js              # Brain Agent 接口（SSE + HTTP）
│   │   ├── workspace.js           # 文档空间 CRUD + Word 导入导出
│   │   ├── files.js              # 文件管理接口
│   │   ├── templates.js          # 模板接口
│   │   └── ppt.js                # PPT 生成（旧版兼容）
│   │
│   ├── config.js                 # 配置文件（合并 env + defaults）
│   └── server.js                 # Express 入口（路由注册 / 中间件 / SSE）
│
├── frontend/                     # 前端（Vue 3 + Vite）
│   ├── src/
│   │   ├── views/
│   │   │   ├── AgentView.vue      # 智能体对话界面
│   │   │   ├── WorkspaceView.vue  # 文档空间管理
│   │   │   ├── TemplatesView.vue  # 模板中心
│   │   │   └── SettingsView.vue   # 配置中心
│   │   ├── components/
│   │   │   ├── NotionEditor.vue   # 富文本编辑器（Tiptap）
│   │   │   ├── PlanDocumentPanel.vue
│   │   │   └── SlideViewer.vue    # 幻灯片预览
│   │   ├── router/
│   │   │   └── index.js
│   │   └── App.vue
│   └── package.json
│
├── data/                        # 数据存储
│   ├── workspaces.json         # 空间树结构
│   ├── docs/                   # 文档内容（JSON 文件，id.json 命名）
│   ├── platform-memory.json    # 平台记忆（跨项目方法论）
│   └── platform.sqlite         # SQLite（会话历史）
│
├── public/                     # 静态资源（前端构建输出）
├── output/                     # 生成的 PPTX / 图片文件
├── scripts/                    # 工具脚本
├── docs/                       # 项目文档
└── package.json
```

---

## 环境变量

```env
# 后端服务
PORT=3000

# MiniMax（主力模型）
MINIMAX_API_KEY=sk-cp-xxx
MINIMAX_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_MODEL=MiniMax-M2.7-highspeed

# DeepSeek（仅 Critic）
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_REASONER_MODEL=deepseek-v4-pro

# 搜索服务（可选）
TAVILY_API_KEY=
JINA_API_KEY=

# 图片搜索
PEXELS_API_KEY=PicqD7mq8tG2jFWuJ2E18DbTDDhq54ycV8Pvp9fxTAY0HjzK9RhdFVxW

# 评审配置
CRITIC_PASS_SCORE=7.0
CRITIC_MAX_ROUNDS=3

# 文件输出
OUTPUT_DIR=./output
```

---

## 安装与运行

### 后端

```bash
npm install
npm run dev        # 开发模式（nodemon 监听）
npm run build      # 前端构建（输出到 public/）
npm start          # 生产运行
```

### 前端

```bash
cd frontend
npm install
npm run dev        # 开发模式（Vite 热更新，端口由 Vite 分配）
npm run build      # 生产构建（输出到 ../public/）
```

前端构建后会输出 `public/assets/index-*.js` 和 `public/index.html`，后端 `server.js` 将 `public/` 作为静态文件目录。

---

## 核心模块说明

### Brain Agent（`agents/brainAgent.js`）

ReAct 主循环实现：

```js
while (turn < MAX_TURNS) {
  // 1. 构建消息历史（含 system prompt + memory + space context + messages）
  // 2. 调用 MiniMax + tools（Function Calling）
  // 3. 若有 tool_calls：
  //    - 执行工具（toolRegistry）
  //    - SSE 推送 tool_call / tool_result
  //    - 将结果注入消息历史
  //    - 继续循环
  // 4. 若无 tool_calls：返回回答，结束
  turn++;
}
MAX_TURNS = 20
```

关键机制：
- `ThinkFilter`：过滤 `<think>` 块后再推送 SSE
- `injectWarningLoopDetected`：同参数工具 3 次调用时注入警告
- `CONTEXT_TOKEN_WARN`：Token 超 60000 时注入警告
- `TOOL_RESULT_MAX_CHARS`：工具结果截断到 4000 字符

### LLM 客户端（`services/llmClients.js`）

```js
// MiniMax（文本 + Function Calling）
callMinimax(messages, options)          // 流式
callMinimaxJson(messages, options)      // JSON 模式

// DeepSeek Reasoner（纯推理）
callDeepseekReasoner(messages, options) // 流式输出，直接解析
extractJson(raw)                        // 从纯文本推理中提取 JSON
```

所有调用均包含重试逻辑（2 次重试，间隔 2s）。

### 会话管理（`services/agentSession.js`）

```js
// 内存 Map，最大 200 个 session
const sessions = new Map(); // <sessionId, Session>

// Session 结构
{
  id: string,
  status: 'idle' | 'running' | 'waiting_for_answer' | 'stopped',
  messages: Message[],           // 对话历史
  attachments: Attachment[],     // 上传的图片
  documents: Document[],        // 上传的文档
  userInput: Brief,             // 当前简报
  plan: Plan | null,            // 策划方案
  brief: Brief,                 // 任务简报
  todos: Todo[],                // 任务列表
  eventBacklog: Event[],        // SSE 事件回放（最多 80 条）
  spaceId: string,
  createdAt: number,
  lastSeen: number
}
```

TTL 2 小时自动清理（`lastSeen` 作为依据）。

### 对话持久化（`services/conversationStore.js`）

SQLite 数据库，表结构：

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  state_json TEXT NOT NULL DEFAULT '{}',  -- brief/todos/plan
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_message_at TEXT
);

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,          -- 外键 → conversations.id
  sort_order INTEGER NOT NULL,
  payload_json TEXT NOT NULL,              -- 完整消息对象
  created_at TEXT NOT NULL
);

-- 索引
CREATE INDEX idx_conversations_workspace_updated ON conversations(workspace_id, updated_at DESC);
CREATE INDEX idx_messages_conversation_sort ON conversation_messages(conversation_id, sort_order ASC);
```

WAL 模式，外键开启。`saveConversationSnapshot` 使用事务批量写入。

### 空间管理（`services/workspaceManager.js`）

- `workspaces.json`：树形结构（spaces → folders → documents）
- 每个 Space 的隐藏 `README` 节点（`systemType: space_index`）存储空间上下文
- 节点 ID 格式：`space_` / `folder_` / `doc_` 前缀 + 16 位 UUID

### 平台记忆（`services/platformMemory.js`）

存储在 `data/platform-memory.json`，AI 重写策略：

```js
// 更新时机：run_strategy 成功后
await updateMemoryFromTask({ taskId, userInput, planTitle, summary, highlights, score, apiKeys });

// AI 重写：保持短小精炼
const rewritten = await rewriteMemoryWithAI({ currentMemory, latestTask, apiKeys });
```

评分算法：
```js
score = freshness + usage
freshness = max(0, 6 - ageDays / 20)   // 越新鲜越高
usage = min(useCount, 8)                // 越常用越高
```

---

## PPT 数据流

```
run_strategy 完成（session.plan 已填充）
    │
    ▼
pptBuilderAgent.run()
    │ plan + brief + docContent + imageMap
    ▼
PPT JSON（pages[], theme{}）
    │
    ├─→ pptGenerator.generatePPT(pptData)
    │       输出：output/2024/04/ppt_xxx.pptx
    │
    └─→ previewRenderer.renderToHtml(pptData)
            输出：slides[]（HTML 字符串数组）
```

---

## PPT JSON Schema（完整）

### 旧格式（type 驱动）

```json
{
  "title": "策划方案标题",
  "theme": {
    "primary": "FF6B00",
    "secondary": "1A1A1A"
  },
  "pages": [
    {
      "type": "cover",
      "mainTitle": "品牌名",
      "subtitle": "活动名称",
      "date": "2024年4月",
      "location": "上海",
      "bgImagePath": "/output/images/xxx.jpg"
    },
    {
      "type": "toc",
      "items": [{ "num": "01", "title": "项目背景" }, { "num": "02", "title": "核心策略" }]
    },
    {
      "type": "content",
      "title": "项目背景与目标",
      "sectionNum": "01",
      "sections": [
        { "title": "核心目标", "content": ["目标1", "目标2"] },
        { "title": "市场背景", "content": ["背景1"] }
      ],
      "kpis": [{ "value": "500+", "label": "预计到场人数" }]
    },
    {
      "type": "two_column",
      "title": "竞品对比",
      "left": { "title": "我方优势", "points": ["优势1", "优势2"] },
      "right": { "title": "市场机会", "points": ["机会1", "机会2"] }
    },
    {
      "type": "cards",
      "title": "三大亮点",
      "cards": [
        { "icon": "🎯", "title": "亮点1", "desc": "描述", "features": ["特点1", "特点2"] }
      ]
    },
    {
      "type": "timeline",
      "title": "执行时间线",
      "phases": [
        { "date": "T-4周", "title": "筹备", "tasks": ["场地确认", "嘉宾邀请"] },
        { "date": "T-1周", "title": "预热", "tasks": ["传播启动"] }
      ]
    },
    {
      "type": "end",
      "mainText": "感谢观看",
      "subText": "活动口号",
      "brand": "品牌名",
      "contact": "contact@brand.com"
    }
  ]
}
```

### 新格式（layout 驱动，来自 slideDesigner）

```json
{
  "title": "策划方案标题",
  "theme": {
    "primary": "FF6B00",
    "secondary": "1A1A1A",
    "globalStyle": "dark_tech",
    "bgImage": "/output/images/theme_bg.jpg"
  },
  "pages": [
    {
      "layout": "immersive_cover",
      "content": { "title": "主标题", "subtitle": "副标题", "brand": "品牌", "date": "2024年4月" },
      "bgImagePath": "/output/images/cover.jpg"
    },
    {
      "layout": "bento_grid",
      "content": {
        "title": "亮点呈现",
        "cards": [{ "title": "亮点1", "description": "..." }]
      }
    },
    {
      "layout": "timeline_flow",
      "content": {
        "title": "执行时间线",
        "phases": [{ "date": "T-4周", "title": "筹备" }]
      }
    },
    {
      "layout": "end_card",
      "content": { "brand": "品牌", "tagline": "口号", "contact": "contact@brand.com" }
    }
  ]
}
```

### 页面类型（type）与布局（layout）对应关系

| type（旧） | layout（新） | 说明 |
|-----------|-------------|------|
| `cover` | `immersive_cover` | 全出血深色封面 |
| `toc` | `grid_toc` | 网格目录 |
| `content` | `split_content` / `bento_grid` | 分栏/网格内容 |
| `two_column` | `split_content` | 双栏对比 |
| `cards` | `bento_grid` | 卡片展示 |
| `timeline` | `timeline_flow` | 时间线 |
| `end` | `end_card` | 结束页 |

---

## 前端路由

| 路径 | 组件 | 说明 |
|------|------|------|
| `/` | → redirect `/workspace` | 首页重定向 |
| `/workspace` | WorkspaceView | 文档空间管理（默认入口） |
| `/workspace/:spaceId` | WorkspaceView | 打开指定空间 |
| `/agent` | AgentView | Brain Agent 对话（主要工作入口） |
| `/agent/:sessionId` | AgentView | 打开指定会话 |
| `/templates` | TemplatesView | PPT 模板浏览 |
| `/settings` | SettingsView | API Key 配置 |

---

## 依赖概览

| 依赖 | 版本 | 用途 |
|------|------|------|
| `express` | ^4.x | Web 框架 |
| `openai` | ^4.x | MiniMax / DeepSeek 客户端 |
| `multer` | ^1.x | 文件上传（内存模式） |
| `uuid` | ^9.x | ID 生成（sessionId / nodeId） |
| `dotenv` | ^16.x | 环境变量 |
| `pdf-parse` | ^1.x | PDF 文本提取 |
| `mammoth` | ^1.x | DOCX 文本提取 |
| `p-queue` | ^8.x | 并发控制（工具执行） |
| `node-sqlite3` | ^4.x | SQLite 驱动 |
| `marked` | ^11.x | Markdown → HTML |
| `vue` | ^3.x | 前端框架 |
| `vue-router` | ^4.x | 前端路由 |
| `@tiptap/vue-3` | ^2.x | 富文本编辑器核心 |
| `@phosphor-icons/vue` | ^2.x | 图标库 |
| `@arco-design/web-vue` | ^2.x | UI 组件库 |
| `vite` | ^5.x | 前端构建工具 |

---

## 数据文件说明

| 文件 | 格式 | 说明 |
|------|------|------|
| `data/workspaces.json` | JSON | 空间树结构，含所有 Space/Folder/Document 节点 |
| `data/docs/{id}.json` | JSON | 单个文档内容（Tiptap JSON 格式） |
| `data/platform-memory.json` | JSON | 平台记忆（principles/patterns/pitfalls 等） |
| `data/platform.sqlite` | SQLite | 会话历史（conversations + messages） |
| `output/{year}/{month}/ppt_{timestamp}.pptx` | PPTX | 生成的 PPT 文件 |
| `output/{year}/{month}/{taskId}_*.jpg` | JPEG | 下载的图片（已处理为 1920×1080 82%） |
