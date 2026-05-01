// Skill: 在进入研究 / 创意方向之前，由"质疑总监"扫一遍 brief，找红旗硬伤
const { callLLMJson } = require('../utils/llmUtils');
const { buildChallengeBriefPrompt } = require('../prompts/challengeBrief');

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

const toStr = (v) => String(v || '').trim();

function normalizeConcern(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('concern must be an object');
  const severity = toStr(raw.severity).toLowerCase();
  const normalizedSeverity = ['high', 'medium', 'low'].includes(severity) ? severity : 'medium';
  const issue = toStr(raw.issue);
  if (!issue) throw new Error('concern missing issue');
  return {
    severity: normalizedSeverity,
    axis: toStr(raw.axis),
    issue,
    why: toStr(raw.why),
    resolution: toStr(raw.resolution)
  };
}

function normalizeChallengeResult(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('challenge result must be an object');
  const hasConcerns = !!raw.hasConcerns;
  const rawList = Array.isArray(raw.concerns) ? raw.concerns : [];
  const concerns = rawList
    .map(c => {
      try { return normalizeConcern(c); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
    .slice(0, 3);

  return {
    hasConcerns: hasConcerns && concerns.length > 0,
    overallAssessment: toStr(raw.overallAssessment) || toStr(raw.overall_assessment),
    concerns,
    suggestedQuestion: toStr(raw.suggestedQuestion) || toStr(raw.suggested_question)
  };
}

function buildNoConcernResult() {
  return {
    hasConcerns: false,
    overallAssessment: '信息基本齐，没有明显红旗，可以直接推进到下一步',
    concerns: [],
    suggestedQuestion: ''
  };
}

/**
 * @param {{ userInput, researchContext?, existingAssumptions?, onStatus? }} input
 * @param {object} apiKeys
 * @returns {Promise<{ hasConcerns, overallAssessment, concerns, suggestedQuestion, degraded? }>}
 */
async function challengeBrief(input, apiKeys = {}) {
  console.log('[skill:challengeBrief] 审视 brief 找红旗...');
  const { systemPrompt, userPrompt } = buildChallengeBriefPrompt(input);

  const result = await callLLMJson(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    {
      model: 'minimax',
      runtimeKey: apiKeys.minimaxApiKey,
      minimaxModel: apiKeys.minimaxModel,
      // 输出最多 3 条 concerns × 平均 200 字 ≈ 600 字 ≈ 800 token 顶天，
      // 之前 1500 让 LLM 多写 → 多 token = 多生成时间 + JSON 截断/重试概率上升。
      // 砍到 800 对正常输出零影响，反而让响应更稳更快。
      maxTokens: 800,
      streaming: false,
      name: 'challengeBrief',
      validate: normalizeChallengeResult,
      repairHint: '必须是对象，含 hasConcerns(boolean)、overallAssessment(string)、concerns(array)、suggestedQuestion(string)',
      debugLabel: 'challengeBrief',
      onStatus: input.onStatus,
      fallback: ({ error }) => {
        console.warn('[skill:challengeBrief] 启用兜底：默认无红旗:', error?.message || error);
        return { ...buildNoConcernResult(), degraded: true, fallbackReason: error?.message || String(error || '') };
      }
    }
  );
  console.log(`[skill:challengeBrief] 完成，concerns=${result.concerns.length} (${result.hasConcerns ? '有红旗' : '无红旗'})`);
  return result;
}

module.exports = { challengeBrief, normalizeChallengeResult, buildNoConcernResult };
