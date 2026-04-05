// PPT 策划文档生成提示词

/**
 * 从 plan JSON 中提炼出可读性强的素材，避免把原始 JSON 直接扔给 DocWriter
 */
function extractPlanContext(plan) {
  const lines = [];

  if (plan.coreStrategy) {
    lines.push(`核心命题：${plan.coreStrategy}`);
  }

  if (plan.highlights?.length) {
    lines.push(`\n方案亮点：\n${plan.highlights.map(h => `- ${h}`).join('\n')}`);
  }

  if (plan.sections?.length) {
    lines.push('\n各章节策划思路：');
    plan.sections.forEach(s => {
      lines.push(`\n【${s.title}】`);
      if (s.narrative) lines.push(s.narrative);
      if (s.keyPoints?.length) {
        lines.push(s.keyPoints.map(p => `• ${p}`).join('\n'));
      }
    });
  }

  if (plan.budget?.breakdown?.length) {
    lines.push('\n预算分配：');
    plan.budget.breakdown.forEach(b => {
      const rationale = b.rationale ? `（${b.rationale}）` : '';
      lines.push(`- ${b.item}：${b.amount}，占比 ${b.percentage}${rationale}`);
    });
  }

  if (plan.timeline?.phases?.length) {
    lines.push('\n执行节奏：');
    plan.timeline.phases.forEach(p => {
      lines.push(`- ${p.phase}（${p.duration}）：${p.milestone || ''}`);
    });
  }

  if (plan.kpis?.length) {
    lines.push('\n核心 KPI：');
    plan.kpis.forEach(k => {
      const rationale = k.rationale ? `——${k.rationale}` : '';
      lines.push(`- ${k.metric}：${k.target}${rationale}`);
    });
  }

  if (plan.riskMitigation?.length) {
    lines.push('\n风险应对：');
    plan.riskMitigation.forEach(r => lines.push(`- ${r}`));
  }

  if (plan.visualExecutionHints?.sceneTone) {
    lines.push(`\n现场视觉气质：${plan.visualExecutionHints.sceneTone}`);
  }

  if (plan.visualExecutionHints?.mustRenderScenes?.length) {
    lines.push('\n建议提前出效果图的场景：');
    plan.visualExecutionHints.mustRenderScenes.forEach(item => lines.push(`- ${item}`));
  }

  if (plan.visualExecutionHints?.onsiteDesignSuggestions?.length) {
    lines.push('\n现场效果设计建议：');
    plan.visualExecutionHints.onsiteDesignSuggestions.forEach((item) => {
      lines.push(`- ${item.scene || '重点场景'}：${item.designSuggestion || item.goal || ''}`);
      if (item.visualFocus?.length) {
        lines.push(`  视觉重点：${item.visualFocus.join('、')}`);
      }
    });
  }

  return lines.join('\n');
}

function buildDocWriterPrompt(plan, userInput, reviewFeedback) {
  const { brand, productCategory, eventType, topic, scale, budget } = userInput;

  const planContext = extractPlanContext(plan);
  const feedbackNote = reviewFeedback?.specificFeedback
    ? `\n评审专家意见（已在方案中吸收）：${reviewFeedback.specificFeedback}`
    : '';

  const systemPrompt = `你是一位资深活动策划顾问，长期为品牌决策层提供策划方案。你写的文档有一个特点：读起来像是一个真正有经验的人在讲述他的判断和建议，而不是在填表格或汇总数据。

格式规范（硬性要求）：
- 标准 Markdown，# ## ### 标题层级
- 关键结论和数据 **加粗**
- 列表用 -，数据对比用表格
- 直接输出正文，不要前言和解释

写作要求：
- 用第一人称视角（「我们建议」「我们判断」），不要「本方案」「本次活动」这类官样文体
- 每个章节开头先给出判断或结论，再展开说明，不要流水账式铺陈
- 数字和案例要具体，模糊表述宁可不写
- 章节结构由你根据这份方案的逻辑自主设计，不要套固定模板
- 如果方案里包含现场视觉或效果图建议，请单独写出“现场效果设计建议”相关章节，明确哪些场景值得提前出图，以及各自该怎么设计`;

  const userPrompt = `品牌：${brand}
活动类型：${eventType}
主题：${topic}
产品类别：${productCategory}
规模：${scale}
预算：${budget}
${feedbackNote}

以下是策划团队经过研究和多轮评审沉淀下来的方案思路：

${planContext}

请基于以上内容，写一份完整的策划文档。
第一行是一级标题（使用方案的 planTitle）。
其余结构你来设计——怎样组织这份文档才能让决策层最快理解「为什么值得做」和「怎么做到」。`;

  return { systemPrompt, userPrompt };
}

module.exports = { buildDocWriterPrompt };
