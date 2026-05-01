# Luna

面向活动策划行业的智能 PPT 生成工具，服务汽车、手机、智能硬件等各类品牌的线下发布会与展览活动。工具本身与任何具体品牌无关，品牌信息完全由用户输入驱动。

## 两种生成模式

### 模板模式（已上线）
选择预设模板，填写内容，一键生成 PPTX。

### 多 Agent 模式（开发中）
输入品牌和活动需求，由多个 AI Agent 协作完成：

```
需求解析 → 并行搜索素材 → 生成方案 → 专家评审迭代 → 浏览器预览 → 下载 PPTX
```

| Agent | 职责 |
|---|---|
| Orchestrator | 解析需求，拆解搜索任务 |
| Research × 3 | 并行搜索行业趋势、竞品案例、创意素材 |
| Strategy | 综合素材制定活动策划方案 |
| Critic | 专业评审打分，不达标则循环优化（最多3轮） |
| PPT Builder | 将方案转化为 PPTX，配色使用品牌主色 |

## 快速开始

```bash
npm install
cp .env.example .env   # 填写 API Key
npm start
```

访问 http://localhost:3000

## 环境变量

```env
PORT=3000
OUTPUT_DIR=./output

# 多 Agent 模式所需
MINIMAX_API_KEY=        # MiniMax Token Plan key（sk-cp- 开头），同时用于模型和 Web Search
DEEPSEEK_API_KEY=       # 仅用于 Critic Agent（按量付费）
TAVILY_API_KEY=         # 可选，MiniMax 搜索失败时的降级兜底
```

## 项目结构

```
src/
├── agents/             # 多 Agent 实现（开发中）
├── prompts/            # 各 Agent 系统提示词（开发中）
├── services/
│   ├── pptGenerator.js         # PPT 生成核心
│   ├── multiAgentOrchestrator.js  # 多 Agent 编排（开发中）
│   └── aiAssistant.js          # 旧版 AI 服务
├── routes/
│   ├── multiAgent.js   # 多 Agent API（开发中）
│   ├── ppt.js
│   ├── ai.js
│   └── templates.js
└── templates/          # 5 种预设模板 JSON
public/
├── multi-agent.html    # 多 Agent 生成器（开发中）
└── app.html            # 模板编辑器
docs/                   # 设计文档
```

## API 接口

**模板模式**

| 方法 | 路径 | 描述 |
|---|---|---|
| GET | `/api/templates` | 获取模板列表 |
| POST | `/api/ppt/generate` | 按模板生成 PPT |
| GET | `/api/files/download/:filename` | 下载文件 |

**多 Agent 模式**

| 方法 | 路径 | 描述 |
|---|---|---|
| POST | `/api/multi-agent/generate` | 触发多 Agent 生成 |
| GET | `/api/multi-agent/stream/:taskId` | SSE 实时进度 |
| GET | `/api/multi-agent/status/:taskId` | 查询任务状态 |

详细接口文档见 [docs/api.md](./docs/api.md)。

## 预设模板

`auto_show` / `product_launch` / `business_plan` / `meeting` / `simple`

## 技术栈

- **后端**：Node.js + Express
- **PPT 生成**：PptxGenJS
- **AI 模型**：MiniMax 订阅（主力）、DeepSeek V4-Pro 按量（评审专用）
- **前端**：原生 HTML/CSS/JavaScript

## 设计文档

| 文档 | 内容 |
|---|---|
| [docs/architecture.md](./docs/architecture.md) | 系统架构与 Agent 协作流程 |
| [docs/agents.md](./docs/agents.md) | 各 Agent 规格与输入输出 Schema |
| [docs/api.md](./docs/api.md) | API 接口与 SSE 事件规范 |
| [docs/preview.md](./docs/preview.md) | 预览系统设计（previewRenderer + 前端组件） |
| [docs/implementation.md](./docs/implementation.md) | 文件结构与实施路线图 |

## License

MIT
