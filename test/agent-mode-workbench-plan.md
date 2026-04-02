# OpenClaw Agent 多模式工作台方案

## 1. 背景

当前 OpenClaw 已经收敛到以 Brain Agent 为主的单一路径：

- 用户自然语言输入需求
- Agent 规划任务、澄清、调用工具
- 生成策划文档
- 用户确认后再生成 PPT

这比之前的固定流水线更灵活，但仍然缺一个关键能力：

**把“聊天共创、方案打磨、PPT 出稿”变成同一会话里的不同工作模式。**

活动策划工作不是线性流程，而是一个持续来回迭代的过程：

1. 先聊需求和目标
2. 出一版策划文档
3. 用户推翻部分方向
4. 回头重写方案
5. 再生成 PPT
6. 再改方案
7. 再改 PPT

所以系统不应该只有“生成”一种主动作，而应该支持多种工作模式。

---

## 2. 目标

设计一套围绕同一会话工作的多模式 Agent 机制，支持：

- 聊天模式：围绕需求、创意、方向进行共创
- 策划模式：围绕策划文档生成、修改、打磨
- PPT 模式：围绕 PPT 结构、视觉、页面进行制作和调整
- Auto 模式：让 Agent 自主判断当前更适合聊天、改文档还是做 PPT

同时必须满足：

- 多个模式共享同一套上下文和资产
- 用户切模式时不会丢失会话状态
- doc 仍然是核心中间资产
- PPT 必须建立在 doc 基础上

---

## 3. 核心判断

### 3.1 不要做成 4 套独立 Agent

不建议做 4 套完全独立的后端流程。

原因：

- 状态容易分裂
- brief、doc、ppt 容易彼此不同步
- 用户在聊天模式里说过的话，策划模式不一定能继承
- 后续维护成本非常高

### 3.2 正确做法：统一会话资产 + 多模式控制

推荐方案是：

- 底层只有一套 Brain Agent 会话
- 模式只是“当前工作重心”和“默认工具策略”
- 所有模式共享同一套项目资产

也就是说：

- `chat` 不是另一个系统
- `plan` 不是另一个系统
- `ppt` 不是另一个系统
- `auto` 也不是另一个系统

它们只是同一会话的 4 种工作姿态。

---

## 4. 推荐模式定义

## 4.1 Chat 模式

### 定位

用于和 Agent 聊需求、聊创意、聊方向、聊风险、聊参考。

### 默认行为

- 优先对话，不主动进入 PPT 生成
- 优先整理 brief、记录假设、拆解问题
- 需要时再引导用户进入策划模式

### 允许的动作

- 更新 brief
- 写 todos
- 搜索案例和灵感
- 记录创意方向
- 形成下一步建议

### 不应该默认做的动作

- 直接生成 PPT
- 在信息还很散的时候强行出完整方案

### 适合场景

- 初始需求沟通
- 方向探索
- 用户说“我们先聊聊思路”
- 用户说“先不要出稿，我想先共创”

---

## 4.2 Plan 模式

### 定位

围绕策划文档工作，生成、调整、精修、重写 doc。

### 默认行为

- 把当前 brief 固化成 doc
- 根据用户反馈局部重写或全局改写 doc
- 将 doc 作为当前主工作区

### 允许的动作

- 生成策划文档
- 根据批注修改章节
- 提供多个方案版本
- 比较不同创意路线
- 保存 doc 到空间

### 不应该默认做的动作

- 未确认 doc 就直接生成 PPT

### 适合场景

- “出一版完整方案”
- “把第 3 部分改得更大胆一点”
- “主题还是偏保守，重写一版”
- “把预算和执行节奏写得更清楚”

---

## 4.3 PPT 模式

### 定位

围绕 PPT 本身工作，基于 doc 出稿、改稿、换图、调结构、改单页。

### 默认行为

- 以当前 doc 为唯一可信的内容来源
- 优先做 PPT 数据和页面调整
- 保持“文档先行，PPT 后置”

### 允许的动作

- 基于 doc 生成 PPT
- 调整页数和节奏
- 局部改某一页
- 修改风格和视觉
- 换图、重建单页、重排目录

### 适合场景

- “开始做 PPT”
- “封面不够高级，换一种风格”
- “第 5 页太满，拆成两页”
- “把结尾页做得更有余韵”

---

## 4.4 Auto 模式

### 定位

允许 Agent 根据上下文自主判断当前最适合做什么。

### 默认行为

- 如果信息不足，优先聊天和澄清
- 如果方向明确但 doc 不稳定，优先策划模式
- 如果 doc 已确认且用户要出稿，优先 PPT 模式

### 风险

Auto 最强，但也最容易误判。

所以应该最后做，不适合一开始就作为唯一主模式。

---

## 5. 统一资产模型

所有模式共享下面这些状态。

## 5.1 Conversation / Session

会话主键，承载整个协作过程。

建议字段：

```json
{
  "sessionId": "sess_xxx",
  "mode": "chat",
  "status": "idle",
  "messages": [],
  "todos": [],
  "brief": {},
  "docMarkdown": "",
  "docHtml": "",
  "pptData": null,
  "pptMeta": {},
  "activeArtifact": "doc",
  "updatedAt": 0
}
```

## 5.2 Brief

brief 是所有模式共享的核心项目事实。

建议字段：

- brand
- productCategory
- eventType
- topic
- goal
- audience
- scale
- budget
- style
- tone
- requirements
- assumptions

## 5.3 PlanDoc

策划文档是核心中间资产。

所有方案讨论、版本迭代、PPT 生成都围绕它。

## 5.4 PptDoc

当前 PPT 数据和渲染结果。

建议字段：

- pptJson
- previewSlides
- downloadUrl
- version
- sourceDocVersion

---

## 6. 模式如何影响 Agent

模式不是换后端，而是改变以下 4 件事：

## 6.1 Prompt 侧重点

`chat`
- 重对话、重澄清、重创意发散

`plan`
- 重 doc 生成、重 doc 修改、重结构化表达

`ppt`
- 重页面结构、视觉风格、节奏和版式

`auto`
- 重判断“下一步最应该做什么”

## 6.2 工具白名单 / 优先级

建议工具按层划分。

### 通用基础工具

- `update_brief`
- `write_todos`
- `ask_user`
- `web_search`
- `web_fetch`

### Plan 工具

- `run_strategy`
- `generate_plan_doc`
- `revise_plan_doc`
- `save_plan_doc`

### PPT 工具

- `build_ppt`
- `revise_ppt`
- `replace_images`
- `rebuild_slide`

### 模式策略

`chat`
- 默认不直接给 `build_ppt`

`plan`
- 优先 `run_strategy / generate_plan_doc / revise_plan_doc`

`ppt`
- 优先 `build_ppt / revise_ppt / replace_images`

`auto`
- 工具全开，但要强约束决策逻辑

## 6.3 UI 主工作区

`chat`
- 对话为主
- 右侧显示 brief / todos / 灵感片段

`plan`
- 文档面板为主
- 过程产物和版本比较为辅

`ppt`
- PPT 预览和编辑器为主
- 保留 doc 引用入口

`auto`
- 仍是统一界面，但要显示“当前聚焦：聊天 / 策划 / PPT”

## 6.4 默认收尾行为

`chat`
- 收尾到 brief 或下一步建议

`plan`
- 收尾到 doc

`ppt`
- 收尾到 PPT 预览

`auto`
- 收尾到当前最重要资产

---

## 7. 推荐交互规则

## 7.1 模式切换不清空会话

切模式时必须保留：

- messages
- brief
- todos
- doc
- ppt

## 7.2 doc 是核心枢纽

无论从哪个模式进入 PPT，都必须能追溯到 doc。

原则：

- 没有 doc，不进入正式 PPT 出稿
- doc 变了，PPT 要知道自己是否过期

## 7.3 用户反馈要支持跨模式回流

例如：

- 在 PPT 模式下说“第 5 页逻辑不对”
- 系统应允许回写到 doc 或提示“需要同步调整方案文档”

这比单纯改页面更专业。

## 7.4 Auto 不能黑箱

Auto 模式下必须让用户知道：

- 现在系统判断你在聊天
- 现在系统判断你在改方案
- 现在系统判断你在做 PPT

否则用户会失去控制感。

---

## 8. 技术落地建议

## 8.1 第一阶段：先做模式状态，不改太多工具

目标：

- 在 session 上加 `mode`
- 前端支持模式切换
- Prompt 根据模式注入不同策略

这一阶段不需要重写全套工具。

## 8.2 第二阶段：做 Plan 模式的 doc 迭代工具

目标：

- 支持“重写整份文档”
- 支持“改某一节”
- 支持“比较版本差异”

这是最有价值的一层。

## 8.3 第三阶段：做 PPT 模式的局部改稿工具

目标：

- 改某页
- 换图
- 调版式
- 重建单页

## 8.4 第四阶段：最后做 Auto

原因：

- Auto 依赖 chat / plan / ppt 三种模式都足够稳定
- 否则 Auto 只会放大现有混乱

---

## 9. 前端改造方案

## 9.1 入口

在 Agent 页面顶部增加模式切换：

- 聊天
- 策划
- PPT
- Auto

## 9.2 主工作区布局

建议：

- 左侧永远是对话流
- 右侧根据 mode 切主视图

### Chat 模式

- brief 卡片
- todos 卡片
- 搜索 / 灵感 / 参考摘要

### Plan 模式

- PlanDocumentPanel 为主
- 右上角显示版本和变更摘要

### PPT 模式

- SlideViewer / PptEditor 为主
- 同时保留“查看当前 doc”的快捷入口

### Auto 模式

- 自动切换右侧主视图
- 显示当前焦点标识

## 9.3 历史会话

会话侧栏仍按项目空间组织，不按模式拆分。

否则一个项目会碎成三四条对话，不利于真实工作。

## 9.4 预览区必须升级为“可切换交付查看器”

这是整个多模式工作台里非常关键的一点。

右侧预览区不应该只是：

- 当前阶段显示什么，就只能看什么

而应该升级成：

- 一个统一的“交付结果预览区”
- 可以被当前执行自动驱动
- 也可以被用户从历史结果卡片手动切换

### 核心原则

每一个真正值得查看和回看的结果，都应该被抽象成一张**交付结果卡片**。

这些卡片既要：

- 出现在对话流中

也要：

- 在右侧预览区里可被打开、切换、回看

换句话说：

**对话流负责记录“发生了什么”，右侧预览区负责查看“产出了什么”。**

---

## 9.5 交付结果卡片模型

建议新增统一的数据结构：`deliverables`

```json
{
  "id": "artifact_xxx",
  "type": "plan_doc",
  "title": "小米 15 Ultra 发布会策划方案 V2",
  "summary": "已根据高端影像方向重写核心策略和亮点章节",
  "mode": "plan",
  "version": 2,
  "createdAt": "2026-03-31T12:00:00.000Z",
  "sourceMessageId": "msg_xxx",
  "previewRef": {
    "docHtml": "...",
    "pptData": null,
    "slides": null
  }
}
```

可选类型建议至少包括：

- `brief_snapshot`
- `research_summary`
- `plan_doc`
- `plan_revision`
- `ppt_outline`
- `ppt_deck`
- `ppt_revision`
- `single_slide`

---

## 9.6 对话中的卡片形态

在对话流里，每次形成一个值得回看的结果时，插入一张卡片消息，而不是只插一段普通文本。

例如：

- “已生成策划文档 V1”
- “已根据你的反馈生成策划文档 V2”
- “已生成 14 页 PPT 初稿”
- “已重做第 5 页主视觉”

每张卡片至少要有：

- 标题
- 类型标签
- 版本号
- 简短摘要
- 主要操作按钮

建议按钮：

- `打开预览`
- `设为当前工作对象`
- `继续修改`

这样用户在聊天流里就能直接点历史结果，而不是只能跟着当前阶段走。

---

## 9.7 右侧预览区的切换机制

右侧预览区要支持两种切换方式。

### 方式 A：自动切换

执行过程中一旦产生新的关键交付物，就自动切到对应预览。

例如：

- 生成了 doc -> 自动切到文档预览
- 生成了 PPT -> 自动切到 PPT 预览
- 重做了某一页 -> 自动切到该页预览

这是“系统主动引导”。

### 方式 B：手动切换

用户点击对话里的历史结果卡片，右侧切到该卡片对应的预览。

例如：

- 点“策划方案 V1” -> 右侧显示 V1 文档
- 点“策划方案 V2” -> 右侧显示 V2 文档
- 点“PPT 初稿” -> 右侧显示初稿页面
- 点“第 5 页改稿” -> 右侧定位到那一页

这是“用户主动回看”。

这两种方式必须并存。

---

## 9.8 预览区建议状态

建议右侧预览区增加统一状态：

```json
{
  "activeDeliverableId": "artifact_xxx",
  "activePreviewType": "plan_doc",
  "pinned": false,
  "followLatest": true
}
```

字段含义：

- `activeDeliverableId`
  当前正在看的交付物

- `activePreviewType`
  当前预览类型，例如 `plan_doc` / `ppt_deck`

- `followLatest`
  是否自动跟随最新产物

- `pinned`
  用户是否手动固定当前预览

### 推荐行为

默认：

- `followLatest = true`

也就是执行过程中自动切到最新产物。

但如果用户主动点击了历史卡片：

- 把 `pinned = true`
- 暂停自动跳转

并给用户一个很轻的提示：

- “正在查看历史版本”
- “返回最新结果”

这样不会出现用户刚点开旧版本，右侧就又被系统跳走的问题。

---

## 9.9 不同交付物的预览方式

不同类型的卡片，对应不同预览组件。

### `brief_snapshot`

- 右侧显示结构化 brief 面板

### `research_summary`

- 右侧显示研究摘要卡片、链接、要点

### `plan_doc` / `plan_revision`

- 右侧显示 `PlanDocumentPanel`

### `ppt_outline`

- 右侧显示目录结构和页面映射预览

### `ppt_deck`

- 右侧显示 `SlideViewer`

### `single_slide`

- 右侧显示 `SlideViewer` 并自动定位到该页

也就是说，右侧预览区本质上是：

**一个根据 deliverable 类型动态挂载组件的容器。**

---

## 9.10 版本化要求

如果要支持“回看之前生成的内容”，就不能只存当前态。

至少对以下内容做版本化：

- 策划文档
- PPT 初稿 / 改稿
- 单页改稿

建议策略：

- 每次完整 doc 生成，产生一个新的 `plan_doc` deliverable
- 每次完整 PPT 生成，产生一个新的 `ppt_deck` deliverable
- 每次单页改稿，产生一个新的 `single_slide` deliverable

而不是直接覆盖旧结果。

否则“历史结果卡片”就失去意义。

---

## 9.11 对当前系统的改造建议

基于当前 OpenClaw 现状，建议新增：

### session 状态新增

- `deliverables: []`
- `activeDeliverableId`
- `followLatest`
- `pinnedPreview`

### SSE 事件新增

- `deliverable_created`
- `deliverable_updated`
- `preview_switch`

### 前端消息新增

- `kind: 'deliverable-card'`

### 前端预览区新增

- `activeDeliverable`
- `openDeliverable(id)`
- `returnToLatestDeliverable()`

---

## 9.12 推荐交互细节

### 执行中

- Agent 生成 doc
- 对话流插入“策划文档 V1”卡片
- 右侧自动切到文档

### 用户点击旧卡片

- 右侧切到该版本
- 进入“历史查看态”
- 顶部显示“返回最新结果”

### 用户继续修改

- 可以在卡片上点“基于此版本继续修改”
- 这时把该 deliverable 设为当前工作基线

这非常重要。

因为策划工作经常不是基于最新版本继续，而是：

- “还是回到 V1 的结构”
- “用 V2 的亮点，但保留 V1 的开场”

---

## 9.13 为什么这部分必须优先考虑

如果没有这套交付卡片 + 可切换预览区：

- 对话会变成流水账
- 结果只能看当前最新
- 用户无法回看之前的方案和 PPT
- 系统不适合做真正的反复打磨

而你这个产品的本质，恰恰不是“一次生成”，而是：

**围绕多个版本的方案和 PPT 持续打磨。**

---

## 10. 后端改造方案

## 10.1 session 增加 mode

在 `agentSession` 上增加：

```js
mode: 'chat' | 'plan' | 'ppt' | 'auto'
```

## 10.2 /api/agent/start 和 /reply 接收 mode

前端发消息时显式带 mode。

Auto 模式下也带 `mode: 'auto'`，由 prompt 决策。

## 10.3 Prompt 按 mode 动态拼接

建议把 `brain.js` 改成：

- 通用系统提示词
- mode-specific 片段
- 工具策略片段

不要继续把所有规则写成一大坨静态字符串。

## 10.4 build_ppt 保持 doc 驱动

`ppt` 模式中：

- 如果没有 doc，先引导进入策划模式
- 如果 doc 存在但 PPT 过期，提示重新生成

---

## 11. 推荐的数据结构扩展

## 11.1 session

```json
{
  "mode": "plan",
  "brief": {},
  "todos": [],
  "docMarkdown": "",
  "docHtml": "",
  "docVersion": 3,
  "pptData": {},
  "pptVersion": 2,
  "pptSourceDocVersion": 3,
  "activeArtifact": "doc"
}
```

## 11.2 todo

```json
{
  "content": "重写核心策略章节",
  "status": "in_progress",
  "mode": "plan"
}
```

这能帮助前端更清楚地解释当前任务属于哪种工作模式。

---

## 12. 预期收益

这套方案的价值有 4 个：

1. 更符合真实策划工作流，而不是一次性流水线
2. 用户有更强控制感，可以明确告诉系统“现在先聊 / 先改文档 / 先改 PPT”
3. doc 和 ppt 关系更清晰，避免内容脱节
4. Auto 模式有了可靠基础，不会变成黑箱

---

## 13. 风险

## 13.1 最大风险：模式做成状态割裂

如果每个模式各自存自己的 brief/doc/ppt，会非常难维护。

必须共享同一份核心资产。

## 13.2 第二风险：Auto 过早上线

如果 `chat / plan / ppt` 三种模式还没稳定，Auto 只会掩盖问题。

## 13.3 第三风险：UI 过重

不要一下子做太多复杂切换面板。

建议先用：

- 一个模式切换器
- 一个统一对话流
- 一个右侧主工作区

就够了。

---

## 14. 推荐实施顺序

### Phase A

- session 增加 mode
- 前端增加模式切换
- prompt 改为 mode-aware

### Phase B

- Plan 模式强化
- 支持 doc 重写和局部修改

### Phase C

- PPT 模式强化
- 支持局部页修改和换图

### Phase D

- 引入 Auto 模式判断

---

## 15. 最终建议

我建议下一步不要先做 Auto。

最合理的顺序是：

1. 先做 `chat / plan / ppt` 三个显式模式
2. 把它们都接到同一套 session 资产上
3. 稳定后再加 `auto`

这样才能保证：

- 对话可共创
- 文档可打磨
- PPT 可出稿
- 三者彼此联动

而不是再次回到“看起来很智能，但状态很乱”的局面。
