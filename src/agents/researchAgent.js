const BaseAgent = require('./baseAgent');
const { buildResearchPrompt } = require('../prompts/research');
const { search } = require('../services/webSearch');
const { fetchPages } = require('../services/webFetch');
const { withTimeout } = require('../utils/abortx');

// 并发抓取 Top N 页面全文
const FETCH_TOP_N = 3;
// fetchPages 整体兜底：单 URL 已有 10s 超时，但并发整体若全部慢仍会拖累。
// 超过这个时间就放弃抓取页面，靠搜索摘要继续。
const FETCH_PAGES_BUDGET_MS = 18_000;
// search 整体兜底
const SEARCH_BUDGET_MS = 15_000;

class ResearchAgent extends BaseAgent {
  constructor(agentId, apiKeys = {}) {
    super(`ResearchAgent-${agentId}`, 'minimax', apiKeys);
    this.agentId = agentId;
  }

  async run({ task, orchestratorOutput }) {
    console.log(`[${this.name}] 开始搜索: ${task.focus}`);

    const searchOptions = {
      minimaxApiKey: this.apiKeys.minimaxApiKey,
      tavilyApiKey: this.apiKeys.tavilyApiKey,
      maxResults: 5
    };

    // ── 第一步：搜索，获取结果列表 ──────────────────────────────────────
    let searchOutcome = { results: [], source: null, warning: null };
    try {
      searchOutcome = await withTimeout(
        search(task.keywords.join(' '), searchOptions),
        SEARCH_BUDGET_MS,
        `search(${task.focus})`
      );
    } catch (err) {
      console.warn(`[${this.name}] 搜索异常: ${err.message}`);
    }
    const searchResults = Array.isArray(searchOutcome.results) ? searchOutcome.results : [];

    // ── 第二步：对 Top N 结果抓取页面全文 ──────────────────────────────
    let fetchedPages = [];
    if (searchResults.length > 0) {
      const topUrls = searchResults.slice(0, FETCH_TOP_N).map(r => r.url).filter(Boolean);
      try {
        fetchedPages = await withTimeout(
          fetchPages(topUrls, {
            jinaApiKey: this.apiKeys.jinaApiKey,
            timeoutMs: 10000,
            maxLength: 2500
          }),
          FETCH_PAGES_BUDGET_MS,
          `fetchPages(${topUrls.length})`
        );
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
    result.searchSource = searchOutcome.source || null;
    if (searchOutcome.warning) {
      result.searchWarning = searchOutcome.warning;
    }
    console.log(`[${this.name}] 完成，共处理 ${searchResults.length} 条搜索结果，${fetchedPages.length} 个页面全文，来源：${searchOutcome.source || 'none'}`);
    return result;
  }
}

module.exports = ResearchAgent;
