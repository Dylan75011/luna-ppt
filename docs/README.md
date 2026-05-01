# Luna — 活动策划助手

Luna 是一个基于大模型的智能活动策划平台，通过自然语言对话完成活动策划、市场研究、方案生成和 PPT 制作的全流程。

## 核心能力

- **自然语言交互**：通过对话理解需求，无需填写复杂表单
- **自动素材搜集**：搜索行业趋势、竞品案例、创意参考（搜索降级：MiniMax → Tavily → DuckDuckGo）
- **多轮方案优化**：DeepSeek V4-Pro 评审 + MiniMax 迭代，评分 ≥ 7.0 通过
- **PPT 生成**：Pexels 配图 + MiniMax AI 封面图，实时预览，一键下载
- **文档空间管理**：多项目隔离，策划经验自动沉淀到 Platform Memory

## 用户旅程

```
1. 创建/选择空间（/workspace）
       ↓
2. 进入智能体（/agent）
       ↓
3. 输入需求
   "为某品牌策划一场新车发布会，预算 500 万"
       ↓
4. Luna 自动完成：
   ┌─────────────────────────────────────┐
   │  update_brief    → 整理需求简报        │
   │  write_todos     → 生成任务计划       │
   │  web_search      → 搜集竞品案例        │
   │  run_strategy    → 方案生成+评审       │
   │  build_ppt       → PPT 生成           │
   └─────────────────────────────────────┘
       ↓
5. 预览 PPT → 下载 PPTX → 保存到空间
```

## 技术架构

**Brain Agent**（ReAct 模式）通过函数调用驱动工作流程：

```
意图判断 → 搜索素材 → 生成方案 → 评审优化 → 生成 PPT
```

- **MiniMax**（主力）+ **DeepSeek V4-Pro**（评审）
- 搜索降级：MiniMax → Tavily → DuckDuckGo
- 前端：Vue 3 + Vite，后端：Express
- 会话：SSE 实时推送 + SQLite 持久化
- 图片：Pexels 搜索 + MiniMax AI 生成

## 快速开始

### 配置 API Key

访问 `/settings` 页面，填入：
- **MiniMax API Key**（必须）
- **DeepSeek API Key**（可选，用于评审）

### 创建策划任务

1. 在 `/workspace` 创建或选择一个项目空间
2. 访问 `/agent`
3. 输入需求，例如：
   > "为某品牌策划一场新车发布会，预算 500 万，面向 25-35 岁白领"

Luna 自动完成：需求确认 → 素材搜集 → 方案生成（多轮评审） → PPT 制作。

### 修改与迭代

- 方案不满意？直接告诉 Luna 修改方向
- 想调整风格或预算？继续对话，Luna 更新方案
- 评审不通过？Luna 自动进行第 2/3 轮优化

## 界面说明

| 路径 | 说明 |
|------|------|
| `/workspace` | 文档空间，多项目隔离，默认入口 |
| `/agent` | 智能体对话，主要工作界面 |
| `/templates` | PPT 模板浏览 |
| `/settings` | API Key 与配置 |

## 文档索引

| 文档 | 用途 |
|------|------|
| [architecture.md](./architecture.md) | 系统架构、模块划分、数据流、搜索降级 |
| [agents.md](./agents.md) | Brain Agent 决策逻辑、7 个工具规格、Skills 规格 |
| [api.md](./api.md) | API 接口、SSE 事件格式、请求/响应示例 |
| [implementation.md](./implementation.md) | 项目结构、环境变量、SQLite Schema、PPT JSON |
| [preview.md](./preview.md) | PPT 预览系统、幻灯片渲染原理 |
