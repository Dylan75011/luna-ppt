// Jina AI 网页全文抓取：将任意 URL 转为 Markdown 全文
// 免费使用（无 Key 时限速），有 Key 时更高速率

const FETCH_TIMEOUT_MS = 12000;
const MAX_CONTENT_LENGTH = 2500; // 单页截断，避免 Token 溢出

/**
 * 抓取单个 URL 的网页全文（Markdown 格式）
 * @param {string} url
 * @param {object} options  { jinaApiKey, timeoutMs, maxLength }
 * @returns {Promise<string|null>}  成功返回 Markdown 字符串，失败返回 null
 */
async function fetchPage(url, options = {}) {
  const { jinaApiKey, timeoutMs = FETCH_TIMEOUT_MS, maxLength = MAX_CONTENT_LENGTH } = options;

  const headers = {
    'Content-Type': 'application/json',
    'X-Return-Format': 'markdown',
    'X-Timeout': String(Math.ceil(timeoutMs / 1000))
  };

  if (jinaApiKey) {
    headers['Authorization'] = `Bearer ${jinaApiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 3000);

  try {
    const response = await fetch('https://r.jina.ai/', {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: controller.signal
    });

    if (!response.ok) {
      console.warn(`[webFetch] Jina HTTP ${response.status}: ${url}`);
      return null;
    }

    const text = await response.text();
    if (!text || !text.trim()) {
      console.warn(`[webFetch] Jina 返回空内容: ${url}`);
      return null;
    }

    // 截断过长内容
    const content = text.trim();
    if (content.length > maxLength) {
      return content.slice(0, maxLength) + '\n…（内容已截断）';
    }
    return content;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[webFetch] 超时: ${url}`);
    } else {
      console.warn(`[webFetch] 失败: ${url} — ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 并发抓取多个 URL，跳过失败项
 * @param {string[]} urls
 * @param {object} options
 * @returns {Promise<Array<{url, content}>>}  仅返回成功项
 */
async function fetchPages(urls, options = {}) {
  const tasks = urls.map(url =>
    fetchPage(url, options).then(content => ({ url, content }))
  );
  const results = await Promise.all(tasks);
  return results.filter(r => r.content !== null);
}

module.exports = { fetchPage, fetchPages };
