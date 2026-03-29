# Agent 规格说明

> 所有示例均使用通用占位符，不绑定任何具体品牌。

---

## Orchestrator Agent

**模型**：MiniMax（订阅）
**职责**：解析用户需求，生成结构化任务指令，拆解 3 个并行搜索子任务

**输入**
```json
{
  "brand": "[品牌名]",
  "productCategory": "[汽车 | 手机 | 智能硬件 | ...]",
  "eventType": "[auto_show | product_launch | exhibition | ...]",
  "topic": "[活动名称或主题]",
  "scale": "[大型 500人以上 | 中型 100-500人 | 小型 100人以下]",
  "budget": "[预算金额]",
  "brandColor": "[主色十六进制，如 FF6B00]",
  "style": "[高端科技 | 年轻潮流 | 商务专业 | ...]",
  "requirements": "[额外需求，如：突出某技术亮点、对标某竞品]"
}
```

**输出**
```json
{
  "parsedGoal": "面向[目标受众]，展示[品牌]在[产品类别]领域的[核心差异化]",
  "keyThemes": ["主题词1", "主题词2", "主题词3"],
  "searchTasks": [
    {
      "id": "r1",
      "focus": "[行业]活动趋势与竞品动态",
      "keywords": ["关键词1", "关键词2", "关键词3"]
    },
    {
      "id": "r2",
      "focus": "[品牌/产品类别]成功活动案例",
      "keywords": ["关键词1", "关键词2"]
    },
    {
      "id": "r3",
      "focus": "[活动类型]创意互动形式",
      "keywords": ["关键词1", "关键词2"]
    }
  ],
  "pptStructureHint": "建议页数和结构重点提示"
}
```

---

## Research Agent

**模型**：MiniMax（订阅）
**并行数**：3 个实例同时运行
**工具**：调用现有 `searchWithTavily()`

**输入**
```json
{
  "taskId": "r1",
  "focus": "[行业]活动趋势与竞品动态",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "parsedGoal": "面向[目标受众]，展示[品牌]在[产品类别]的[核心差异化]"
}
```

**输出**
```json
{
  "taskId": "r1",
  "summary": "搜索发现的行业趋势摘要...",
  "keyFindings": [
    "竞品 A 的活动亮点或数据",
    "行业整体趋势描述"
  ],
  "inspirations": [
    "可借鉴的创意形式或互动方案"
  ],
  "sources": ["https://..."]
}
```

---

## Strategy Agent

**模型**：MiniMax（订阅）
**职责**：综合需求解析和所有素材制定活动策划方案；第 2、3 轮接收 Critic 反馈后修订

**输入（首轮）**
```json
{
  "orchestratorOutput": { "...": "..." },
  "researchResults": [
    { "taskId": "r1", "...": "..." },
    { "taskId": "r2", "...": "..." },
    { "taskId": "r3", "...": "..." }
  ],
  "round": 1,
  "previousFeedback": null
}
```

**输入（修订轮，round ≥ 2）**：在上方基础上追加：
```json
{
  "round": 2,
  "previousPlan": { "...": "..." },
  "previousFeedback": {
    "score": 6.5,
    "weaknesses": ["缺乏差异化亮点", "预算分配不合理"],
    "specificFeedback": "建议增加与竞品的直接数据对比..."
  }
}
```

**输出**
```json
{
  "planTitle": "[品牌] [活动名称] 策划方案",
  "coreStrategy": "以'[核心主题词]'为主线，打造[活动形式]体验",
  "highlights": ["亮点1", "亮点2", "亮点3"],
  "sections": [
    {
      "sectionId": "s1",
      "title": "项目背景与目标",
      "keyPoints": ["品牌现状", "核心目标", "KPI指标"],
      "content": { "...": "..." }
    }
  ],
  "budget": {
    "total": "[总预算]",
    "breakdown": { "展位搭建": "xx万", "媒体传播": "xx万" }
  },
  "timeline": { "phases": ["..."] }
}
```

---

## Critic Agent

**模型**：DeepSeek-R1（按量付费）
**职责**：从专业活动策划专家视角评审方案，打分并给出具体改进意见

**评分维度（各 20%，满分 10 分）**

| 维度 | 说明 |
|---|---|
| 主题创意度 | 是否有差异化记忆点，能在同类活动中脱颖而出 |
| 目标可达性 | KPI 是否合理，执行路径是否清晰可落地 |
| 预算合理性 | 各项分配是否符合行业规范，无明显虚高或遗漏 |
| 内容专业度 | 策划逻辑是否严谨，细节是否到位 |
| 亮点竞争力 | 是否有 1-2 个令人印象深刻的活动亮点 |

**通过阈值：综合评分 ≥ 7.0**

**输入**：Strategy Agent 完整输出（planTitle / coreStrategy / sections / budget / timeline）

**输出**
```json
{
  "score": 7.5,
  "passed": true,
  "scores": {
    "creativity": 8,
    "achievability": 7,
    "budget": 7.5,
    "professionalism": 8,
    "competitiveness": 7
  },
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["不足1", "不足2"],
  "specificFeedback": "针对具体页面或章节的改进建议...",
  "round": 1
}
```

---

## PPT Builder Agent

**模型**：MiniMax（订阅）
**职责**：将最终通过的策划方案转化为 `pptGenerator.js` 可用的 JSON 数据结构

**配色规则**：`theme.primary` 使用用户输入的 `brandColor`，`theme.secondary` 由 Agent 根据品牌调性自动推导互补色。

**约束**：`page.type` 只能是以下 7 种之一，否则 pptGenerator 报错：

| type | 说明 |
|---|---|
| `cover` | 封面 |
| `toc` | 目录 |
| `content` | 内容页（支持 sections、kpis 字段） |
| `two_column` | 双栏对比 |
| `cards` | 卡片展示（建议 3-4 张） |
| `timeline` | 时间线 |
| `end` | 结束页 |

**输入**：Critic Agent 通过后的最终 Strategy 输出 + 用户原始输入（取 brandColor）

**输出（节选）**
```json
{
  "title": "[品牌] [活动名称] 策划方案",
  "theme": {
    "primary": "[用户输入的 brandColor]",
    "secondary": "[自动推导的互补色]"
  },
  "pages": [
    {
      "type": "cover",
      "mainTitle": "[品牌名]",
      "subtitle": "[活动名称] 策划方案",
      "date": "[活动日期]",
      "location": "[活动地点]"
    },
    {
      "type": "toc",
      "items": [
        { "title": "项目背景与目标" },
        { "title": "核心策略" }
      ]
    },
    {
      "type": "content",
      "title": "项目背景与目标",
      "sectionNum": "01",
      "sections": [
        {
          "title": "核心目标",
          "content": ["目标描述1", "目标描述2"]
        }
      ],
      "kpis": [
        { "value": "KPI值", "label": "KPI名称" }
      ]
    }
  ]
}
```

---

## Agent 错误处理

| 场景 | 策略 |
|---|---|
| LLM 调用超时 | 自动重试 2 次（间隔 2s），超出后标记失败 |
| JSON 解析失败 | 让模型重新输出，最多重试 2 次 |
| Research 搜索无结果 | 继续流程，Strategy 基于现有素材生成 |
| Critic 评分始终 < 7 | 3 轮后强制取最高分版本继续 |
| PPT Builder 输出不合法 | 回退到对应 eventType 的结构模板填充缺失字段 |
