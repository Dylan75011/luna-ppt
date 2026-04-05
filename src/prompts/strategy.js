// Strategy Agent 提示词
function buildStrategyPrompt(input) {
  const { orchestratorOutput, researchResults, round, previousFeedback, userInput } = input;
  const {
    brand, description, goal, audience, reference, tone, budget, requirements,
    spaceContextSummary, spaceContextKeyPoints, spaceContextDocs,
    platformMemorySummary, platformMemoryPrinciples, platformMemoryPatterns, platformMemoryPitfalls
  } = userInput;

  const systemPrompt = `你是一位顶级活动策划专家，有15年品牌线下活动策划经验，深度服务过汽车、消费电子、奢侈品、互联网等众多行业的发布会、车展、展览和峰会。

你的工作方式：先判断这个活动的核心命题是什么（是要制造话题？建立信任？还是带动转化？），再围绕这个命题设计策略和执行方案。每个活动都有它独特的挑战和机会，方案要体现出这种特殊性，而不是通用套路。

输出必须是合法的JSON格式，不要包含任何其他文字。`;

  const researchSummary = researchResults.map(r =>
    `【${r.taskId}】${r.focus || ''}\n摘要：${r.summary}\n关键发现：${(r.keyFindings || []).join('；')}\n启发：${(r.inspirations || []).join('；')}`
  ).join('\n\n');

  const revisionHint = round > 1 && previousFeedback ? `
## 上轮评审反馈（第${round - 1}轮，得分：${previousFeedback.score}）
不足之处：${(previousFeedback.weaknesses || []).join('；')}
具体建议：${previousFeedback.specificFeedback}

请针对以上反馈重点改进，保留已有亮点。` : '';

  const userPrompt = `请为以下活动制定完整策划方案（第${round}轮）。

## 活动基本信息
品牌：${brand}
需求描述：${description}
活动目标：${goal || '未明确，由你根据描述推断'}
目标受众：${audience || '未明确，由你根据品牌和活动类型推断'}
参考活动：${reference || '无特定参考'}
品牌调性：${tone || '未明确，由你根据品牌推断'}
预算量级：${budget || '未明确'}
补充需求：${requirements || '无'}
空间已有内容摘要：${spaceContextSummary || '无'}
空间已有关键线索：${(spaceContextKeyPoints || []).join('、') || '无'}
空间相关文档：${(spaceContextDocs || []).map(doc => doc.name).join('、') || '无'}
平台经验摘要：${platformMemorySummary || '无'}
平台策划原则：${(platformMemoryPrinciples || []).join('、') || '无'}
平台复用模式：${(platformMemoryPatterns || []).join('、') || '无'}
平台常见误区：${(platformMemoryPitfalls || []).join('、') || '无'}
核心目标：${orchestratorOutput.parsedGoal}
关键主题：${(orchestratorOutput.keyThemes || []).join('、')}
目标受众：${orchestratorOutput.targetAudience || '未指定'}
${revisionHint}

## 研究素材
${researchSummary}

请输出 JSON 格式的策划方案，结构如下：
{
  "planTitle": "方案标题（有记忆点，不要平铺直叙）",
  "coreStrategy": "这个活动的核心命题是什么？用一两句话说清楚「我们为什么这么做」",
  "highlights": ["最能打动人的差异化亮点，3-5条，要具体不要口号"],
  "sections": [
    {
      "title": "章节标题（你来定，根据方案需要）",
      "keyPoints": ["这一章最重要的2-3个判断或结论"],
      "narrative": "这一章的核心内容，用策划师的语言写，200字以内，要有观点不只是陈述事实"
    }
  ],
  "budget": {
    "total": "${budget || '待定'}",
    "breakdown": [
      {"item": "预算项", "amount": "金额", "percentage": "占比", "rationale": "这样分配的理由"}
    ]
  },
  "timeline": {
    "eventDate": "活动日期（如已知）",
    "phases": [
      {"phase": "阶段名", "duration": "时长", "milestone": "这个阶段要完成什么"}
    ]
  },
  "kpis": [
    {"metric": "指标名称", "target": "目标值", "rationale": "为什么设这个目标"}
  ],
  "riskMitigation": ["具体风险+具体应对，不要泛泛而谈"],
  "visualTheme": {
    "style": "活动整体视觉风格定位（1-2句话，如：科技感+未来主义、赛博朋克暗黑、极简现代北欧、奢华典雅东方、自然生态户外……根据活动内容和品牌气质判断）",
    "colorMood": "色彩基调描述（如：深蓝金色光效、黑白灰极简、暖橙渐变、冷青科技色、莫兰迪大地色……）",
    "imageKeywords": ["英文图片风格搜索词1（2-4个词）", "英文图片风格搜索词2", "英文图片风格搜索词3"]
  },
  "visualExecutionHints": {
    "sceneTone": "一句话说明现场效果图和空间表达应该呈现的气质",
    "mustRenderScenes": ["最值得提前给效果图建议的场景1", "场景2", "场景3"],
    "spatialKeywords": ["适合做空间效果图的英文关键词1", "关键词2", "关键词3"],
    "avoidElements": ["效果图里应避免出现的元素1", "元素2"],
    "onsiteDesignSuggestions": [
      {
        "scene": "主舞台 / 签到区 / 展区 / 互动装置等",
        "goal": "这个场景主要承担什么传播或体验任务",
        "designSuggestion": "对现场效果的具体设计建议，强调材质、灯光、动线、装置，而不是空泛口号",
        "visualFocus": ["建议重点表现的视觉元素1", "元素2", "元素3"]
      }
    ]
  }
}

sections 的数量和标题完全由你决定，根据这个活动的特点设计章节——该详述的地方展开，该精炼的地方收紧。
narrative 字段是关键：写出你作为策划专家的判断和洞察，不只是列要点。
visualTheme 字段必须根据活动的品牌调性、行业特点、目标受众来判断，不能照抄活动标题，要体现视觉美学主张。
visualExecutionHints 不是重复 visualTheme，而是把“现场效果该怎么设计、哪些场景值得提前出效果图建议”明确写出来，供后续策划文档和 PPT 生图使用。`;


  return { systemPrompt, userPrompt };
}

module.exports = { buildStrategyPrompt };
