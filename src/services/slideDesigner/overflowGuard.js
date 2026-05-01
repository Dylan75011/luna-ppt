// 文本溢出度量 + 自动重排：
// LLM/stabilize 用字符数估算文本权重，但实际渲染宽度受字体、字号、CJK/Latin 比例、
// region 实际宽度共同决定，估算总会偏。这一层在 puppeteer 渲染完、字体到位后，
// 直接量每个 .sc-region 的 scrollHeight vs clientHeight，对溢出的 region 反向
// 压缩对应 textBlocks，再渲染一次。最多一次重排，避免抖动。
//
// 只对 structured（有 .sc-region 的页）生效。legacy layout（immersive_cover / bento_grid 等）
// 没有 region 概念，靠 stabilizePages 的字符长度兜底。

const { summarizeText } = require('../../agents/pptBuilder/textProcessing');

// 540 = 设计稿高度 (CSS 像素)。region.h 是百分比，预期高度 = h% * 540。
const SLIDE_HEIGHT_PX = 540;
// region 实际渲染高度比设计高度大 30% 以上才算"撑爆"——10-20% 的自然增长是允许的。
const REGION_OVERFLOW_RATIO = 1.3;
// 即使比例不超，但如果 region 底部已经超出 slide 底部 8px+，也算溢出。
const SLIDE_BOTTOM_TOLERANCE_PX = 8;

// 在 puppeteer page 上下文里：找出所有"撑爆"或"超出 slide 底边"的 .sc-region。
// 配合 page 数据里 regions[].h 才能判 region 是否远超设计高度，所以接受第二个参数 regionsByName。
async function measureOverflowingRegions(page, regionsByName = {}) {
  return page.evaluate((cfg, regionMap) => {
    const out = [];
    const slide = document.querySelector('.slide');
    const slideRect = slide ? slide.getBoundingClientRect() : { bottom: cfg.slideHeight };
    document.querySelectorAll('.sc-region').forEach((regionEl) => {
      const name = regionEl.getAttribute('data-region') || '';
      const rect = regionEl.getBoundingClientRect();
      const actualH = rect.height;
      const designH = (regionMap[name] || 0) * cfg.slideHeight / 100;
      const ratio = designH > 0 ? actualH / designH : 0;
      const bottomOverflow = rect.bottom - slideRect.bottom;

      const ratioBust = designH > 0 && ratio > cfg.ratioThreshold;
      const bottomBust = bottomOverflow > cfg.bottomTolerance;
      if (ratioBust || bottomBust) {
        out.push({
          regionName: name,
          actualHeight: Math.round(actualH),
          designHeight: Math.round(designH),
          ratio: Number(ratio.toFixed(2)),
          bottomOverflowPx: Math.round(Math.max(0, bottomOverflow)),
          // overflowPx 用 max(超设计高度, 超 slide 底)，越大压得越狠
          overflowPx: Math.round(Math.max(actualH - designH, bottomOverflow, 0)),
        });
      }
    });
    return out;
  }, {
    slideHeight: SLIDE_HEIGHT_PX,
    ratioThreshold: REGION_OVERFLOW_RATIO,
    bottomTolerance: SLIDE_BOTTOM_TOLERANCE_PX,
  }, regionsByName);
}

// 把 page.regions 转成 { name: h_percent } 的查询表，给 measureOverflowingRegions 用。
function buildRegionHeightMap(page) {
  const map = {};
  if (!Array.isArray(page?.regions)) return map;
  for (const r of page.regions) {
    if (r?.name) map[r.name] = typeof r.h === 'number' ? r.h : parseFloat(r.h) || 0;
  }
  return map;
}

// 给一个溢出的 region，按 block.kind 不同采用不同压缩策略。
// 返回新的 textBlocks 数组（不修改原对象）。
function compressBlocksForRegion(textBlocks, regionName, overflowPx) {
  // 溢出越多压缩越狠：每 30px 加一档，上限 4 档。
  // 不封顶的话，极端 case（设计 22% region 塞了 8 长项，溢出 489px）会把 severity 算成 17，
  // 直接把 items 砍到只剩 2 条。封顶 4 让最严重 case 也只去掉 4 条，留 4 条。
  const severity = Math.min(4, Math.max(1, Math.ceil(overflowPx / 30)));

  return textBlocks.map((block) => {
    if ((block.region || 'body') !== regionName) return block;
    const next = { ...block };

    if (block.kind === 'body' || block.kind === 'subtitle' || block.kind === 'quote') {
      const text = String(next.text || '').trim();
      if (text.length > 30) {
        // 每档砍 ~20% 字数；2 档 ≈ 砍 40%
        const targetChars = Math.max(36, Math.floor(text.length * Math.pow(0.8, severity)));
        next.text = summarizeText(text, Math.floor(targetChars * 0.7));
      }
      if (typeof next.clamp === 'number') {
        next.clamp = Math.max(2, next.clamp - severity);
      }
    } else if (block.kind === 'fact-list' || block.kind === 'numbered-list') {
      const items = Array.isArray(next.items) ? next.items : [];
      // 每档砍 1 个 item（保留至少 2 条）
      const keepCount = Math.max(2, items.length - severity);
      next.items = items.slice(0, keepCount).map((item) => {
        const text = String(item || '').trim();
        if (text.length <= 40) return text;
        return summarizeText(text, Math.max(28, Math.floor(text.length * Math.pow(0.85, severity))));
      });
      if (typeof next.clamp === 'number') {
        next.clamp = Math.max(2, next.clamp - 1);
      }
    } else if (block.kind === 'stats') {
      const items = Array.isArray(next.items) ? next.items : [];
      const keepCount = Math.max(2, items.length - severity);
      next.items = items.slice(0, keepCount).map((item) => ({
        ...item,
        label: String(item?.label || '').slice(0, 28),
        sub: String(item?.sub || '').slice(0, 24),
      }));
    } else if (block.kind === 'timeline') {
      const items = Array.isArray(next.items) ? next.items : [];
      const keepCount = Math.max(2, items.length - severity);
      next.items = items.slice(0, keepCount).map((phase) => ({
        ...phase,
        tasks: Array.isArray(phase.tasks) ? phase.tasks.slice(0, Math.max(1, (phase.tasks.length || 0) - 1)) : phase.tasks,
      }));
    }
    return next;
  });
}

// 对一个 page 的 textBlocks 应用所有溢出 region 的压缩策略。
function compressPageForOverflows(page, overflows) {
  if (!Array.isArray(page?.textBlocks) || !overflows.length) return page;
  let textBlocks = page.textBlocks;
  for (const ov of overflows) {
    if (!ov.regionName) continue;
    textBlocks = compressBlocksForRegion(textBlocks, ov.regionName, ov.overflowPx);
  }
  return { ...page, textBlocks };
}

module.exports = {
  measureOverflowingRegions,
  buildRegionHeightMap,
  compressBlocksForRegion,
  compressPageForOverflows,
};
