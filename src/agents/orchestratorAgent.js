const BaseAgent = require('./baseAgent');
const { buildOrchestratorPrompt } = require('../prompts/orchestrator');

class OrchestratorAgent extends BaseAgent {
  constructor() {
    super('OrchestratorAgent', 'minimax');
  }

  async run(userInput) {
    const { systemPrompt, userPrompt } = buildOrchestratorPrompt(userInput);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
    console.log('[OrchestratorAgent] 开始解析需求...');
    const result = await this.callLLMJson(messages, { maxTokens: 2048 });
    console.log('[OrchestratorAgent] 完成，目标:', result.parsedGoal);
    return result;
  }
}

module.exports = OrchestratorAgent;
