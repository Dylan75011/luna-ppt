const { buildTaskPromptContext } = require('../services/contextEngineering');

// Orchestrator Agent 提示词
function buildOrchestratorPrompt(input) {
  const { brand, productCategory, eventType, topic, scale, budget, style, requirements } = input;
  const ctx = buildTaskPromptContext(input);

  const systemPrompt = `你是一位资深活动策划顾问，擅长为各类品牌的线下发布会、展览、峰会等活动制定策划方案。
你的任务是解析用户的活动需求，提炼核心目标和主题，并拆解出3个并行搜索任务供Research Agent使用。

输出必须是合法的JSON格式，不要包含任何其他文字。`;

  const userPrompt = `请分析以下活动策划需求，输出结构化的任务分解。

品牌名称：${brand}
产品类别：${productCategory}
活动类型：${eventType}
活动主题：${topic}
活动规模：${scale}
预算：${budget}
视觉风格：${style || '未指定'}
补充需求：${requirements || '无'}
补充需求：${ctx.requirements || '无'}
空间已有内容摘要：${ctx.spaceContextSummary || '无'}
空间已有关键线索：${ctx.spaceContextKeyPoints.join('、') || '无'}
空间相关文档：${ctx.spaceContextDocs.join('、') || '无'}
平台经验摘要：${ctx.platformMemorySummary || '无'}
平台策划原则：${ctx.platformMemoryPrinciples.join('、') || '无'}
平台复用模式：${ctx.platformMemoryPatterns.join('、') || '无'}
平台常见误区：${ctx.platformMemoryPitfalls.join('、') || '无'}

请输出以下JSON格式：
{
  "parsedGoal": "一句话概括核心目标",
  "keyThemes": ["主题词1", "主题词2", "主题词3"],
  "targetAudience": "目标受众描述",
  "searchTasks": [
    {
      "id": "r1",
      "focus": "搜索方向描述",
      "keywords": ["关键词1", "关键词2", "关键词3"]
    },
    {
      "id": "r2",
      "focus": "搜索方向描述",
      "keywords": ["关键词1", "关键词2", "关键词3"]
    },
    {
      "id": "r3",
      "focus": "搜索方向描述",
      "keywords": ["关键词1", "关键词2", "关键词3"]
    }
  ],
  "pptStructureHint": "PPT结构建议，如页数范围和重点章节"
}

searchTasks的3个方向应分别覆盖：
1. 行业趋势与竞品动态（${productCategory}行业 + ${eventType}类型）
2. ${brand}品牌定位与成功案例
3. ${eventType}类型活动创意形式与互动玩法`;

  return { systemPrompt, userPrompt };
}

module.exports = { buildOrchestratorPrompt };
