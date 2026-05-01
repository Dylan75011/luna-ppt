// Critic Agent 提示词（使用 DeepSeek V4-Pro）
function buildCriticPrompt(plan, round, userInput) {
  const { brand, productCategory, eventType, budget } = userInput;

  const systemPrompt = `你是一位资深活动策划评审专家，曾担任多届行业大奖评委，对${productCategory}行业的品牌活动有深刻理解。
你的任务是从专业角度严格评审活动策划方案，给出客观分数和具体改进意见。
评审要有批判性，发现真实问题，不要给虚高分数。

输出必须是合法的JSON格式，不要包含任何其他文字。`;

  const planSummary = JSON.stringify({
    planTitle: plan.planTitle,
    coreStrategy: plan.coreStrategy,
    highlights: plan.highlights,
    sections: plan.sections?.map(s => ({ title: s.title, keyPoints: s.keyPoints })),
    budget: plan.budget,
    riskMitigation: plan.riskMitigation
  }, null, 2);

  const userPrompt = `请对以下${brand}品牌${eventType}策划方案进行专业评审（第${round}轮）。

## 方案内容
${planSummary}

## 评审维度（各20分，满分100分，最终转换为10分制）

1. **主题创意度（20分）**：是否有差异化记忆点，能在同类活动中脱颖而出
2. **目标可达性（20分）**：KPI是否合理，执行路径是否清晰可落地
3. **预算合理性（20分）**：预算${budget}，各项分配是否符合${productCategory}行业规范
4. **内容专业度（20分）**：策划逻辑是否严谨，细节是否到位
5. **亮点竞争力（20分）**：是否有1-2个令人印象深刻的活动亮点

请输出以下JSON格式：
{
  "score": 总分（0-10，保留1位小数）,
  "passed": true或false（score >= 7.0为通过）,
  "scores": {
    "creativity": 分数（0-10）,
    "achievability": 分数（0-10）,
    "budget": 分数（0-10）,
    "professionalism": 分数（0-10）,
    "competitiveness": 分数（0-10）
  },
  "strengths": ["优点1（具体说明）", "优点2"],
  "weaknesses": ["不足1（具体说明）", "不足2"],
  "specificFeedback": "针对具体章节或内容的详细改进建议（200字以内）",
  "round": ${round}
}

评分要求：
- 7分以上才算通过，标准要严格
- weaknesses 必须具体指出问题所在，不能泛泛而谈
- specificFeedback 要给出可操作的改进方向`;

  return { systemPrompt, userPrompt };
}

module.exports = { buildCriticPrompt };
