# 对话流验证测试集（手测脚本）

15 个场景手测脚本，覆盖闲聊连续性 / 短回复分支 / 任务升级 / forceTool / 工具链闸口等关键对话流。每个场景都能在 UI 上手动跑一遍 ≤ 2 分钟。

## 启动准备

```bash
# 1. 起 API server（需 .env 里有 MINIMAX_API_KEY）
nohup node src/server.js > /tmp/luna-test/api.log 2>&1 &

# 2. 起前端 dev server
npx vite --port 5173 &

# 3. 浏览器开 http://localhost:5173/，进"智能助手"，点"新建对话"
```

监控用：
```bash
tail -f /tmp/luna-test/api.log | grep -E "prompt size|tool_calls|skill:|Error|FAIL"
```

每条场景给 4 块信息：
- **输入** — 直接复制粘贴到聊天框
- **期望** — 关键观察点
- **失败信号** — 出现这些就是回归
- **关键日志** — `api.log` 里应该看到的 grep pattern

---

## A 类：闲聊连续性（基础健康度）

### 1. 冷启动闲聊

**输入**（首轮）：`你好`

**期望**：1-2 句的轻量问候，可能附带"手上有 XX 项目"之类的空间感知。响应 < 5s。

**失败信号**：
- 回"什么不清楚的，要不换个话题"这种防御话
- 触发 web_search 或 update_brief 等任务工具

**关键日志**：`prompt size: system=~19500c ... msgs=1` 一次 LLM 调用即结束。

### 2. 跨域常识题

**输入**：`一斤等于多少克` 或 `30岁女生减脂每天多少热量` 或 `Python怎么写循环`

**期望**：直接答（500 克 / 1500 大卡左右 / `for i in range(10):`）。可附带"如果跟手上 XX 项目有关再切回去"。

**失败信号**：
- "这个跟当前项目没关系"
- 强行把无关问题扯回策划框架
- 调任何工具

**关键日志**：单次 LLM，无 tool_calls。

---

## B 类：短回复 / AI 文本提问回应（原 bug 重灾区）

### 3. AI 用纯文本问分支 → 用户短回复挑分支 ⚠️核心场景

**操作**：
1. 输入 `想聊聊车`
2. AI 大概率会问"想聊哪款" 或 "想聊产品力/竞品/活动"
3. 输入 AI 给的某一项作为短答（如 `小米`、`yu7`、`产品定位`、`竞品策略`）
4. 反复 2-3 次

**期望**：每一轮 AI 都接住短答继续展开（小米汽车现在主要 SU7 系列... / YU7 是第二款车... / 产品定位大致是运动化中高端纯电 SUV...），不需要用户重复说明上下文。

**失败信号**：
- "有什么不清楚的，还是你想换个话题"（**这是修复前的核心 bug，必须警惕**）
- "你能再具体说说吗"
- 把短回复当孤立闲聊处理

**关键日志**：每轮 `prompt size` 应稳定（不出现"建议工具：无"之类污染段）。

### 4. 续接语短路

**前置**：先做 #11（完整策略闭环）跑到 propose_concept，或任意已经在跑的策略任务。

**输入**：`继续` 或 `接着推` 或 `往下走` 或 `就这样吧`

**期望**：直接沿用 prior intent，立刻执行下一步工具调用（不调 LLM 分类，几乎零延迟）。

**失败信号**：
- 任务被 reset 成闲聊（"好的，请告诉我下一步要做什么"）
- 模型再次问"你想做什么"

**关键日志**：分类器层面 `reason: 'continuation_of_prior_intent'`（intentClassifier.js）。

### 5. 元问题 / 孤立 `?`

**前置**：任意上下文中。

**输入**：`?` 或 `？` 或 `啥？`

**期望**：自然反问"嗯？有什么疑问吗？"或针对最近 AI 输出说"我刚说的 XX 那块，你想问哪部分？"。

**失败信号**：
- "有什么不清楚的，还是你想换个话题"（防御性脱离上下文）
- 调用任何工具

**关键日志**：单次 LLM，无 tool_calls。

---

## C 类：任务升级 / 上下文继承

### 6. 闲聊后任务升级 ⚠️核心场景

**操作**：
1. 先聊 1-2 轮闲聊（如 `你好` / `今天周几`）
2. 然后输入 `帮我做小米 YU7 上市发布会方案，预算 500 万`

**期望**：
- 工具链完整跑：`update_brief → write_todos → challenge_brief → web_search × 2-3 → propose_concept → ask_user`
- brief 里能看到从前几轮闲聊累积的人设/品牌偏好（如果聊过的话）

**失败信号**：
- 模型只产文本"好的，我先来整理 brief..."然后停（一定是没真调工具）
- 输出 `<invoke name="update_brief">` 这种 XML 文本
- 输出 `[update_brief] {...}` 或 `[wesearch] xxx` 伪 markdown
- 跑完只有 1 次 LLM 调用就 idle（应该至少 5-7 轮）

**关键日志**：
```
turn=0 ... tool_calls=1     ← update_brief
turn=1 ... tool_calls=1     ← write_todos
turn=2 ... tool_calls=1     ← challenge_brief
[skill:challengeBrief] 完成
turn=3 ... tool_calls=3     ← 3 个并行 web_search
turn=4-5 ... tool_calls=1   ← propose_concept
[skill:conceptProposal] 完成：3 条方向
```

### 7. 任务中途话题切换

**前置**：在策略任务的 propose_concept 卡片上（已挑出 3 方向）。

**输入**：`先停下，帮我搜一下小米 SU7 Ultra 最近的舆情`

**期望**：模型识别为话题切换，开始 web_search "小米 SU7 Ultra 舆情" 并返回总结，而不是死磕之前的策略任务。

**失败信号**：
- 强制走完策略任务、忽略用户新需求
- "你要先确认上一步的方向选择"

**关键日志**：新一轮的 `tool_calls=1` 调用 web_search，且工具参数明显是新查询。

---

## D 类：forceTool（+ 按钮直达）

### 8. + 生图按钮

**操作**：
1. 点输入框左下角 `+` 按钮，选 `生图 / 画图`
2. 输入 `画一张科技感的发布会主视觉`

**期望**：直接调 `generate_image`（10-20 秒），返回图片 URL。**不**走 search_images 也**不**走完整策划流程。

**失败信号**：
- 走 web_search 找参考图
- 启动 update_brief
- 反复 ask_user 追问需求细节

**关键日志**：`tool_calls=1` 即 generate_image，prompt 里含 `## 本轮：用户手动锁定了工具 generate_image`。

### 9. + 网页搜索按钮

**操作**：
1. 点 `+` 选 `网页搜索`
2. 输入 `2026 年新能源车销量 top 10`

**期望**：直接调 `web_search`，返回 3-5 句关键发现。**不**走策略 / **不**生成 PPT。

**失败信号**：
- 调 search_images
- 触发 update_brief
- 仅文本回答没有真 web_search 调用

**关键日志**：`tool_calls=1` web_search，prompt 含 `## 本轮：用户手动锁定了工具 web_search`。

---

## E 类：完整任务闭环

### 10. 完整策略闭环 ⚠️压力测试

**操作**：
1. 新对话，输入 `帮我做岚图新车上市发布会方案，预算 300 万`
2. 等到出现 propose_concept 三方向卡片
3. 在 ask_user 卡片下方点选 A / B / C 之一（或文字输入 `选 A 稳的`）
4. 等到策略文档生成完成，右侧预览出现完整方案

**期望（≤ 5 分钟）**：
1. update_brief / write_todos / challenge_brief 顺序执行
2. 3 条 web_search 并发
3. propose_concept 出 3 方向卡片
4. ask_user 等用户挑
5. approve_concept 锁方向
6. run_strategy 流式生成 4-6 章节，3000+ 字

**失败信号**：
- 任意一步停在文本叙述（如"我先去搜资料..."然后 idle）
- 工具调用变文本伪语法
- 三方向卡片不渲染
- 用户挑 A 后没有走 approve_concept → 重新让用户挑

**关键日志**：
```
[skill:challengeBrief] 完成，concerns=...
[webSearch] 扩展 Bing: ...
[skill:conceptProposal] 完成：3 条方向
[skill:generatePlanDoc] 完成：N 章节，XXXX 字
```

### 11. PPT 闸口（前置约束）

**前置**：新对话，**没有**跑过 run_strategy。

**输入**：`直接给我出一份 PPT`

**期望**：模型识别没有方案依据，要么调 ask_user 让用户提供文档/确认方向，要么先走 update_brief → run_strategy 再生成。**不能**直接调 build_ppt。

**失败信号**：
- 直接调 build_ppt（会被工具层硬护栏拦下，但说明模型判断错）
- 模型瞎编一份方案就开始 build_ppt
- 死循环让用户描述需求

**关键日志**：不应出现 `tool: build_ppt` 在 run_strategy 之前。

### 12. 资源/文档引用 → 直接做 PPT

**前置**：空间里有现成的策划文档。

**操作**：
1. 输入框先点 `引用空间文档`，选一份策划方案
2. 输入 `按这份文档生成 PPT`

**期望**：模型先 read_workspace_doc 读取文档，确认理解后**一句**确认（"如果这版理解没问题，我就按这个生成"），用户 OK 后调 build_ppt。

**失败信号**：
- 跳过文档直接走 update_brief → run_strategy（重复劳动）
- 没有任何确认就直接 build_ppt
- 反复 ask_user 让用户口述需求

**关键日志**：`read_workspace_doc` 出现，紧接着 `build_ppt`（中间应有用户确认轮）。

---

## F 类：错误恢复 / 边界

### 13. ask_user 后用户拒绝/返工

**前置**：propose_concept 给出 3 方向，渲染了 ask_user 卡片。

**输入**：`都不太对，B 方向再大胆点，多点反传统色彩`

**期望**：模型识别为返工而不是挑方向，把 user_feedback 传进 propose_concept 再调一次，出新一版三方向。**不调** approve_concept。最多连续 4 版。

**失败信号**：
- 把"都不太对"误当成"挑了某个方向"调 approve_concept
- 不重新出方向就开始 run_strategy
- 一直反复出同一版方向

**关键日志**：第二次 `[skill:conceptProposal]`，user_feedback 字段非空。

### 14. 上下文长度临界（压缩触发）

**操作**：在同一对话里跑 ≥ 2 次完整 run_strategy + 多次大段 web_search 结果（拉到 messages 30+ 条）。然后随便问一个问题，看会不会自动压缩。

**期望**：达到阈值时自动 compaction，prompt size 回落，不丢任务关键状态（brief / bestPlan / 上次方向选择）。

**失败信号**：
- prompt 长到溢出报 `context_length_exceeded`，但模型不自救
- 压缩后 brief 信息丢失，AI 重问"你的项目是？"
- 触发死循环重复压缩

**关键日志**：`[BrainAgent] context 太长，已自动压缩历史，重试本轮` 或 `[microcompact]` / `[snip]`。

### 15. LLM 调用失败软兜底

**操作**：临时把 MINIMAX_API_KEY 改成无效值（编辑 `.env` 后重启 API），然后发任意消息。

**期望**：transport 重试用尽 → 跨厂商 fallback（如果配了 deepseek_chat）→ 否则给用户一段"AI 调用失败：..."的明确报错 + 可重试 payload，**不**长时间静默卡 loading。

**失败信号**：
- thinking 气泡永远转，没有 error 收尾
- 仅前端 30 分钟超时才自动停（这是 last resort，不是正常路径）
- error 消息没说明具体卡在哪一步

**关键日志**：
```
[BrainAgent] LLM 调用失败（重试已用尽）: ...
[BrainAgent] 进入跨厂商兜底...  / 或
[BrainAgent] 进入 minimax 软失败兜底
```

---

## 跑完一遍的健康度判断

| 维度 | 通过标准 |
|---|---|
| **闲聊连续性** | #1, #2, #3, #4, #5 全过 |
| **任务升级** | #6 完整跑出 7+ 次 tool_calls |
| **forceTool** | #8, #9 第一轮就调对应工具，无走 brief 流程 |
| **完整闭环** | #10 在 5 分钟内出策划文档 |
| **闸口约束** | #11 不直接 build_ppt，#7 能切话题 |
| **错误路径** | #15 给出明确 error 而不是卡 loading |

任意一项不过就回滚到"上次绿"的 commit。如果 #3 / #4 出现"什么不清楚的"，回滚 [src/services/intentClassifier.js](src/services/intentClassifier.js) 和 [src/prompts/brain.js](src/prompts/brain.js) 的 chat-section 软化逻辑（看 git log 找最近一次 prompt 改动）。

## 快速重置

跑测之间清状态：
```bash
# 删 SQLite 里的对话历史
rm -f data/platform.sqlite*

# 清后端日志
: > /tmp/luna-test/api.log

# 重启 API
PIDS=$(lsof -tiTCP:3000 -sTCP:LISTEN); kill $PIDS; sleep 2
nohup node src/server.js > /tmp/luna-test/api.log 2>&1 &
```
