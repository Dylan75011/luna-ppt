// 单页 schema 校验：判断一页是否能被 slideDesigner 正常渲染。
// 设计原则：宽松验证（不和具体 layout/composition 字段绑死），只挡住"渲染出来是空白"
// 或"x/y/w/h 越界导致 grid 计算炸"这两类硬伤。

const STABLE_LAYOUTS = new Set([
  'immersive_cover', 'cover',
  'toc',
  'editorial_quote',
  'data_cards',
  'asymmetrical_story',
  'split_content',
  'timeline_flow',
  'end_card',
  'bento_grid',
  'image_statement',
  'minimal_text',
]);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidPercent(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
}

function hasVisibleContent(page) {
  if (isNonEmptyString(page.title) || isNonEmptyString(page.subtitle) || isNonEmptyString(page.mainTitle)) return true;
  if (isNonEmptyString(page.body) || isNonEmptyString(page.story) || isNonEmptyString(page.quote)) return true;
  if (Array.isArray(page.textBlocks) && page.textBlocks.some(b => isNonEmptyString(b?.text) || (Array.isArray(b?.items) && b.items.length))) return true;
  for (const k of ['facts', 'metrics', 'phases', 'cards', 'items', 'points', 'leftItems', 'rightItems']) {
    if (Array.isArray(page[k]) && page[k].length) return true;
  }
  return false;
}

function validatePage(page, index = 0) {
  const errors = [];

  if (!page || typeof page !== 'object' || Array.isArray(page)) {
    return { valid: false, errors: ['page is not a non-array object'] };
  }

  // layout/type 是渲染分发的唯一入口，必须有一个且在白名单里（stabilizePages 通常会保证，
  // 但 LLM 偶尔输出 "card" / "intro" / "splitContent" 等非法值，这里拦下来）
  const layoutKey = page.layout || page.type;
  if (!isNonEmptyString(layoutKey)) {
    errors.push('missing layout/type');
  } else if (!STABLE_LAYOUTS.has(layoutKey)) {
    errors.push(`unknown layout "${layoutKey}"`);
  }

  if (!hasVisibleContent(page)) {
    errors.push('page has no visible content (no title/textBlocks/facts/...)');
  }

  if (Array.isArray(page.regions)) {
    page.regions.forEach((r, i) => {
      if (!r || typeof r !== 'object') {
        errors.push(`regions[${i}] is not an object`);
        return;
      }
      if (!isNonEmptyString(r.name)) {
        errors.push(`regions[${i}].name missing or empty`);
      }
      for (const k of ['x', 'y', 'w', 'h']) {
        if (r[k] !== undefined && !isValidPercent(r[k])) {
          errors.push(`regions[${i}].${k} not a finite number in [0,100] (got ${r[k]})`);
        }
      }
    });
  } else if (page.regions != null) {
    errors.push('regions is not an array');
  }

  if (Array.isArray(page.textBlocks)) {
    page.textBlocks.forEach((b, i) => {
      if (!b || typeof b !== 'object') {
        errors.push(`textBlocks[${i}] is not an object`);
        return;
      }
      if (!isNonEmptyString(b.kind)) {
        errors.push(`textBlocks[${i}].kind missing or empty`);
      }
      // text 或 items 至少一个，否则这个 block 渲染出来啥也没有
      if (!isNonEmptyString(b.text) && !(Array.isArray(b.items) && b.items.length)) {
        errors.push(`textBlocks[${i}] has neither text nor non-empty items`);
      }
    });
  } else if (page.textBlocks != null) {
    errors.push('textBlocks is not an array');
  }

  return { valid: errors.length === 0, errors };
}

function validatePages(pages = []) {
  if (!Array.isArray(pages)) return [{ index: -1, valid: false, errors: ['pages is not an array'] }];
  return pages.map((page, index) => ({ index, ...validatePage(page, index) }));
}

module.exports = { validatePage, validatePages, STABLE_LAYOUTS };
