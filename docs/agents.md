# Agent 规格说明

## Brain Agent（核心）

**模型**：MiniMax（主力）+ DeepSeek V4-Pro（仅 Critic）
**模式**：ReAct（Reasoning + Acting）+ Function Calling
**职责**：理解用户意图，自主选择工具完成活动策划全流程

### 系统提示词核心逻辑（src/prompts/brain.js）

Brain Agent 的决策流程：

```
收到用户消息
    │
    ├── 闲聊/问答 → 直接回答（不动用工具）
    │
    ├── 策划请求 + 信息足够 → update_brief → write_todos → web_search → run_strategy → 介绍亮点 → 等待确认 → build_ppt
    │
    ├── 策划请求 + 缺关键信息 → ask_user（只问最重要的那一个）
    │
    ├── 用户补充/修改 → update_brief → 评估影响 → 小幅调整 or 重新生成
    │
    └── 用户已有文档想生成 PPT → 确认用户同意 → build_ppt
```

### 意图判断规则

| 场景 | 判断依据 | 行动 |
|------|----------|------|
| 闲聊/打招呼 | 消息短且无明确任务关键词 | 直接回答 |
| 策划请求 | 包含品牌 + 活动类型关键词 | 开始策划流程 |
| 缺关键信息 | 缺少品牌名或活动类型 | ask_user |
| 补充/修改 | 用户在已有任务上继续说 | update_brief → 评估影响 |
| 生成 PPT | 用户明确同意生成 | build_ppt |

### 思考过滤

MiniMax-Text-01 模型输出包含 `<think>`...`</think>` 思考块。系统自动过滤，只将正文推送给前端：

```js
// agents/brainAgent.js
const thinkBlockRegex = /<think>[\s\S]*?<\/think>/gi;
const filteredText = rawText.replace(thinkBlockRegex, '').trim();
```

### 假设策略

当信息缺失时，Brain Agent 遵循以下假设策略：

| 缺失字段 | 假设方式 |
|----------|----------|
| 预算 | 根据活动类型给合理默认值 |
| 受众 | 可假设年龄段，除非明确歧义 |
| 风格 | 根据品牌/产品调性推断 |
| 规模 | 可假设中大型（500+） |

**不可假设的**：品牌名、活动类型（必须问用户）。

### 硬性约束

- 没有 `run_strategy` 成功结果，绝不调用 `build_ppt`
- `run_strategy` 耗时 1-2 分钟，调用前告知用户
- 不虚构搜索结果和案例数据
- 每次对话只维护一个活跃的策划任务

---

## 工具规格

### write_todos

更新当前任务计划，SSE 推送 `plan_update` 事件。

**参数**
```json
{
  "todos": [
    { "content": "搜索竞品案例", "status": "in_progress" },
    { "content": "制定策划方案", "status": "pending" },
    { "content": "生成 PPT", "status": "pending" }
  ]
}
```

| 字段 | 枚举值 |
|------|--------|
| status | `in_progress`、`pending`、`completed` |

**约束**：最多 8 项，超出部分截断。

---

### update_brief

整理或更新任务简报，SSE 推送 `brief_update` 事件。

**参数**
```json
{
  "brand": "品牌名称",
  "productCategory": "汽车",
  "eventType": "product_launch",
  "topic": "活动主题",
  "goal": "核心目标",
  "audience": "目标受众",
  "scale": "大型（500人以上）",
  "budget": "500万",
  "style": "高端科技感",
  "tone": "科技/年轻",
  "requirements": "补充要求",
  "assumptions": ["假设受众是25-35岁白领"]
}
```

**行为**：
- 部分字段留空时保留旧值（不覆盖）
- assumptions 最多 5 条，超出截断
- 每次调用完整替换整个 brief 对象

---

### review_uploaded_images

重新分析对话中用户上传的图片，调用 `visionMcp.analyzeAgentImages()`。

**参数**
```json
{
  "prompt": "识别品牌和产品、总结视觉风格",
  "image_ids": ["img_xxx"]
}
```

- `image_ids` 可选，不传则默认查看最近上传的全部图片
- 每张图片返回一个分析结果（120-180 字）
- 图片上传后暂存于 `session.attachments`，包含 `localPath` 供 VLM 读取

---

### web_search

搜索网页获取行业信息，SSE 推送 `tool_call` → `tool_progress` → `tool_result`。

**参数**
```json
{
  "query": "2024 车企发布会创意趋势",
  "max_results": 8
}
```

**降级链**：

```
1. MiniMax Web Search（sk-cp-xxx Token Plan）
     ↓ 失败 / 无 key
2. Tavily API（需配置 TAVILY_API_KEY）
     ↓ 失败 / 无 key
3. DuckDuckGo（无需 key，HTML 解析）
     ↓ 失败
4. 空数组 + warning（继续基于通用知识生成）
```

**返回**
```json
{
  "found": true,
  "count": 8,
  "summary": "[1] 标题1\n snippet1\n\n[2] 标题2\n snippet2",
  "results": [
    { "title": "标题", "url": "https://...", "snippet": "摘要" }
  ],
  "source": "minimax"
}
```

`source` 取值：`minimax` / `tavily` / `duckduckgo` / `unknown`。

---

### web_fetch

读取指定网页全文，调用 `webFetch.fetchPage()`。

**参数**
```json
{ "url": "https://example.com/article" }
```

- 使用 Jina Reader API（`https://r.jina.ai/`）
- 免费，无需 key
- 返回 Markdown 格式内容
- 超时 12s，内容截断到 2500 字符

**返回**
```json
{ "success": true, "content": "页面 Markdown 正文..." }
```

失败时返回 `{ "success": false }`（不抛异常，继续流程）。

---

### run_strategy

制定完整活动策划方案，内部触发多 Agent 协作。SSE 推送多轮 `tool_progress`。

**参数**
```json
{
  "brand": "品牌名称",
  "event_description": "新品发布会",
  "goal": "核心目标",
  "audience": "目标受众",
  "budget": "500万",
  "tone": "科技感",
  "requirements": "特殊要求",
  "research_context": "已搜索到的所有素材摘要"
}
```

**内部流程**：

```
1. strategize（MiniMax）
   输入：brief + research_context + round(=1) + previousFeedback(=null)
   输出：plan JSON

2. critique（DeepSeek V4-Pro）
   输入：完整 plan JSON + brief
   输出：{ score, scores{}, strengths[], weaknesses[], specificFeedback }

3. 评分 ≥ 7.0？
   - 是 → writeDoc → 返回结果
   - 否，且 round < 3 → strategize(round+1, 携带 feedback) → 循环
   - 否，且 round = 3 → 返回当前结果（不阻断）
```

**返回**
```json
{
  "success": true,
  "score": 7.5,
  "planTitle": "品牌名称 活动策划方案",
  "coreStrategy": "核心策略描述",
  "highlights": ["亮点1", "亮点2", "亮点3"],
  "sectionCount": 8,
  "visualTheme": {
    "style": "科技感+电影质感",
    "colorMood": "深蓝+光效",
    "imageKeywords": ["dark", "technology", "cinematic"]
  },
  "hasDocument": true,
  "sections": [
    {
      "title": "项目背景",
      "keyPoints": ["背景1", "背景2"]
    }
  ]
}
```

---

### build_ppt

生成 PPT 文件。**硬性前置条件**：必须有 `run_strategy` 成功结果（`session.plan !== null`）。

**参数**
```json
{ "note": "额外调整说明" }
```

**前置检查**：无策划方案时返回错误，SSE 推送 `error` 事件，不执行。

**内部流程**：

```
1. pptBuilderAgent.run()
   输入：session.plan + session.brief + docContent + imageMap
   输出：PPT JSON

2. imageAgent.run()
   输入：plan + brief + pptOutline
   输出：{ cover[], content[], end[], pages[] }
   - Pexels 搜索每类 2-8 张
   - MiniMax AI 生成封面图（可选）
   - 图片评分选择（亮度/对比度/treatment匹配/去重）

3. pptGenerator.generatePPT(pptData, outputName)
   输出：PPTX 文件到 output/

4. previewRenderer.renderToHtml(pptData)
   输出：HTML 幻灯片数组
```

**返回**
```json
{
  "success": true,
  "downloadUrl": "/api/files/download/ppt_xxx.pptx",
  "previewSlides": ["<div>...</div>", "<div>...</div>"],
  "pageCount": 12
}
```

SSE 推送多个 `slide_added` 事件（每页一个），最后推送 `done`。

---

### ask_user

向用户提问并暂停等待回答。**仅在信息真正无法假设时使用**。

**参数**
```json
{
  "question": "这次发布会主要面向哪类人群？",
  "type": "missing_info"
}
```

| type | 使用场景 |
|------|----------|
| `missing_info` | 缺少无法假设的核心信息（如完全不知道品牌） |
| `ambiguous` | 两个方向都合理，需用户选择 |
| `confirmation` | 高代价操作需用户明确同意（如 build_ppt） |
| `suggestion` | 提供选项让用户选择偏好 |

**行为**：
- SSE 推送 `clarification` 事件后断开
- Session status 变为 `waiting_for_answer`
- 前端调用 `POST /api/agent/answer` 恢复执行
- 恢复后用户回答作为新消息注入 ReAct 循环

---

## 技能模块（Skills）

### strategize（src/skills/strategize.js）

**模型**：MiniMax
**调用方式**：`skills/strategize.js` 函数内调用 `callLLMJson`

**输入**：
- `brief`：用户需求简报
- `research_context`：已搜索到的素材摘要
- `round`：当前轮次（1/2/3）
- `previousFeedback`：上轮 critique 反馈（第一轮为 null）

**输出 Schema**：
```json
{
  "planTitle": "品牌名 活动类型 策划方案",
  "coreStrategy": "一句话核心策略（20字内）",
  "highlights": ["亮点1（具体可感知）", "亮点2", "亮点3"],
  "sections": [
    {
      "title": "章节标题",
      "keyPoints": ["关键点1", "关键点2"]
    }
  ],
  "visualTheme": {
    "style": "视觉风格描述",
    "colorMood": "色彩基调",
    "imageKeywords": ["keyword1", "keyword2"]
  },
  "budget": { "total": "500万", "breakdown": [...] },
  "riskMitigation": ["风险点及对策"]
}
```

---

### critique（src/skills/critique.js）

**模型**：DeepSeek V4-Pro（thinking 模式，返回链式推理）
**调用方式**：`prompts/critic.js` 构建 prompt → `callDeepseekReasoner()` → `extractJson()`

**输入**：完整策划方案 JSON + 用户 brief（含 brand/eventType/budget/productCategory）

**输出**：
```json
{
  "score": 7.5,
  "passed": true,
  "scores": {
    "creativity": 8.0,
    "achievability": 7.0,
    "budget": 7.5,
    "professionalism": 8.0,
    "competitiveness": 7.0
  },
  "strengths": ["优点1（具体说明）", "优点2"],
  "weaknesses": ["不足1（具体指出问题）", "不足2"],
  "specificFeedback": "针对具体章节的改进建议（200字以内）",
  "round": 1
}
```

**评分要求**：
- 7.0 以上才算通过
- `weaknesses` 必须具体指出问题所在，不能泛泛而谈
- `specificFeedback` 要给出可操作的改进方向

---

### writeDoc（src/skills/writeDoc.js）

**模型**：MiniMax
**输入**：策划方案 JSON + 用户 brief + reviewFeedback
**输出**：Markdown 文本 → `marked` 库解析 → Tiptap 兼容 HTML

---

## 子 Agent

### PptBuilderAgent（src/agents/pptBuilderAgent.js）

根据策划方案生成 PPT JSON 结构。

**调用 `prompts/pptBuilder.js`**：16KB 完整提示词，包含：
- 所有页面类型定义（cover/toc/content/two_column/cards/timeline/end）
- PPT JSON Schema
- 新版 layout 类型（immersive_cover/bento_grid/timeline_flow 等）
- 排版规范

**输入**：plan, userInput, docContent, imageMap
**输出**：PPT JSON（符合 previewRenderer 和 pptGenerator 的 schema）

---

### ImageAgent（src/agents/imageAgent.js）

为 PPT 各页匹配背景图。

**Step 1 — 视觉风格分析**：
- 优先使用 `plan.visualTheme.imageKeywords`
- 回退：MiniMax 推断（`visualPersonality`, `colorPalette`, `styleKeywords`）

**Step 2 — 生成搜索词（MiniMax）**：
```json
{
  "cover": { "primary": "主搜索词", "variations": ["备选1", "备选2"] },
  "content": { ... },
  "end": { ... },
  "pages": [{ "pageIndex": 0, "role": "cover", "query": "...", "treatment": "full-bleed-dark" }]
}
```

**Step 3 — 搜索 + 生成**：
- Pexels 搜索：cover/content/end 各 2-8 张，pages 每页最多 12 张候选
- MiniMax AI 生成封面图（有 key 时尝试）

**Step 4 — 评分选择**：
```js
score = 基础分
  + 亮度加分(28-145 范围)
  + 对比度加分(22-78 范围)
  + treatment 匹配加分
  - 重复图片扣分(已选过 ID)
  - 色系偏差扣分(与前一张差异过大)
```

**输出**：
```json
{
  "cover": [{ "id": "pexels_xxx", "localPath": "...", "photographer": "...", "isAI": false }],
  "content": [...],
  "end": [...],
  "pages": [
    {
      "pageIndex": 0,
      "role": "content",
      "source": "pexels",
      "localPath": "/output/images/...",
      "candidates": [{ "id": "...", "score": 72 }]
    }
  ]
}
```

---

## 错误处理

| 场景 | 策略 |
|------|------|
| LLM 调用超时 | 重试 2 次（间隔 2s），超时后返回 `LLM_TIMEOUT` 错误 |
| JSON 解析失败 | 重试让模型重新输出（`callLLMJson` 自动处理） |
| 搜索无结果 | 继续流程，基于通用知识生成 |
| 重复工具调用 | 3 次注入警告消息，5 次强制停止 |
| build_ppt 无策划方案 | 返回错误码 `TOOL_EXECUTION_FAILED`，不执行 |
| 文件写入失败 | 返回错误，前端 SSE 推送 `error` |
| Space Index AI 重写失败 | 回退到简单追加模式，不阻断流程 |

---

## 上下文与记忆加载顺序

每次 `run_strategy` 开始前，系统按以下顺序加载上下文到 Brain Agent：

```
1. 系统提示词（src/prompts/brain.js）
       ↓
2. 平台记忆（src/services/platformMemory.js）
   - summary / principles / patterns / pitfalls / recentLearnings
       ↓
3. 空间索引（src/services/workspaceManager.js）
   - 当前 space 的 README（systemType: space_index）
       ↓
4. 会话历史（session.messages）
   - 截断到 token 上限
```
