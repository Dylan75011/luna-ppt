# 系统架构

## 定位

面向活动策划行业的**通用工具**，服务汽车、手机、智能硬件等各类品牌的线下发布会与展览活动策划。工具本身与任何具体品牌无关，所有品牌信息均由用户输入驱动。

## 流程图

```
用户输入
  { brand, productCategory, eventType, topic, scale, budget, brandColor, style, requirements }
           │
           ▼
  ┌─────────────────────┐
  │   Orchestrator      │  MiniMax（订阅）
  │   解析需求 → 拆解    │
  │   3 个搜索子任务     │
  └─────────┬───────────┘
            │ 并行分发
    ┌───────┼────────┐
    ▼       ▼        ▼
 Research Research Research   MiniMax × 3（并行）
  行业趋势  竞品案例  创意素材
    └───────┼────────┘
            │ 素材汇总
            ▼
  ┌─────────────────────┐
  │   Strategy Agent    │  MiniMax（订阅）
  │   综合素材 + 需求     │
  │   输出结构化方案      │
  └─────────┬───────────┘
            │
            ▼
  ┌─────────────────────┐
  │    Critic Agent     │  DeepSeek-R1（按量）
  │    专业评审打分       │
  │    score + feedback │
  └─────────┬───────────┘
            │
     score < 7 且轮次 < 3?
      Yes ──┘ 带反馈重新策划
      No  ──▶
            ▼
  ┌─────────────────────┐
  │   PPT Builder       │  MiniMax（订阅）
  │   方案 → PPT JSON   │  主色 = 用户输入的 brandColor
  └─────────┬───────────┘
            ▼
      pptGenerator.js（现有）
            ▼
    ┌───────┴────────┐
    ▼                ▼
 output/*.pptx   previewData    ← 同一份 JSON 同时用于
                                   浏览器预览和 PPTX 下载
```

## 品牌无关原则

| 层次 | 原则 |
|---|---|
| 模板 JSON | 只定义页面结构（type / sectionNum / 占位字段），不含任何真实品牌内容 |
| pptGenerator | 配色由运行时传入，常量名改为 `PRIMARY_COLOR` / `SECONDARY_COLOR` |
| Agent Prompt | 所有提示词参数化，品牌名/产品类别/活动类型由用户输入注入 |
| 搜索关键词 | Orchestrator 根据用户输入动态生成，不硬编码任何品牌词 |

## 评审循环逻辑

```
round = 1
loop:
  plan   = strategyAgent.run(input)
  review = criticAgent.run(plan)

  if review.score >= 7.0 → break（通过）
  if round >= 3          → break（强制结束，取历次最高分版本）

  input.previousFeedback = review
  input.previousPlan = plan
  round++
```

## 模型分配策略

| Agent | 模型 | 计费 | 理由 |
|---|---|---|---|
| Orchestrator | MiniMax | 订阅 | 结构化任务分解 |
| Research × 3 | MiniMax | 订阅 | 批量调用无额外成本 |
| Strategy | MiniMax | 订阅 | 中文活动文案质量高 |
| **Critic** | **DeepSeek-R1** | **按量** | 评审需要批判性推理链 |
| PPT Builder | MiniMax | 订阅 | 结构化 JSON 输出 |

> DeepSeek-R1 仅用于 Critic，每次完整生成调用 1-3 次，成本可控（约 ¥0.1-0.3/次）

## 编排方式

采用**代码编排 + 自定义循环**，而非 Agent SDK，原因：
- 精确控制评审循环轮次上限
- 每个 Agent 只传必要上下文（节省 token）
- 循环中通过 SSE 向前端推送实时进度
- 与现有 Express 服务直接集成，无额外依赖

## 降级策略

```
MiniMax 不可用     → 降级到 deepseek-chat
DeepSeek-R1 不可用 → 降级到 deepseek-chat（推理稍弱但可用）
全部不可用         → 返回错误，提示检查 API Key
```

## 超时设置

| 范围 | 超时 |
|---|---|
| 单个 Agent 调用 | 60 秒 |
| 整体任务 | 5 分钟 |
