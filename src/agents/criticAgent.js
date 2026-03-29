const BaseAgent = require('./baseAgent');
const { buildCriticPrompt } = require('../prompts/critic');

class CriticAgent extends BaseAgent {
  constructor() {
    super('CriticAgent', 'deepseek-reasoner');
  }

  async run({ plan, round, userInput }) {
    console.log(`[CriticAgent] 开始评审（第${round}轮）...`);
    const { systemPrompt, userPrompt } = buildCriticPrompt(plan, round, userInput);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
    const result = await this.callLLMJson(messages, { maxTokens: 4096, temperature: 0.5 });
    result.passed = result.score >= 7.0;
    console.log(`[CriticAgent] 评审完成，得分: ${result.score}，通过: ${result.passed}`);
    return result;
  }
}

module.exports = CriticAgent;
