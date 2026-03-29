const BaseAgent = require('./baseAgent');
const { buildResearchPrompt } = require('../prompts/research');
const { searchWithTavily } = require('../services/aiAssistant');

class ResearchAgent extends BaseAgent {
  constructor(agentId) {
    super(`ResearchAgent-${agentId}`, 'minimax');
    this.agentId = agentId;
  }

  async run({ task, orchestratorOutput }) {
    console.log(`[${this.name}] 开始搜索: ${task.focus}`);

    // 搜索素材
    let searchResults = '（搜索结果为空，请基于行业知识生成内容）';
    try {
      const results = await searchWithTavily(task.keywords.join(' '));
      if (results && results.length > 0) {
        searchResults = results.map((r, i) =>
          `[${i + 1}] ${r.title || ''}\n${r.content || r.snippet || ''}`
        ).join('\n\n');
      }
    } catch (err) {
      console.warn(`[${this.name}] Tavily 搜索失败，使用模型知识:`, err.message);
    }

    const { systemPrompt, userPrompt } = buildResearchPrompt(task, orchestratorOutput);
    const finalUserPrompt = userPrompt.replace('{{SEARCH_RESULTS}}', searchResults);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: finalUserPrompt }
    ];

    const result = await this.callLLMJson(messages, { maxTokens: 2048 });
    result.focus = task.focus;
    console.log(`[${this.name}] 完成搜索`);
    return result;
  }
}

module.exports = ResearchAgent;
