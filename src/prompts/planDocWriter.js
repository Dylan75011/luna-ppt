// 策划方案"分阶段生成"prompt 集
//
// 三阶段架构：
//   1) buildSkeletonPrompt  → 骨架（标题/核心策略/亮点/章节列表/章节要点）
//   2) buildSectionPrompt   → 单章节展开（narrative + 执行细节 + 物料）
//   3) buildDetailsPrompt   → 详情（预算/节奏/KPI/风险/视觉）
//
// 加上配套的轻量级"单段美化"prompt（buildPolishSectionPrompt），用于后台
// pipeline 在每段写完后并行润色。
//
// 这套 prompt 替代了原来"一次性产出整篇 markdown + plan_json"的单调用模式。
// 每段输出严格用 JSON（无 markdown），最终 markdown 由后端模板拼接。

function buildBriefBlock(userInput = {}, orchestratorOutput = {}) {
  const {
    brand = '', description = '', goal = '', audience = '', tone = '',
    budget = '', requirements = '', topic = ''
  } = userInput;

  return `## 活动基本信息
品牌/客户：${brand || '（未指定）'}
活动/项目：${topic || description || '（未指定）'}
核心目标：${goal || orchestratorOutput.parsedGoal || '（未明确）'}
目标受众：${audience || '（未明确）'}
风格调性：${tone || '（未明确）'}
预算量级：${budget || '（未明确）'}
补充要求：${requirements || '无'}
关键主题：${(orchestratorOutput.keyThemes || []).join('、') || '无'}`;
}

function buildResearchBlock(researchResults = []) {
  const summary = (Array.isArray(researchResults) ? researchResults : [])
    .map(r => `【${r.taskId || r.focus || '研究'}】${r.focus || ''}\n${r.summary || ''}`)
    .join('\n\n');
  return `## 研究素材\n${summary || '（暂无补充研究）'}`;
}

function buildApprovedConceptBlock(approvedConcept) {
  if (!approvedConcept) return '';
  return `
## 已确认的活动主体思路（必须沿用）

主题：${approvedConcept.themeName || '（待定）'}
核心创意：${approvedConcept.coreIdea || ''}
亮点方向：
${(approvedConcept.creativeAngles || []).map((a, i) => `${i + 1}. ${a}`).join('\n') || '（无）'}
整体调性：${approvedConcept.toneAndStyle || ''}

要求：方案必须沿用此方向，不得替换主题/核心创意。可在执行细节、章节结构上深化。`;
}

// ─────────────────────────────────────────────────────────────────────
// 阶段 1：骨架
// ─────────────────────────────────────────────────────────────────────
function buildSkeletonPrompt(input) {
  const { orchestratorOutput = {}, researchResults = [], userInput = {}, approvedConcept = null } = input;

  const systemPrompt = `你是顶级活动策划专家。这是「分阶段生成」的第 1 阶段：先出方案骨架。

你的任务：基于活动信息和已确认创意，产出一份**结构化骨架 JSON**。骨架决定整份方案的章节走向，但不写章节正文——正文会在下一阶段逐章展开。

硬性要求：
- 直接输出 JSON，不要前言、说明、markdown 代码块围栏、<think> 推理
- 整体输出**不超过 1500 字**
- sections 必须 3-5 章（视活动复杂度），每章只给 title 和 3-5 条 keyPoints + 一句 focus（这章想达成什么）
- title 要具体不要套话："开场仪式与品牌亮相"好过"项目背景"
- keyPoints 是要点列表（每条 ≤25 字），不是完整段落
- focus 一句话说清"这章读完用户应该理解什么"`;

  const userPrompt = `请基于以下信息产出策划方案骨架。

${buildBriefBlock(userInput, orchestratorOutput)}

${buildResearchBlock(researchResults)}
${buildApprovedConceptBlock(approvedConcept)}

直接输出以下结构的 JSON：

{
  "planTitle": "方案标题（要有记忆点，不要写成'XX 活动策划方案'这种官样名）",
  "coreStrategy": "核心策略一句话（≤50字）：这份方案的总命题",
  "highlights": [
    "亮点1（≤30字）",
    "亮点2",
    "亮点3"
  ],
  "sections": [
    {
      "title": "章节标题（具体、有判断）",
      "keyPoints": ["要点1（≤25字）", "要点2", "要点3"],
      "focus": "这章想让读者理解什么（一句话，≤40字）"
    }
  ],
  "eventDate": "活动日期（如已知，否则空串）",
  "audienceProfile": "目标受众一句话（≤30字）"
}

要求：
- sections 3-5 章，覆盖完整活动周期（前期筹备 → 活动当天 → 后续传播 等关键节点）
- 每章 keyPoints 互不重复，焦点清晰
- 不要把"预算/KPI/风险"写成 sections——这些会在第 3 阶段单独产出`;

  return { systemPrompt, userPrompt };
}

// ─────────────────────────────────────────────────────────────────────
// 阶段 2：单章节展开
// ─────────────────────────────────────────────────────────────────────
function buildSectionPrompt(input) {
  const { skeleton = {}, section = {}, userInput = {}, approvedConcept = null } = input;
  const allSectionTitles = (skeleton.sections || []).map((s, i) => `  ${i + 1}. ${s.title}`).join('\n');

  const systemPrompt = `你是顶级活动策划专家。这是「分阶段生成」的第 2 阶段：展开单章节。

你的任务：把当前章节的 keyPoints 展开成具体可执行的正文 + 落地细节。其他章节会被并行展开，所以你**只写当前这一章**，不要重复其他章节的内容。

硬性要求：
- 直接输出 JSON，不要前言、不要 markdown、不要代码块围栏、不要 <think>
- 整体输出**不超过 800 字**
- narrative 是这一章的正文段落（300-500 字），第一人称（"我们建议"），不要"本章节将"这种官样
- executionDetails 是具体落地点（3-5 条，每条 ≤40 字），写得让人能直接照着干
- materials 是物料/视觉/装置等可视化要素（2-4 条，每条 ≤30 字），可选
- 不要重复其他章节的 keyPoints，专注本章
- 数字与案例要具体不要"大量""多种"`;

  const userPrompt = `请展开下面这一章。

## 方案上下文
- 方案标题：${skeleton.planTitle || ''}
- 核心策略：${skeleton.coreStrategy || ''}
- 全部章节列表（仅供你了解全貌，不要在本章重复其他章内容）：
${allSectionTitles || '（无）'}

## 当前章节（你要展开的）
- 标题：${section.title || ''}
- 要点：
${(section.keyPoints || []).map((k, i) => `  ${i + 1}. ${k}`).join('\n') || '（无）'}
- 焦点：${section.focus || ''}

## 活动基本信息
品牌：${userInput.brand || '（未指定）'}
受众：${userInput.audience || '（未明确）'}
调性：${userInput.tone || '（未明确）'}
${approvedConcept ? `\n## 已确认主题（必须沿用）\n${approvedConcept.themeName || ''}\n核心：${approvedConcept.coreIdea || ''}` : ''}

输出 JSON：
{
  "narrative": "300-500字正文段落",
  "executionDetails": ["落地点1（≤40字）", "落地点2", "落地点3"],
  "materials": ["物料/装置1（≤30字）", "物料2"]
}`;

  return { systemPrompt, userPrompt };
}

// ─────────────────────────────────────────────────────────────────────
// 阶段 3：详情（预算/节奏/KPI/风险/视觉）
// ─────────────────────────────────────────────────────────────────────
function buildDetailsPrompt(input) {
  const { skeleton = {}, expandedSections = [], userInput = {} } = input;
  const sectionsBrief = expandedSections
    .map((s, i) => `  ${i + 1}. ${s.title}：${s.narrative ? s.narrative.slice(0, 80) : ''}`)
    .join('\n');

  const systemPrompt = `你是顶级活动策划专家。这是「分阶段生成」的第 3 阶段：补全方案的预算/节奏/KPI/风险/视觉。

你的任务：基于已经写好的章节内容，给出可量化的预算分解、时间节奏、KPI 指标、风险应对、视觉指引。

硬性要求：
- 直接输出 JSON，不要前言、不要 markdown、不要代码块围栏、不要 <think>
- 整体输出**不超过 1200 字**
- 预算 breakdown 要具体到项（场地/物料/媒介/执行/应急），数字加百分比
- timeline.phases 给 3-5 个阶段（T-30 / T-7 / 当天 / T+7 等），每阶段 milestone 一句话
- kpis 给 3-5 条，每条要有具体目标值（不能写"较高""明显提升"）
- riskMitigation 每条是"风险 + 应对动作"组合，不要只写风险不给方案
- visualExecutionHints 给现场视觉/空间设计具体建议，imageKeywords 用英文`;

  const userPrompt = `请基于以下方案内容补全详情。

## 方案标题
${skeleton.planTitle || ''}

## 核心策略
${skeleton.coreStrategy || ''}

## 已展开章节（仅摘要，供你定预算/节奏/KPI 用）
${sectionsBrief || '（无）'}

## 活动信息
品牌：${userInput.brand || '（未指定）'}
预算量级：${userInput.budget || '（未明确）'}
${skeleton.eventDate ? `活动日期：${skeleton.eventDate}` : ''}

输出 JSON：
{
  "budget": {
    "total": "${userInput.budget || '待定'}",
    "breakdown": [
      { "item": "场地/搭建", "amount": "金额", "percentage": "占比%", "rationale": "≤30字理由" }
    ]
  },
  "timeline": {
    "eventDate": "${skeleton.eventDate || '待定'}",
    "phases": [
      { "phase": "T-30 筹备期", "duration": "时长", "milestone": "≤25字关键产出" }
    ]
  },
  "kpis": [
    { "metric": "指标名", "target": "具体数字目标", "rationale": "≤30字设定理由" }
  ],
  "riskMitigation": [
    "风险点 + 应对动作（≤40字一条）"
  ],
  "visualTheme": {
    "style": "整体视觉风格（≤30字）",
    "colorMood": "色彩基调（≤20字）",
    "imageKeywords": ["english_keyword_1", "english_keyword_2", "english_keyword_3"]
  },
  "visualExecutionHints": {
    "sceneTone": "现场气质一句话（≤25字）",
    "mustRenderScenes": ["场景1（≤15字）", "场景2", "场景3"],
    "spatialKeywords": ["english_keyword_1", "english_keyword_2"],
    "avoidElements": ["应避免元素1（≤15字）"],
    "onsiteDesignSuggestions": [
      { "scene": "主舞台/签到区等", "goal": "≤20字承担任务", "designSuggestion": "≤40字具体设计", "visualFocus": ["要素1", "要素2"] }
    ]
  }
}`;

  return { systemPrompt, userPrompt };
}

// ─────────────────────────────────────────────────────────────────────
// 单段美化（轻量、给后台 pipeline 用）
// ─────────────────────────────────────────────────────────────────────
function buildPolishSectionPrompt(input) {
  const { section = {}, expanded = {} } = input;
  const systemPrompt = `你是资深内容编辑。给你一段策划方案的章节正文，请只做"语言润色"，不增删信息、不改事实。

硬性约束：
- 不得增加新的观点/数字/案例
- 不得删减原文任何要点
- 仅做：句式打磨、官样词替换为第一人称、并列项拆成短句、加强节奏感
- 输出**只返回润色后的 narrative 文本**，不要 JSON、不要 markdown 标题、不要前言、不要 <think>
- 长度与原文相近（±20% 以内）`;

  const userPrompt = `章节标题：${section.title || ''}

原文：
${expanded.narrative || ''}

请输出润色后的正文（纯文本，不要任何标签或代码块）。`;

  return { systemPrompt, userPrompt };
}

module.exports = {
  buildSkeletonPrompt,
  buildSectionPrompt,
  buildDetailsPrompt,
  buildPolishSectionPrompt
};
