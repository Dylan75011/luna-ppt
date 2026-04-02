// 统一网页搜索服务：Tavily（首选）→ DuckDuckGo（免费兜底）
const config = require('../config');

const SEARCH_TIMEOUT_MS = 10000;

// ─── Tavily ────────────────────────────────────────────────────────────────

async function searchWithTavily(query, options = {}) {
  const apiKey = options.tavilyApiKey || config.tavilyApiKey;
  if (!apiKey) throw new Error('Tavily API Key 未配置');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ query, search_depth: 'basic', max_results: options.maxResults || 5 }),
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`);

    const data = await response.json();
    return (data.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || r.snippet || ''
    }));
  } finally {
    clearTimeout(timer);
  }
}

// ─── DuckDuckGo（免费，无需 Key）─────────────────────────────────────────

async function searchWithDDG(query, options = {}) {
  const maxResults = options.maxResults || 5;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      body: `q=${encodeURIComponent(query)}&kl=cn-zh`,
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`DDG HTTP ${response.status}`);

    const html = await response.text();
    return parseDDGHtml(html, maxResults);
  } finally {
    clearTimeout(timer);
  }
}

function parseDDGHtml(html, maxResults) {
  const results = [];

  const blockRe = /<div[^>]+class="[^"]*result[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/div>/g;
  const snippetRe = /<p[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/p>/;

  let match;
  let matchCount = 0;
  while ((match = blockRe.exec(html)) !== null && matchCount < maxResults) {
    matchCount++;
    const rawUrl = match[1];
    const titleHtml = match[2];
    const snippetMatch = snippetRe.exec(match[0]);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : '';

    if (!rawUrl || rawUrl.startsWith('//duckduckgo.com') || rawUrl.startsWith('/?')) continue;

    let url = rawUrl;
    try {
      const uddg = new URL('https://x.com' + rawUrl).searchParams.get('uddg');
      if (uddg) url = decodeURIComponent(uddg);
    } catch {
    }

    results.push({
      title: stripTags(titleHtml),
      url,
      snippet
    });
  }

  return results;
}

function stripTags(str) {
  return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").trim();
}

// ─── 统一入口：自动降级 ──────────────────────────────────────────────────

/**
 * 搜索网页，自动降级：Tavily → DuckDuckGo → 空数组
 * @param {string} query
 * @param {object} options  { tavilyApiKey, maxResults }
 * @returns {Promise<{results: Array, source: string|null, warning: string|null}>}
 */
async function search(query, options = {}) {
  // 1. 尝试 Tavily
  try {
    const results = await searchWithTavily(query, options);
    if (results.length > 0) {
      console.log(`[webSearch] Tavily 搜索成功: "${query}" → ${results.length} 条`);
      return { results, source: 'tavily', warning: null };
    }
  } catch (err) {
    console.warn(`[webSearch] Tavily 失败，降级 DuckDuckGo: ${err.message}`);
  }

  // 2. 降级 DuckDuckGo
  try {
    const results = await searchWithDDG(query, options);
    if (results.length > 0) {
      console.log(`[webSearch] DuckDuckGo 搜索成功: "${query}" → ${results.length} 条`);
      return { results, source: 'ddg', warning: null };
    }
  } catch (err) {
    console.warn(`[webSearch] DuckDuckGo 也失败: ${err.message}`);
  }

  // 3. 兜底空数组
  return { results: [], source: null, warning: '搜索服务暂时不可用，将基于通用知识继续工作' };
}

module.exports = { search, searchWithTavily, searchWithDDG };
