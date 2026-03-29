# 实施说明

## 最新补充方案：空间索引 + 平台 Memory

### 目标

在正式任务开始前，Agent 不只看用户这一轮输入，还要补两层长期上下文：

1. `空间索引`
   - 面向当前空间/项目
   - 记录这个空间下真正有参考价值的上下文、资产和最近任务
   - 属于平台内部机制，对用户不可见

2. `平台 Memory`
   - 面向全局方法论
   - 记录跨项目稳定有效的策划经验、模式和常见误区
   - 同样属于平台内部机制，对用户不可见

这两层都必须满足：
- 正式任务开始前先读
- 任务完成后自动更新
- 更新方式是“重写整理”，不是流水账追加
- 要有主动遗忘和淘汰机制，避免上下文无限膨胀

---

### 职责边界

#### 空间索引（Project/Space Index）

适合记录：
- 当前空间里已经确定的项目背景
- 可复用的空间资产
- 最近几次与这个空间直接相关的任务结论
- 对下次进入这个空间最有帮助的判断

不适合记录：
- 跨项目通用方法论
- 只在一个任务里偶然成立的经验
- 测试文档、示例内容、占位内容

#### 平台 Memory（Global Memory）

适合记录：
- 跨项目稳定有效的活动策划原则
- 常见活动类型的结构模式
- 高价值表达方式
- 常见失误、误判和风险点

不适合记录：
- 某个空间私有的品牌背景
- 某个具体项目的执行细节
- 只在一次任务里出现的弱信号

原则上：
- `空间索引` 解决“这个项目之前做过什么、沉淀了什么”
- `平台 Memory` 解决“平台在越来越多任务里学会了什么”

---

### 正式任务前的读取顺序

#### Step 1：需求确认完成
- 用户输入足够启动任务后，不立即进入正式策划
- 先进入“启动前回顾”

#### Step 2：读取空间索引
- 如果当前选择了空间，优先读取该空间的内部 `README / index`
- 再按需补看空间中的其他文档摘要
- 如果空间内没有有效信息，或者多为测试/占位内容，则不注入任务上下文

#### Step 3：读取平台 Memory
- 在同一个“启动前回顾”阶段，同时读取全局 `platform-memory`
- 让 Agent 在正式开始前就带着平台方法论做判断，而不是到正式任务里才第一次加载

#### Step 4：给用户反馈回顾结论
- 用自然语言告诉用户：
  - 我先看了空间已有内容
  - 我也会带着平台已有经验往下推进
- 但不需要把这些内部机制暴露成任务节点

#### Step 5：正式进入任务
- 只有这一步之后，才创建正式任务卡并进入多 Agent 流程

---

### 更新策略

#### 空间索引更新策略

每次任务完成后：
- 读取旧索引
- 读取当前空间下仍然有效的文档资产
- 结合本次任务结果
- 由 AI 重写一版更优的空间索引

更新重点：
- 删除测试信息、噪声和弱相关内容
- 对“最近任务”做压缩，不保留流水账
- 只保留最值得回看的资产
- 把“下一次进入这个空间最该先知道什么”提炼出来

#### 平台 Memory 更新策略

每次任务完成后：
- 读取旧 memory
- 提取本次任务中跨项目可复用的经验
- 由 AI 重写平台 memory

更新重点：
- 合并重复原则
- 压缩相似表达
- 淘汰长期未被验证、弱相关或明显过时的经验
- recent learnings 只保留最近少量高价值结论

---

### 遗忘机制

仅做“长度截断”是不够的，后续应补成真正的遗忘规则：

#### 空间索引
- 最近任务只保留 3-4 条最有代表性的
- 资产列表只保留 5-6 条最值得参考的
- 对长时间未再被引用、且无明显价值的资产逐步淘汰

#### 平台 Memory
- `principles / patterns / pitfalls` 保持短列表
- `recentLearnings` 只保留最新 4-6 条
- 对长期未再出现、也没有被新任务再次验证的方法论逐步删除

---

### 用户可见性原则

- `空间索引`：平台内部机制，不在文档空间树中展示
- `平台 Memory`：平台内部机制，不直接暴露给用户
- 用户只会看到启动前的自然反馈，例如：
  - 我先快速看一下这个空间的索引和已有内容
  - 我会结合已有上下文继续往下推进

用户不需要看到：
- 内部 README 文件
- 平台 memory 文件
- 系统如何更新这些内部索引

---

### 当前实现状态

#### 已完成
- 每个空间自动具备内部索引文档
- 对外工作空间树已隐藏索引文档
- 正式任务开始前会先读取空间索引和空间内容
- 无效/测试信息不会强行注入方案
- 任务完成后会自动更新空间索引
- 平台级 `platform-memory.json` 已建立
- 正式任务执行时会加载平台 memory
- 任务完成后会更新平台 memory

#### 仍需继续补强
- 平台 Memory 还需要前移到“正式任务开始前的回顾阶段”
- 平台 Memory 的遗忘机制目前仍偏保守，主要靠重写和长度控制
- 更新结果仍需继续观察是否足够稳定、是否会过度遗忘

---

### 验证清单

- [ ] 启动前回顾时，空间索引是否优先于普通文档被读取
- [ ] 如果空间里只有测试文档，是否会明确判定为“无有效上下文”
- [ ] 正式任务创建前，是否已经读取平台 Memory
- [ ] 任务完成后，空间索引是否发生“重写优化”而不是简单追加
- [ ] 任务完成后，平台 Memory 是否发生“重写优化”而不是简单追加
- [ ] 长时间后，空间索引和平台 Memory 是否仍保持短小、可读、有效

---

## 文件结构

### 新增文件

```
src/
├── agents/
│   ├── baseAgent.js              # Agent 基类（LLM 调用封装、重试、JSON 解析）
│   ├── orchestratorAgent.js
│   ├── researchAgent.js
│   ├── strategyAgent.js
│   ├── criticAgent.js
│   └── pptBuilderAgent.js
│
├── prompts/
│   ├── orchestrator.js           # 系统提示词（参数化，品牌/产品/活动类型注入）
│   ├── research.js
│   ├── strategy.js               # 含首轮和修订轮两套指令
│   ├── critic.js                 # 含评分规则和输出格式约束
│   └── pptBuilder.js             # 含 PPT JSON Schema 约束 + 配色规则
│
├── services/
│   ├── llmClients.js             # MiniMax / DeepSeek 客户端统一管理
│   ├── multiAgentOrchestrator.js # 编排主逻辑（含评审循环）
│   ├── previewRenderer.js        # PPT JSON → HTML 幻灯片（浏览器预览用）
│   └── taskManager.js            # 任务状态管理（内存存储）
│
└── routes/
    └── multiAgent.js             # SSE 接口 + 状态查询接口

public/
├── multi-agent.html              # 多 Agent 生成器页面（含预览区）
└── js/
    └── multiAgent.js             # SSE 客户端 + 进度 UI + 幻灯片预览渲染
```

### 修改的已有文件

| 文件 | 改动内容 |
|---|---|
| `src/routes/index.js` | 注册 `multiAgent` 路由 |
| `src/config.js` | 新增 LLM 配置项 |
| `.env` / `.env.example` | 新增 API Key 变量 |
| `package.json` | 新增 `openai` 依赖 |
| `public/css/style.css` | 新增进度条、幻灯片预览样式 |
| `src/services/pptGenerator.js` | 常量 `HUAWEI_RED` 改为 `PRIMARY_COLOR`，运行时由参数传入 |
| `src/templates/*.json` | 清空品牌相关内容，改为纯结构占位符（内容字段留空） |

### 不改动的文件

`src/services/templateManager.js` / `aiAssistant.js` / `src/server.js`

---

## 模板 JSON 重构说明

现有模板 JSON 中硬编码了真实品牌数据（智界/华为/刘亦菲等），需要改为**纯结构模板**：

```json
// 改造前（❌ 绑定品牌）
{
  "mainTitle": "智界汽车",
  "subtitle": "2025 上海国际车展策划方案",
  "brand": "HUAWEI 鸿蒙智行"
}

// 改造后（✅ 通用占位）
{
  "mainTitle": "",
  "subtitle": "",
  "brand": ""
}
```

模板只保留 `type`、`sectionNum`、页面结构字段，所有内容由 Agent 动态填充。

---

## pptGenerator 配色改造说明

```js
// 改造前（❌ 品牌色硬编码）
const COLORS = {
  HUAWEI_RED: 'FA2F1F',
  DEEP_BLUE: '002D6B',
  ...
}

// 改造后（✅ 运行时传入）
function generatePPT(templateData, outputFilename) {
  const primaryColor   = templateData.theme?.primary   || '1A1A1A'
  const secondaryColor = templateData.theme?.secondary || '333333'
  ...
}
```

---

## 环境变量

`.env` 新增以下变量：

```env
# MiniMax（订阅制，主力）
MINIMAX_API_KEY=sk-cp-RxVKwW4Ud...
MINIMAX_MODEL=MiniMax-Text-01

# DeepSeek（按量，仅 Critic Agent）
DEEPSEEK_API_KEY=sk-3748c1731e...
DEEPSEEK_REASONER_MODEL=deepseek-reasoner

# 评审配置
CRITIC_PASS_SCORE=7.0
CRITIC_MAX_ROUNDS=3
```

> Ones/GLM-5 暂作备用，不在主流程中使用

---

## 依赖安装

```bash
npm install openai
```

> `openai` 包支持自定义 `baseURL`，MiniMax 和 DeepSeek 均兼容 OpenAI 格式

---

## 实施路线图

### Phase 1 — 基础设施
- [ ] 安装 `openai` 依赖
- [ ] 实现 `llmClients.js`（初始化 MiniMax + DeepSeek 客户端）
- [ ] 验证 MiniMax `sk-cp-` key 的接口调用（确认 baseURL 和模型名）
- [ ] 实现 `baseAgent.js`（封装调用、重试 2 次、JSON 强制解析）
- [ ] 重构 `pptGenerator.js` 配色（去掉 `HUAWEI_RED`，改为运行时传参）
- [ ] 清空 `src/templates/*.json` 中的品牌内容，改为占位结构
- [ ] 更新 `config.js` 和 `.env.example`

### Phase 2 — Agent 实现
- [ ] `orchestratorAgent.js` + `prompts/orchestrator.js`
- [ ] `researchAgent.js` + `prompts/research.js`
- [ ] `strategyAgent.js` + `prompts/strategy.js`
- [ ] `criticAgent.js` + `prompts/critic.js`
- [ ] `pptBuilderAgent.js` + `prompts/pptBuilder.js`

### Phase 3 — 编排与 API
- [ ] `taskManager.js`（任务状态存内存，key = taskId）
- [ ] `multiAgentOrchestrator.js`（串联所有 Agent，含评审循环）
- [ ] `routes/multiAgent.js`（POST 触发 + GET SSE + GET 状态）
- [ ] 注册路由到 `routes/index.js`

### Phase 4 — 预览与前端
- [ ] `previewRenderer.js`（PPT JSON → HTML，与 pptGenerator 共用同一数据源）
- [ ] `multi-agent.html`（输入表单 + 进度展示 + 幻灯片预览 + 下载按钮）
- [ ] `public/js/multiAgent.js`（EventSource + 进度条 + 预览渲染）
- [ ] 主页添加入口链接

### Phase 5 — 调优
- [ ] 多品类端到端测试（汽车展 / 手机发布会 / 智能硬件展览）
- [ ] Prompt 调优（Strategy 方案质量 + Critic 评审准确性）
- [ ] 评分阈值校准（默认 7.0，可通过环境变量调整）
