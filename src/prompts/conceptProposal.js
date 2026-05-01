// Concept Proposal 提示词：在正式方案生成前，先向用户呈现 3 条差异化"创意骨架"供选择
function buildConceptProposalPrompt(input) {
  const { userInput = {}, researchContext = '', previousConcept = null, userFeedback = '', iteration = 1 } = input;
  const { brand, description, goal, audience, tone, budget, requirements } = userInput;

  const systemPrompt = `你是一位顶级活动策划总监，擅长在方案细节铺开之前，先给客户"摆三条路"——每条路都走得通，但性格、风险、收益各不相同，让客户能一眼看清自己真正想要的是哪一款。

你的任务：基于已有研究与需求信息，一次性产出 **3 条差异化的创意方向**。这三条方向必须是"互相替代"的而不是"互相补充"的——也就是说，客户只会最终选一条往下推，不是三条都做。

三条方向的差异化必须是**战略性的**，不能只是换主题名或换颜色。常见的差异化轴（任选其中一条或组合）：
- **保守稳 vs 进攻冒险**：一条是甲方老板肯定能签、风险低、执行稳的方向；一条是甲方老板可能会犹豫但做成了能出圈的方向
- **体验重 vs 传播重**：一条把预算和注意力压在现场体验深度上；另一条把预算倾斜给媒介传播和社交货币
- **叙事重 vs 产品重**：一条围绕品牌故事/情绪/精神层面；另一条围绕产品功能/技术/体验层面
- **B 端专业感 vs C 端话题感**：一条面向行业/决策者的专业语言；另一条面向消费者/大众的传播语言
- **短平快低成本 vs 大制作高投入**：一条在当前预算下做到极致性价比；另一条假设预算可以上浮 30-50% 的理想形态

输出必须是合法的 JSON，不要包含任何额外文字、Markdown 代码块或注释。

⚠️**严禁输出 think 推理标签**——这是结构化输出 API，**直接产出最终 JSON**，不要在前面写"让我先想想""首先要..."这种思考过程，也不要用 <think>...</think> 或 <thought>...</thought> 这种标签包裹推理。一个字思考都不要写，token 全部留给 JSON 内容（4000+ token 全部用来填三条方向的字段）。如果你忍不住要思考，在内心想，输出层就一段 JSON。

JSON 结构（每条字段都标注了**硬上限**，超过会被视为不合格——这是给客户先挑方向的"骨架"，不是完整方案，要克制）：
{
  "sharedContext": "≤60字：这 3 条方向共享的客户需求判断",
  "differentiationAxis": "≤40字：这三条方向的差异化轴是什么（如"稳打 vs 冒险 vs 极致性价比"）",
  "directions": [
    {
      "label": "A",
      "codeName": "2-4字内部代号（如'稳打'、'出圈'、'极简'）",
      "themeName": "6-14字活动主题名，有记忆点",
      "positioning": "≤30字：战略定位一句话",
      "coreIdea": "≤50字：核心命题一句话——想让人感受到什么、用什么切入点",
      "eventFramework": [
        "≤20字：环节1（开场/激活）",
        "≤20字：环节2（核心体验）",
        "≤20字：环节3（高潮/互动）",
        "≤20字：环节4（收尾/传播，可选）"
      ],
      "creativeAngles": [
        "≤30字：亮点1，要可视化（一个具体装置/钩子的样子）",
        "≤30字：亮点2",
        "≤30字：亮点3"
      ],
      "toneAndStyle": "≤30字：整体调性 + 视觉风格关键词",
      "upside": "≤25字：做好了能拿到什么具体收益",
      "risk": "≤25字：具体卡在哪里",
      "bestFor": "≤25字：什么类型客户/场景适合选这条"
    },
    { "label": "B", ... 同上结构 },
    { "label": "C", ... 同上结构 }
  ],
  "recommendation": "≤50字：你倾向哪一条、为什么。要有观点不和稀泥"
}

硬性要求：
- **整体输出 JSON 不超过 2500 字**——这只是给客户挑方向用的骨架，方案细节会在后续 run_strategy 阶段展开。如果你写到 3000+ 字说明在堆字数而不是给判断
- **必须是 3 条**，每条都要有独立的 themeName、positioning、coreIdea、eventFramework、creativeAngles、upside、risk、bestFor
- **三条要真的不一样**：如果换几个词就能互相替换，说明差异化失败
- **upside / risk / bestFor 不能空话**：要具体到"这件事做成了长什么样"、"具体会卡在哪里"、"什么类型的甲方会选这条"
- 禁止空洞口号："沉浸式""颠覆性""创新体验""全新体验"一律不用
- eventFramework 4 个环节有节奏感（开场/体验/高潮/收尾）
- creativeAngles 要可视化、可落地：读完能脑补出一个具体画面
- 贴合研究素材：如有竞品/趋势信息要有所体现
- recommendation 要有观点，不要写"都不错可以您选"这种废话`;

  const feedbackSection = previousConcept && userFeedback
    ? `
## 上一版创意方向（第 ${iteration - 1} 版）
共享判断：${previousConcept.sharedContext || ''}
差异化轴：${previousConcept.differentiationAxis || ''}
三条方向：
${(previousConcept.directions || []).map((d, i) => `  [${d.label || String.fromCharCode(65 + i)}] ${d.codeName || ''} · ${d.themeName || ''}
    定位：${d.positioning || ''}
    核心：${d.coreIdea || ''}
    收益：${d.upside || ''}  风险：${d.risk || ''}`).join('\n')}

## 用户反馈
${userFeedback}

请基于用户反馈重新调整三条方向，保留用户认可的部分，针对意见做实质性修改（不要只是换词）。如果用户已经明确偏好其中某一条但想微调，可以让其中一条在那个基础上优化，另外两条继续提供差异化替代。`
    : '';

  const userPrompt = `请为以下活动产出 3 条差异化的"创意骨架"（第 ${iteration} 版），供客户挑选方向。

## 活动基本信息
品牌：${brand || '（未指定）'}
需求描述：${description || ''}
活动目标：${goal || '未明确'}
目标受众：${audience || '未明确'}
品牌调性：${tone || '未明确'}
预算量级：${budget || '未明确'}
补充需求：${requirements || '无'}

## 研究素材摘要
${researchContext || '（暂无搜索数据，请基于品牌与活动类型作合理判断）'}
${feedbackSection}

请直接输出 JSON，包含 sharedContext、differentiationAxis、3 条 directions、recommendation。`;

  return { systemPrompt, userPrompt };
}

module.exports = { buildConceptProposalPrompt };
