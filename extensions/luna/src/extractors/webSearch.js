// 通用网页搜索：以用户登录态在 Bing 跑 SERP，抽 title/url/snippet
// 默认走 cn.bing.com（国内可达 + 国际版 fallback），结构和反爬都比 Google 友好
// executeScript 序列化函数体，所有 helper 写在内部（同 readPage.js / xiaohongshu.js）

import { waitForTabComplete } from '../lib/tabManager.js';

function pageExtractBing() {
  function clean(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  // Bing SERP 结构：每条结果是 li.b_algo（中文/国际版一致）
  // 国际版有时也用 .b_algoBigWiki / .b_ans。这里只收 .b_algo（自然结果），跳过广告/知识图谱/相关搜索
  const items = [];
  const nodes = document.querySelectorAll('li.b_algo, ol#b_results > li.b_algo');
  for (const li of nodes) {
    const h2a = li.querySelector('h2 a[href]');
    if (!h2a) continue;
    const url = h2a.getAttribute('href');
    if (!url || !/^https?:\/\//i.test(url)) continue;

    const title = clean(h2a.innerText || h2a.textContent);
    // snippet 优先 .b_caption p，fallback 到 li 自身全文
    const snippetEl = li.querySelector('.b_caption p, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4');
    const snippet = clean(snippetEl?.innerText || snippetEl?.textContent || '');
    // displayUrl 给 brain 一眼看出来源
    const citeEl = li.querySelector('cite');
    const displayUrl = clean(citeEl?.innerText || '');
    // 日期：Bing 有些结果会在 snippet 前置 "2024-3-5 · "
    const dateMatch = snippet.match(/^(20\d{2}[-/年]\d{1,2}[-/月]\d{1,2})\b/);
    const date = dateMatch ? dateMatch[1] : '';

    items.push({ title, url, snippet, displayUrl, date });
    if (items.length >= 30) break; // 单页上限，太多没意义
  }

  // 检测验证码 / 风控页面（无 .b_algo 但 body 含特定关键词）
  let blocked = false;
  if (items.length === 0) {
    const bodyText = (document.body?.innerText || '').toLowerCase();
    if (/verify you are human|verifying you are human|are you a robot|captcha|enable javascript|请输入验证码/.test(bodyText)) {
      blocked = true;
    }
  }

  return {
    items,
    blocked,
    title: document.title || '',
    url: location.href
  };
}

export async function searchBing(query, maxResults = 10) {
  if (!query || typeof query !== 'string') throw new Error('query empty');
  const q = encodeURIComponent(query.trim());
  // 优先国际版（结果质量好且抽取结构稳定），cn.bing.com 当 fallback
  // mkt 参数让国际版返回中文结果
  const candidates = [
    `https://www.bing.com/search?q=${q}&mkt=zh-CN&setlang=zh-CN`,
    `https://cn.bing.com/search?q=${q}&mkt=zh-CN&setlang=zh-CN`
  ];

  let lastErr;
  for (const url of candidates) {
    const tab = await chrome.tabs.create({ url, active: false });
    try {
      await waitForTabComplete(tab.id, 15000);
      // SERP 列表是同步渲染的，但中文版有时会有 SPA 二次刷新；等 800ms 让 DOM 稳定
      await new Promise((r) => setTimeout(r, 800));
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: pageExtractBing
      });

      if (!result) {
        lastErr = new Error('executeScript 无返回');
        continue;
      }
      if (result.blocked) {
        lastErr = new Error('SERP 被风控/验证码拦截');
        continue;
      }
      if (!Array.isArray(result.items) || result.items.length === 0) {
        lastErr = new Error('SERP 结构未匹配（页面可能改版或被 redirect）');
        continue;
      }

      const trimmed = result.items.slice(0, maxResults).map((it) => ({
        title: it.title || '',
        url: it.url || '',
        snippet: it.snippet || '',
        displayUrl: it.displayUrl || '',
        date: it.date || ''
      }));
      return { results: trimmed, engine: url.includes('cn.bing') ? 'bing-cn' : 'bing' };
    } catch (err) {
      lastErr = err;
    } finally {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
  }

  throw new Error(`Bing 搜索失败：${lastErr?.message || '未知原因'}`);
}
