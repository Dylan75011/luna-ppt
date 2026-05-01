// Challenge Brief 工具：在 web_search / propose_concept 之前，主动扫 brief 找红旗
const { challengeBrief } = require('../../skills');
const { makeSkillStatusBridge } = require('./skillStatusBridge');

const RESEARCH_CONTEXT_MAX_CHARS = 4000;

function buildResearchContext(session) {
  const store = Array.isArray(session.researchStore) ? session.researchStore : [];
  if (!store.length) return '';
  const parts = [];
  let totalChars = 0;
  for (let i = store.length - 1; i >= 0; i--) {
    const entry = store[i];
    const results = Array.isArray(entry.results) ? entry.results : [];
    const block = `【搜索${i + 1}】${entry.query || ''}\n` +
      results.map((r, j) => `  [${j + 1}] ${r.title || ''}\n  ${r.snippet || ''}`).join('\n');
    if (totalChars + block.length > RESEARCH_CONTEXT_MAX_CHARS) break;
    parts.unshift(block);
    totalChars += block.length;
  }
  return parts.join('\n\n');
}

async function execChallengeBrief(args = {}, session, onEvent) {
  const brief = session.brief || {};
  const userInput = {
    brand: args.brand || session.userInput?.brand || brief.brand || '',
    description: args.event_description || session.userInput?.description || brief.topic || '',
    goal: args.goal || session.userInput?.goal || brief.goal || '',
    audience: args.audience || session.userInput?.audience || brief.audience || '',
    tone: args.tone || session.userInput?.tone || brief.tone || '',
    budget: args.budget || session.userInput?.budget || brief.budget || '',
    requirements: args.requirements || session.userInput?.requirements || brief.requirements || '',
    topic: args.topic || session.userInput?.topic || brief.topic || ''
  };

  if (!userInput.brand && !userInput.description && !userInput.topic) {
    return {
      success: false,
      error: 'brief 信息太少，无法有效质疑。请先 update_brief 把已知信息填进去，再调 challenge_brief。'
    };
  }

  const existingAssumptions = Array.isArray(brief.assumptions) ? brief.assumptions : [];
  const researchContext = buildResearchContext(session);

  onEvent('tool_progress', { message: '正在审视 brief，找潜在硬伤...' });

  let result;
  try {
    result = await challengeBrief({
      userInput,
      existingAssumptions,
      researchContext,
      onStatus: makeSkillStatusBridge(onEvent, { skillLabel: '审视 brief' })
    }, session.apiKeys);
  } catch (err) {
    console.warn('[challenge_brief] 失败:', err.message);
    return { success: false, error: err.message };
  }

  session.lastChallenge = result;

  onEvent('artifact', {
    artifactType: 'brief_challenge',
    payload: {
      hasConcerns: result.hasConcerns,
      overallAssessment: result.overallAssessment || '',
      concerns: (result.concerns || []).map(c => ({
        severity: c.severity,
        axis: c.axis || '',
        issue: c.issue || '',
        why: c.why || '',
        resolution: c.resolution || ''
      })),
      suggestedQuestion: result.suggestedQuestion || '',
      degraded: !!result.degraded
    }
  });

  const concernCount = (result.concerns || []).length;
  onEvent('tool_progress', {
    message: result.hasConcerns
      ? `找到 ${concernCount} 条需要跟客户对齐的风险点`
      : 'brief 审核通过，没有明显红旗'
  });

  const nextStepHint = result.hasConcerns
    ? `已发现 ${concernCount} 条潜在硬伤（overallAssessment: ${result.overallAssessment}）。质疑卡片已渲染在对话里，里面列了每条 concern 的 issue/why/resolution。你现在应该：(1) 用 1-2 句口语化的话表明你注意到了这些问题（像朋友担心的口吻，不是甩锅），（2）如果只有 1 条 high 级 concern，直接调 ask_user 针对 suggestedQuestion 问用户；如果有多条，也只问最关键那条，让用户回应。**不要在 brief 没解决红旗的情况下偷偷调 propose_concept。** 用户回复后：要么 update_brief 修正 brief，要么在 assumptions 里明确记录"用户选择接受 X 取舍继续"，然后再推进到 propose_concept。`
    : 'brief 审视完成，没有硬伤，可以直接进入 propose_concept 梳理创意方向。不要在对话里复述"没有问题"这种废话，直接推进到下一步即可。';

  return {
    success: true,
    hasConcerns: result.hasConcerns,
    concernCount,
    highSeverityCount: (result.concerns || []).filter(c => c.severity === 'high').length,
    overallAssessment: result.overallAssessment || '',
    suggestedQuestion: result.suggestedQuestion || '',
    nextStepHint
  };
}

module.exports = { execChallengeBrief };
