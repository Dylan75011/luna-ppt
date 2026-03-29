const BaseAgent = require('./baseAgent');
const { buildStrategyPrompt } = require('../prompts/strategy');

class StrategyAgent extends BaseAgent {
  constructor() {
    super('StrategyAgent', 'minimax');
  }

  async run(input) {
    console.log(`[StrategyAgent] 开始制定方案（第${input.round}轮）...`);
    const { systemPrompt, userPrompt } = buildStrategyPrompt(input);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
    const result = await this.callLLMJson(messages, { maxTokens: 6144 });
    console.log(`[StrategyAgent] 方案完成: ${result.planTitle}`);
    return result;
  }
}

module.exports = StrategyAgent;
