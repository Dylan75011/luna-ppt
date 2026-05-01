# 系统架构

## 定位

Luna（活动策划助手）是一个基于大模型的智能活动策划平台，服务于汽车、手机、智能硬件等各类品牌的线下发布会与展览活动策划。系统通过自然语言对话理解用户需求，自动完成需求分析、市场研究、方案生成、PPT 制作的全流程。

---

## 核心架构：Brain Agent + Function Calling

系统采用 **ReAct（Reasoning + Acting）** 模式，以 **Brain Agent** 为核心中枢，通过函数调用（Function Calling）驱动整个工作流程。

```
用户输入（自然语言）
       │
       ▼
┌─────────────────────────────────────────────────────┐
│                   Brain Agent                        │
│            (MiniMax + Function Calling)              │
│                                                      │
│  意图判断 → 选择工具 → 执行 → 评估结果 → 循环/结束  │
└──────────┬──────────────────────────────────────────┘
           │
           ├── web_search ──→ 搜索素材
           ├── web_fetch  ──→ 读取网页
           ├── run_strategy ──→ 生成策划方案
           ├── build_ppt   ──→ 生成 PPT
           ├── write_todos ──→ 任务管理
           ├── update_brief ──→ 简报整理
           └── ask_user   ──→ 需求确认
```

### 与旧架构的差异

| 旧架构 | 新架构 |
|--------|--------|
| 5 个独立 Agent 串联执行 | 1 个 Brain Agent 自主决策 |
| 固定流程（Orchestrator → Research → Strategy → Critic → PPT Builder） | 动态流程，Brain 根据上下文选择工具 |
| 代码编排 + 硬编码循环 | ReAct + Function Calling |
| 评审循环最多 3 轮 | Brain 自行判断是否需要重新生成 |
| 前端轮询进度 | SSE 实时推送 |
| 无长期记忆 | Platform Memory 跨项目方法论沉淀 |
| 无空间感知 | Space Index 任务上下文自动积累 |

---

## Brain Agent 内部机制

### ReAct 循环

```
while (turn < MAX_TURNS) {
  1. 思考意图（MiniMax Text-01）
  2. 决定是否调用工具：
     - 是 → 执行工具 → 评估结果 → 继续循环
     - 否 → 返回最终回答 → 结束
}
MAX_TURNS = 20（防止无限循环）
```

### 思考过滤（ThinkFilter）

MiniMax-Text-01 模型输出包含 `<think>`...`</think>` 思考块。系统在推送给前端前自动过滤，只保留正文：

```js
// agents/brainAgent.js
const thinkBlockRegex = /<think>[\s\S]*?<\/think>/gi;
const filteredText = rawText.replace(thinkBlockRegex, '').trim();
```

### 循环检测

| 触发条件 | 行为 |
|---------|------|
| 同参数工具调用 3 次 | 注入警告消息告知 Brain "工具似乎未生效" |
| 同参数工具调用 5 次 | 强制停止循环，返回错误 |
| 超过 MAX_TURNS（20） | 自动结束对话 |

### 上下文管理

| 参数 | 值 | 说明 |
|------|-----|------|
| `TOOL_RESULT_MAX_CHARS` | 4000 | 单条工具结果截断到 4000 字符 |
| `CONTEXT_TOKEN_WARN` | 60000 | Token 接近上限时注入警告 |
| `MAX_SYSTEM_PROMPT` | 8000 | 系统提示词最大长度 |

### 会话状态机

```
idle ──[start]──→ running ──[done]──→ idle
                  │
                  ├──[ask_user]──→ waiting_for_answer ──[answer]──→ running
                  │
                  └──[stop]──→ stopped
```

---

## 模块划分

### 后端模块（`src/`）

| 目录 | 文件 | 职责 |
|------|------|------|
| `agents/` | `brainAgent.js` | Brain Agent 核心：ReAct 循环、工具调用、思考过滤 |
| `agents/` | `pptBuilderAgent.js` | PPT 结构生成：根据策划方案输出 PPT JSON |
| `agents/` | `imageAgent.js` | 配图搜索：Pexels 搜索 + MiniMax AI 生图 |
| `services/` | `toolRegistry.js` | 工具注册表：7 个工具的定义和执行器 |
| `services/` | `agentSession.js` | 会话管理：内存存储 SSE 状态、消息历史、附件 |
| `services/` | `llmClients.js` | LLM 客户端：MiniMax / DeepSeek 统一封装 |
| `services/` | `webSearch.js` | 搜索服务：MiniMax Web Search → Tavily → DuckDuckGo 降级 |
| `services/` | `webFetch.js` | 网页抓取：Jina Reader API 提取网页正文（Markdown） |
| `services/` | `visionMcp.js` | 图片理解：MiniMax VLM 视觉模型（`/v1/coding_plan/vlm`） |
| `services/` | `documentParser.js` | 文档解析：PDF / DOCX 提取文本 |
| `services/` | `previewRenderer.js` | 幻灯片渲染：PPT JSON → HTML |
| `services/` | `pptGenerator.js` | PPT 生成：JSON → PPTX 文件 |
| `services/` | `slideDesigner.js` | 幻灯片设计器：新版 layout 驱动渲染 |
| `services/` | `workspaceManager.js` | 空间管理：多租户文档空间、空间索引 |
| `services/` | `platformMemory.js` | 平台记忆：跨项目方法论沉淀（JSON 文件） |
| `services/` | `conversationStore.js` | 会话历史：SQLite 持久化存储 |
| `services/` | `imageSearch.js` | 图片搜索：Pexels API + MiniMax 图片生成 |
| `services/` | `imageAnalyzer.js` | 图片分析：亮度/对比度/安全文字区域 |
| `skills/` | `strategize.js` | 方案生成（MiniMax） |
| `skills/` | `critique.js` | 方案评审（DeepSeek V4-Pro） |
| `skills/` | `writeDoc.js` | 文档渲染（MiniMax） |
| `prompts/` | `brain.js` | Brain Agent 系统提示词 |
| `prompts/` | `strategy.js` | 策略提示词 |
| `prompts/` | `critic.js` | 评审提示词 |
| `prompts/` | `pptBuilder.js` | PPT Builder 提示词（16KB，完整结构） |
| `prompts/` | `docWriter.js` | 文档写作提示词 |
| `routes/` | `agent.js` | Brain Agent 接口（SSE + HTTP） |
| `routes/` | `workspace.js` | 文档空间 CRUD + Word 导入导出 |
| `routes/` | `files.js` | PPTX 文件下载/列表/删除 |
| `routes/` | `templates.js` | 模板管理 |
| `routes/` | `ppt.js` | PPT 生成（旧版兼容） |

### 前端模块（`frontend/src/`）

| 目录 | 文件 | 职责 |
|------|------|------|
| `views/` | `AgentView.vue` | 智能体界面：对话、工具调用、PPT 预览 |
| `views/` | `WorkspaceView.vue` | 文档空间：树形文档管理 |
| `views/` | `TemplatesView.vue` | 模板中心：PPT 模板浏览 |
| `views/` | `SettingsView.vue` | 配置中心：API Key 设置 |
| `components/` | `NotionEditor.vue` | 富文本编辑器（Tiptap） |
| `components/` | `PlanDocumentPanel.vue` | 策划文档面板 |
| `components/` | `SlideViewer.vue` | 幻灯片预览组件（16:9 自适应） |

---

## 数据流

```
用户消息
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│  Brain Agent ReAct 循环                                    │
│                                                           │
│  1. 思考意图 → 选择工具                                     │
│  2. 执行工具（web_search / run_strategy / ...）           │
│  3. 评估结果 → 继续或结束                                   │
└────────────────────────┬─────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    web_search      run_strategy      build_ppt
    (素材搜集)       (方案生成)        (PPT生成)
         │               │               │
         │          strategize           │
         │          + critique           │
         │          (多轮评审)           │
         │               │               │
         └───────────────┴───────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   PPT JSON 输出      │
              └──────────┬──────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
   pptGenerator.js              previewRenderer.js
   (PPTX 文件)                    (HTML 预览)
```

---

## 多 Agent 协作（run_strategy 内部）

当 Brain Agent 调用 `run_strategy` 时，内部触发多 Agent 协作：

```
run_strategy 调用
       │
       ▼
┌─────────────────┐
│  strategize     │  MiniMax（策划方案生成）
│  (第1轮)         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   critique      │  DeepSeek V4-Pro（方案评审）
│   (第1轮)        │  评分 < 7.0 → 继续
└────────┬────────┘
         │ 循环（最多3轮）
         ▼
┌─────────────────┐
│  strategize     │  MiniMax（方案优化，携带上轮评审意见）
│  (第2轮/第3轮)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   critique      │  DeepSeek V4-Pro
└────────┬────────┘
         │ 通过（≥7.0）或达到最大轮次
         ▼
┌─────────────────┐
│   writeDoc      │  MiniMax（Markdown → Tiptap HTML）
└─────────────────┘
```

### 评审维度

| 维度 | 权重 | 说明 |
|------|------|------|
| 主题创意度 | 20% | 差异化记忆点，能在同类活动中脱颖而出 |
| 目标可达性 | 20% | KPI 合理，执行路径清晰可落地 |
| 预算合理性 | 20% | 各项分配符合行业规范 |
| 内容专业度 | 20% | 策划逻辑严谨，细节到位 |
| 亮点竞争力 | 20% | 有令人印象深刻的核心亮点 |

综合评分 ≥ 7.0 通过（可配置 `CRITIC_PASS_SCORE`）。

---

## 空间索引与平台记忆

系统维护两层长期上下文，在正式任务前加载到 Brain Agent：

### 空间索引（Space Index）

- 每个 Space 有一个隐藏的 `README` 节点（`systemType: space_index`）
- 记录该空间的项目背景、资产、最近任务摘要
- 对用户不可见（隐藏于工作树）
- 任务完成后 `upsertSpaceIndexFromTask()` 自动追加任务记录
- `rewriteSpaceIndexWithAI()` 调用 MiniMax 重写，淘汰噪声，限制长度

### 平台记忆（Platform Memory）

存储在 `data/platform-memory.json`，包含：

```json
{
  "summary": "平台当前方法论概括",
  "principles": ["跨任务稳定的策划原则"],
  "patterns": ["值得复用的结构/表达/策划模式"],
  "pitfalls": ["需要避免的常见失误"],
  "recentLearnings": ["最近高价值经验（最多6条）"],
  "updatedAt": "ISO时间戳"
}
```

**评分算法**（决定保留哪些、淘汰哪些）：

```
score = freshness + usage
freshness = max(0, 6 - ageDays / 20)  // 越新鲜越高
usage = min(useCount, 8)               // 使用次数越多越高
```

每类最多保留 8 条（principles / patterns / pitfalls 各 8，recentLearnings 最多 6 条）。

**更新时机**：每次 `run_strategy` 成功后，调用 `updateMemoryFromTask()` 触发 AI 重写。

---

## 搜索降级策略

```
MiniMax Web Search（Token Plan）
         │ 失败 / 无 key
         ▼
     Tavily API
         │ 失败 / 无 key
         ▼
   DuckDuckGo（HTML 解析，无需 key）
         │ 失败
         ▼
    空数组 + warning，继续基于通用知识生成
```

### web_fetch 抓取链

```
用户指定 URL
       │
       ▼
Jina Reader API（https://r.jina.ai/）
  - 免费，无需 key
  - 返回 Markdown 格式
  - 超时 12s
  - 内容截断到 2500 字符
       │ 失败
       ▼
    返回 null
```

---

## 图片生成与搜索（ImageAgent）

```
策划方案完成
    │
    ▼
ImageAgent.run()
    │
    ├── 视觉风格分析
    │   - 优先使用 plan.visualTheme（已含 imageKeywords）
    │   - 回退：MiniMax 推断
    │
    ├── 生成搜索词（MiniMax）
    │   - cover / content / end 三类
    │   - 每页一个 page query
    │   - 统一视觉风格约束
    │
    ├── Pexels 搜索
    │   - perQuery=2-8 张
    │   - 每页最多 12 张候选
    │
    ├── MiniMax AI 生成封面图
    │   - 有 key 时尝试
    │   - 下载并处理为 1920×1080 JPEG 82%
    │
    ├── 图片评分选择
    │   - 亮度 28-145 + 对比度 22-78 加分
    │   - treatment 类型匹配（full-bleed-dark / editorial-fade / ...）
    │   - 去重：同 ID / 相近色系扣分
    │
    └── 输出
        { cover[], content[], end[], pages[] }
```

### treatment 类型映射

| layout | treatment | 说明 |
|--------|-----------|------|
| `immersive_cover` | full-bleed-dark | 全出血深色封面 |
| `end_card` | quiet-finale | 静谧结尾 |
| `split_content` | split-atmosphere | 分割氛围 |
| `data_cards` | subtle-grid | 细腻网格 |
| `editorial_quote` | editorial-fade | 编辑淡化 |
| 其他 | ambient-texture | 环境纹理 |

### 图片角色（page role）

`cover` / `editorial` / `highlights` / `journey` / `timeline` / `metrics` / `ending` / `story`

---

## 会话管理

### agentSession.js（内存，TTL 2h）

```
内存 Map<sessionId, Session>
  Session {
    id: string
    status: 'idle' | 'running' | 'waiting_for_answer' | 'stopped'
    messages: Message[]
    attachments: Attachment[]
    documents: Document[]
    userInput: Brief
    plan: Plan | null
    brief: Brief
    todos: Todo[]
    eventBacklog: Event[]  // 最多80条，晚连 SSE 回放
    spaceId: string
    createdAt: timestamp
    lastSeen: timestamp
  }
```

- 内存存储，TTL 2 小时自动清理
- 最多 200 个并发 session
- `eventBacklog` 支持晚连的 SSE 客户端回放最近 80 条事件

### conversationStore.js（SQLite，持久化）

```sql
表: conversations
  id TEXT PRIMARY KEY
  workspace_id TEXT NOT NULL
  title TEXT NOT NULL
  status TEXT DEFAULT 'active'
  state_json TEXT -- brief/todos/plan 等状态（JSON）
  created_at TEXT
  updated_at TEXT
  last_message_at TEXT

表: conversation_messages
  id TEXT PRIMARY KEY
  conversation_id TEXT NOT NULL (外键 → conversations.id ON DELETE CASCADE)
  sort_order INTEGER NOT NULL
  payload_json TEXT -- 完整消息对象（JSON）
  created_at TEXT

PRAGMA: WAL 模式，外键约束开启
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MINIMAX_API_KEY` | — | MiniMax API Key（主力模型） |
| `MINIMAX_BASE_URL` | `https://api.minimaxi.com/v1` | MiniMax API 地址 |
| `MINIMAX_MODEL` | `MiniMax-M2.7-highspeed` | MiniMax 模型名 |
| `DEEPSEEK_API_KEY` | — | DeepSeek API Key（仅 Critic） |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek API 地址 |
| `DEEPSEEK_REASONER_MODEL` | `deepseek-v4-pro` | DeepSeek 推理模型（thinking 模式由代码显式启用） |
| `TAVILY_API_KEY` | — | Tavily 搜索 Key（可选） |
| `JINA_API_KEY` | — | Jina Reader Key（可选） |
| `PEXELS_API_KEY` | — | Pexels 图片搜索 Key |
| `CRITIC_PASS_SCORE` | `7.0` | 评审通过分数 |
| `CRITIC_MAX_ROUNDS` | `3` | 评审最大轮次 |
| `PORT` | `3000` | 服务端口 |
| `OUTPUT_DIR` | `./output` | PPTX 文件输出目录 |
