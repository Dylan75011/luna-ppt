// 统一网页搜索服务：浏览器扩展（Bing 登录态 SERP）优先 → MiniMax/Tavily 多源 → DDG 兜底
// 级联策略说明：
//   1. 默认先 try 扩展。理由：用户登录态、IP 干净、无 API quota，且能直接打开 SERP 对应站点验证
//   2. 扩展不可用（未连/超时/0 结果/被风控）才掉到 MiniMax+Tavily 并行
//   3. 主力源都失败再用 DDG HTML 兜底
// 不让 brain 自己判断走哪条路（LLM 在"先 A 不行再 B"这种串行决策上不可靠）
const config = require('../config');
const bridge = require('./browserBridge');

const SEARCH_TIMEOUT_MS = 10000;
const BROWSER_SEARCH_TIMEOUT_MS = 15000; // 扩展开 tab + 抽 SERP 一般 5-8s，留 2x buffer

// ─── 浏览器扩展（Bing SERP，登录态/无 quota）───────────────────────────
async function searchWithBrowser(query, options = {}) {
  if (!bridge.isConnected()) {
    throw new Error('extension_not_connected');
  }
  const resp = await bridge.send(
    'browser_web_search',
    { query, max_results: options.maxResults || 10 },
    { timeoutMs: BROWSER_SEARCH_TIMEOUT_MS }
  );
  const items = Array.isArray(resp?.results) ? resp.results : [];
  return items.map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.snippet || '',
    date: r.date || '',
    displayUrl: r.displayUrl || ''
  }));
}

// ─── MiniMax Coding Plan Search（Token Plan 专属，sk-cp- key 即可用）────────

async function searchWithMinimax(query, options = {}) {
  const apiKey = options.minimaxApiKey || config.minimaxApiKey;
  if (!apiKey) throw new Error('MiniMax API Key 未配置');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.minimaxi.com/v1/coding_plan/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ q: query }),
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`MiniMax Search HTTP ${response.status}`);

    const data = await response.json();

    // 检查 API 层错误码
    const baseResp = data.base_resp || {};
    if (typeof baseResp.status_code === 'number' && baseResp.status_code !== 0) {
      throw new Error(`MiniMax Search API Error ${baseResp.status_code}: ${baseResp.status_msg}`);
    }

    const organic = data.organic || [];
    return organic.slice(0, options.maxResults || 5).map(r => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
      date: r.date || ''
    }));
  } finally {
    clearTimeout(timer);
  }
}

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
      snippet: r.content || r.snippet || '',
      date: r.published_date || r.date || ''
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
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=cn-zh`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://duckduckgo.com/',
        'Cache-Control': 'no-cache'
      },
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

  // 匹配 result__a 链接（标题+URL）
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  // 匹配 result__snippet（可能是 <a> 或 <div>）
  const snippetRe = /<(?:a|div)[^>]+class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/;

  // 按 result__body 分块，保证 title/snippet 一一对应
  const blockRe = /<div[^>]+class="[^"]*result__body[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*result__body|$)/g;

  let blockMatch;
  while ((blockMatch = blockRe.exec(html)) !== null && results.length < maxResults) {
    const block = blockMatch[1];

    const linkMatch = linkRe.exec(block);
    linkRe.lastIndex = 0; // 重置，因为每次都从头匹配 block

    if (!linkMatch) continue;

    const rawUrl = linkMatch[1];
    const titleHtml = linkMatch[2];
    const snippetMatch = snippetRe.exec(block);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : '';

    // 解码 DDG 重定向 URL
    let url = rawUrl;
    try {
      const uddg = new URL('https://duckduckgo.com' + rawUrl).searchParams.get('uddg');
      if (uddg) url = decodeURIComponent(uddg);
    } catch {
      // rawUrl 可能已经是绝对 URL
    }

    if (!url || url.startsWith('https://duckduckgo.com')) continue;

    results.push({
      title: stripTags(titleHtml),
      url,
      snippet,
      date: ''
    });
  }

  return results;
}

function stripTags(str) {
  return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").trim();
}

// ─── 结果质量评分 ────────────────────────────────────────────────────────

// 站点权重分层。约束：agent 看不了视频，所以视频为主的站点不放进 boost 列表；
// 视频"具体页"（YouTube /watch、B 站 /video、抖音 /video、Vimeo /数字）单独 -5
// 不站点级 ban —— 同站点的频道首页/wiki/文字案例不受影响
//
// S 级 (+25): 图文 UGC + 视觉灵感库，对活动策划价值最高
const DOMAIN_TIER_S = /(?:\/\/|\.)(xiaohongshu\.com|xhscdn\.com|pinterest\.com|behance\.net|dribbble\.com)(?:\/|$|\b)/i;

// A 级 (+18): 行业头部专业媒体 + 营销/活动垂类 + 创意设计 + 主流论坛/UGC 社区
const DOMAIN_TIER_A = /(?:\/\/|\.)(?:36kr\.com|huxiu\.com|jiemian\.com|latepost\.com|caixin\.com|yicai\.com|pingwest\.com|sspai\.com|guokr\.com|tmtpost\.com|weibo\.com|m\.weibo\.cn|digitaling\.com|meihua\.info|adquan\.com|top-marketing\.com|top-marketing\.cn|topdigital\.cn|socialbeta\.com|bizbash\.com|eventmarketer\.com|specialevents\.com|adweek\.com|campaignlive\.com|campaignasia\.com|adage\.com|thedrum\.com|marketingweek\.com|designboom\.com|itsnicethat\.com|creativebloq\.com|fastcompany\.com|wired\.com|techcrunch\.com|theverge\.com|arstechnica\.com|bloomberg\.com|reuters\.com|ft\.com|economist\.com|reddit\.com|v2ex\.com|okjike\.com|douban\.com|hupu\.com|tieba\.baidu\.com|stackoverflow\.com|stackexchange\.com|news\.ycombinator\.com|quora\.com)(?:\/|$|\b)/i;

// B 级 (+8): 一般可信源（综合媒体 / 百科 / 头部新闻）
const DOMAIN_TIER_B = /(?:\/\/|\.)(?:zhihu\.com\/p|wikipedia\.org|baike\.baidu\.com|medium\.com|forbes\.com|hbr\.org|nytimes\.com|washingtonpost\.com|bbc\.com|bbc\.co\.uk|cnn\.com|theguardian\.com|chinadaily\.com\.cn|xinhuanet\.com|people\.com\.cn|mp\.weixin\.qq\.com)(?:\/|$|\b)/i;

// C 级 (-12): 内容农场/低质自媒体频道（不拉黑，让排序自然下沉）
const DOMAIN_TIER_C = /(?:\/\/|\.)(?:baijiahao\.baidu\.com|360doc\.com|csdn\.net|jianshu\.com|hexun\.com|toutiao\.com|haokan\.baidu\.com|163\.com\/dy|news\.163\.com\/dy|sohu\.com\/a\/|ifeng\.com\/c\/|eastmoney\.com\/.*\/forum)(?:\/|$|\b)/i;

// 视频具体页 (-5): 这些 URL 打开 brain 也看不了内容
const VIDEO_PAGE_PATTERN = /youtube\.com\/watch\?|youtu\.be\/|bilibili\.com\/video\/|douyin\.com\/video\/|vimeo\.com\/\d+/i;

// 品牌官网/官方站点信号（启发式，无法穷举所有品牌域名）
// title 末尾的"官网/官方网站/Official Site"是最强信号
const OFFICIAL_TITLE_PATTERN = /(官网|官方网站|官方网|官方旗舰店|official\s+site|official\s+website|home\s*page)\s*$/i;
// 政府/教育/非营利 TLD（含 .cn 二级）
const OFFICIAL_TLD_PATTERN = /\.(?:gov|edu|org)(?:\.cn)?(?:\/|$|\?)/i;
// 论坛子域：bbs./forum./community. 子域，捕捉品牌自建社区（如 bbs.huawei.com）
const FORUM_SUBDOMAIN_PATTERN = /\/\/(?:bbs|forum|community|club|talk)\./i;

const SPAM_SIGNALS = /download|free|crack|porn|casino|lottery|彩票|成人|外挂|破解|刷单|兼职赚钱|快速致富/i;

function domainTierBonus(url) {
  if (!url) return 0;
  if (DOMAIN_TIER_S.test(url)) return 25;
  if (DOMAIN_TIER_A.test(url)) return 18;
  if (DOMAIN_TIER_B.test(url)) return 8;
  if (DOMAIN_TIER_C.test(url)) return -12;
  return 0;
}

// 启发式判定：这条结果是否像品牌官网/官方站点
// 信号叠加：title 标识 (+10) + hostname 含查询词且 path 短 (+8) + 官方 TLD (+6)
function officialSiteBonus(result, queryTerms) {
  let bonus = 0;
  const rawTitle = result.title || '';
  const rawUrl = result.url || '';

  if (OFFICIAL_TITLE_PATTERN.test(rawTitle)) bonus += 10;
  if (OFFICIAL_TLD_PATTERN.test(rawUrl.toLowerCase())) bonus += 6;

  // hostname 含查询词 + path 短 → 大概率品牌主页
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    const pathLen = (u.pathname + u.search).length;
    const hostHit = queryTerms.find((t) => t.length >= 3 && host.includes(t));
    if (hostHit && pathLen <= 20) bonus += 8;
  } catch {}

  return bonus;
}

// 论坛信号：bbs./forum./community. 子域 (+10)
// 已知论坛域名（reddit/v2ex/即刻/豆瓣/虎扑/贴吧/SO/HN/Quora）已在 A 级表里，这里只补未知子域
function forumSubdomainBonus(url) {
  return FORUM_SUBDOMAIN_PATTERN.test(url || '') ? 10 : 0;
}

function scoreResult(result, query) {
  let score = 0;
  const title   = (result.title   || '').toLowerCase();
  const snippet = (result.snippet || '').toLowerCase();
  const url     = (result.url     || '').toLowerCase();
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

  // 1. 标题相关性（最高 30 分）
  const titleHits = queryTerms.filter(t => title.includes(t)).length;
  score += Math.min(30, titleHits * 10);

  // 2. Snippet 相关性（最高 20 分）
  const snippetHits = queryTerms.filter(t => snippet.includes(t)).length;
  score += Math.min(20, snippetHits * 7);

  // 3. Snippet 内容质量：长度适中（最高 15 分）
  const snippetLen = snippet.length;
  if (snippetLen > 60)  score += 10;
  if (snippetLen > 120) score += 5;

  // 4. 站点权重分层（S +25 / A +18 / B +8 / C -12）
  score += domainTierBonus(url);

  // 5. 品牌官网 / 官方站点（启发式叠加：title 信号 +10 / hostname 含查询词 +8 / 官方 TLD +6）
  score += officialSiteBonus(result, queryTerms);

  // 6. 论坛子域（bbs./forum./community.）+10，主流论坛已在 A 级表
  score += forumSubdomainBonus(url);

  // 7. 视频具体页扣分（agent 看不了视频，URL 命中就降权 -5）
  if (VIDEO_PAGE_PATTERN.test(url)) score -= 5;

  // 8. 时效性（最高 10 分）
  if (result.date) {
    const year = String(result.date).match(/202[3-9]|2030/)?.[0];
    if (year) score += year >= '2025' ? 10 : year >= '2024' ? 6 : 3;
  }

  // 7. URL 质量：https、无过多参数（最高 5 分）
  if (url.startsWith('https')) score += 3;
  if ((url.match(/[?&]/g) || []).length <= 2) score += 2;

  // 8. 垃圾信号（扣分）
  if (SPAM_SIGNALS.test(title) || SPAM_SIGNALS.test(url)) score -= 30;

  return Math.max(0, score);
}

/**
 * 多源结果合并、去重、评分，返回最优 N 条
 */
function mergeAndRank(allResults, query, maxResults = 8) {
  // URL 去重（保留先出现的，同 URL 给予多源加分）
  const seen   = new Map(); // url → item
  const counts = new Map(); // url → provider count

  for (const item of allResults) {
    const key = (item.url || '').split('?')[0].replace(/\/$/, '').toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!seen.has(key)) seen.set(key, item);
  }

  const deduped = [...seen.entries()].map(([key, item]) => ({
    ...item,
    _multiSourceBonus: (counts.get(key) || 1) > 1 ? 8 : 0
  }));

  // 评分排序
  const scored = deduped.map(item => ({
    ...item,
    _score: scoreResult(item, query) + item._multiSourceBonus
  })).sort((a, b) => b._score - a._score);

  return scored.slice(0, maxResults).map(({ _score, _multiSourceBonus, source, siteName, ...rest }) => rest);
}

// ─── 统一入口：并行多源 + 质量评分 ─────────────────────────────────────

/**
 * 并行拉取多个搜索源，合并评分后返回最优结果
 * @param {string} query
 * @param {object} options  { minimaxApiKey, tavilyApiKey, maxResults }
 * @returns {Promise<{results: Array, source: string|null, warning: string|null}>}
 */
async function search(query, options = {}) {
  const maxResults = options.maxResults || 8;

  // ── Step 1：浏览器扩展（首选，登录态/无 quota/IP 干净）──
  // 触发 fallback 的硬条件：未连接 / 超时 / 抛错 / 返回 0 条
  // 不在"返回 N>0 但质量低"时 fallback——那会让两条路并跑、context 翻倍
  if (bridge.isConnected()) {
    try {
      const browserResults = await searchWithBrowser(query, { maxResults });
      if (browserResults.length > 0) {
        const ranked = mergeAndRank(
          browserResults.map((r) => ({ ...r, source: 'browser:bing' })),
          query,
          maxResults
        );
        console.log(`[webSearch] 扩展 Bing: "${query}" → ${browserResults.length} 条 → 评分后取 ${ranked.length} 条`);
        return { results: ranked, source: 'browser:bing', warning: null };
      }
      console.warn(`[webSearch] 扩展返回 0 条，掉到 API 多源`);
    } catch (err) {
      console.warn(`[webSearch] 扩展失败，掉到 API 多源: ${err.message}`);
    }
  } else {
    console.log('[webSearch] 扩展未连接，直接走 API 多源');
  }

  // ── Step 2：MiniMax + Tavily 并行 ──
  const tasks = [];
  tasks.push(
    searchWithMinimax(query, options)
      .then(r => r.map(x => ({ ...x, source: 'minimax' })))
      .catch(err => { console.warn(`[webSearch] MiniMax 失败: ${err.message}`); return []; })
  );

  if (options.tavilyApiKey || config.tavilyApiKey) {
    tasks.push(
      searchWithTavily(query, options)
        .then(r => r.map(x => ({ ...x, source: 'tavily' })))
        .catch(err => { console.warn(`[webSearch] Tavily 失败: ${err.message}`); return []; })
    );
  }

  const allResults = (await Promise.all(tasks)).flat();

  if (allResults.length > 0) {
    const ranked = mergeAndRank(allResults, query, maxResults);
    const sources = [...new Set(allResults.filter(r => r.source).map(r => r.source))];
    console.log(`[webSearch] API 多源合并: ${allResults.length} 条 → 评分后取 ${ranked.length} 条 (${sources.join('+')})`);
    return { results: ranked, source: sources.join('+'), warning: null };
  }

  // ── Step 3：DDG HTML 兜底 ──
  try {
    const results = await searchWithDDG(query, options);
    if (results.length > 0) {
      console.log(`[webSearch] DuckDuckGo 兜底: "${query}" → ${results.length} 条`);
      return { results, source: 'ddg', warning: null };
    }
  } catch (err) {
    console.warn(`[webSearch] DuckDuckGo 也失败: ${err.message}`);
  }

  return { results: [], source: null, warning: '搜索服务暂时不可用，将基于通用知识继续工作' };
}

module.exports = { search, searchWithBrowser, searchWithMinimax, searchWithTavily, searchWithDDG };
