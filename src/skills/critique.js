// Skill: 用 DeepSeek V4-Pro 对策划方案打分评审，判断是否通过
const { callLLMJson } = require('../utils/llmUtils');
const { buildCriticPrompt } = require('../prompts/critic');
const { normalizeCritiqueResult } = require('../utils/structuredOutput');

const PASS_THRESHOLD = 7.0;

/**
 * @param {{ plan, round, userInput }} input
 * @param {object} apiKeys  { deepseekApiKey }
 * @returns {Promise<{ score, passed, strengths, weaknesses, specificFeedback }>}
 */
async function critique({ plan, round, userInput, onStatus }, apiKeys) {
  console.log(`[skill:critique] 开始评审（第${round}轮）...`);
  const { systemPrompt, userPrompt } = buildCriticPrompt(plan, round, userInput);
  const result = await callLLMJson(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    {
      model: 'deepseek-reasoner',
      runtimeKey: apiKeys.deepseekApiKey,
      maxTokens: 2048,
      timeoutMs: 90000,
      temperature: 0.5,
      name: 'critique',
      validate: normalizeCritiqueResult,
      repairHint: '必须返回对象，包含 score(number)、strengths(string[])、weaknesses(string[])、specificFeedback(string)。',
      debugLabel: 'critique',
      onStatus
    }
  );
  result.passed = result.score >= PASS_THRESHOLD;
  console.log(`[skill:critique] 评审完成，得分: ${result.score}，通过: ${result.passed}`);
  return result;
}

module.exports = { critique };
