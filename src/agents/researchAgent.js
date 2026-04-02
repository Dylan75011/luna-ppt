const BaseAgent = require('./baseAgent');
const { buildResearchPrompt } = require('../prompts/research');
const { search } = require('../services/webSearch');
const { fetchPages } = require('../services/webFetch');

// 并发抓取 Top N 页面全文
const FETCH_TOP_N = 3;

class ResearchAgent extends BaseAgent {
  constructor(agentId) {
    super(`ResearchAgent-${agentId}`, 'minimax');
    this.agentId = agentId;
  }

  async run({ task, orchestratorOutput }) {
    console.log(`[${this.name}] 开始搜索: ${task.focus}`);

    const searchOptions = {
      tavilyApiKey: this.apiKeys.tavilyApiKey,
      maxResults: 5
    };

    // ── 第一步：搜索，获取结果列表 ──────────────────────────────────────
    let searchResults = [];
    try {
      searchResults = await search(task.keywords.join(' '), searchOptions);
    } catch (err) {
      console.warn(`[${this.name}] 搜索异常: ${err.message}`);
    }

    // ── 第二步：对 Top N 结果抓取页面全文 ──────────────────────────────
    let fetchedPages = [];
    if (searchResults.length > 0) {
      const topUrls = searchResults.slice(0, FETCH_TOP_N).map(r => r.url).filter(Boolean);
      try {
        fetchedPages = await fetchPages(topUrls, {
          jinaApiKey: this.apiKeys.jinaApiKey,
          timeoutMs: 10000,
          maxLength: 2500
        });
        console.log(`[${this.name}] 抓取页面 ${fetchedPages.length}/${topUrls.length} 成功`);
      } catch (err) {
        console.warn(`[${this.name}] 页面抓取异常: ${err.message}`);
      }
    }

    // ── 第三步：拼接搜索摘要与页面全文 ────────────────────────────────
    const searchSummary = searchResults.length > 0
      ? searchResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`).join('\n\n')
      : '（搜索结果为空，请基于行业知识生成内容）';

    const pageContents = fetchedPages.length > 0
      ? fetchedPages.map((p, i) => `【页面${i + 1}全文】来源：${p.url}\n${p.content}`).join('\n\n---\n\n')
      : '';

    // ── 第四步：注入提示词并调用 LLM ──────────────────────────────────
    const { systemPrompt, userPrompt } = buildResearchPrompt(task, orchestratorOutput);
    const finalUserPrompt = userPrompt
      .replace('{{SEARCH_RESULTS}}', searchSummary)
      .replace('{{PAGE_CONTENTS}}', pageContents || '（未能获取页面全文）');

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: finalUserPrompt }
    ];

    const result = await this.callLLMJson(messages, { maxTokens: 2048 });
    result.focus = task.focus;
    console.log(`[${this.name}] 完成，共处理 ${searchResults.length} 条搜索结果，${fetchedPages.length} 个页面全文`);
    return result;
  }
}

module.exports = ResearchAgent;
