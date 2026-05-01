const BaseAgent = require('../baseAgent');
const { buildPptBuilderPrompt } = require('../../prompts/pptBuilder');
const { stabilizePages } = require('./pageStabilizer');
const { refinePagesWithImages } = require('./imageRefinement');
const { buildStructuredFallback } = require('./fallbackBuilder');
const { validatePage } = require('./schema');

// 单页 LLM 修复：只针对失败的那一页发一个小请求，避免再次出 16k tokens。
// prompt 显式列出 schema 错误，并把页面在整套 PPT 中的位置/角色喂给 LLM，让它知道
// 修出来的页要承接什么。
async function repairSinglePage({ badPage, index, total, errors, plan, userInput }, agent) {
  const planSummary = {
    title: plan?.planTitle || '',
    coreStrategy: plan?.coreStrategy || '',
    sectionTitles: Array.isArray(plan?.sections) ? plan.sections.map(s => s?.title).filter(Boolean).slice(0, 12) : [],
  };
  const messages = [
    {
      role: 'system',
      content: `你是 PPT 单页修复器。给定一页有问题的 JSON，输出修复后的同一页 JSON。
- 保持 layout/style/composition 不变（除非 layout 不在白名单内）
- 不要扩展页数，不要返回数组，只输出这一页
- 输出必须是合法 JSON 对象`
    },
    {
      role: 'user',
      content: `页面位置：第 ${index + 1} / ${total} 页
schema 错误：
${errors.map(e => `- ${e}`).join('\n')}

策划方案上下文（节选）：
${JSON.stringify(planSummary, null, 2)}

需要修复的原始页 JSON：
${JSON.stringify(badPage, null, 2)}

请输出修复后的整页 JSON（顶层就是 page 对象，包含 layout/style/title/textBlocks/regions 等字段）。
不要输出 markdown 代码围栏，只输出 JSON。`
    }
  ];
  return agent.callLLMJson(messages, { maxTokens: 2200, temperature: 0.18 });
}

// 取与坏页同 layout / 相邻 index 的 fallback 页作为最后兜底。
function pickFallbackPageForBadIndex(plan, userInput, index, badPage) {
  const fb = buildStructuredFallback({ plan, userInput });
  const targetLayout = badPage?.layout || badPage?.type || '';
  const sameLayout = fb.pages.find(p => (p.layout || p.type) === targetLayout);
  if (sameLayout) return sameLayout;
  return fb.pages[Math.min(index, fb.pages.length - 1)] || fb.pages[0];
}

// 对一组 stabilized 后的 pages 做逐页校验，对失败页做单页修复 → 单页 fallback。
// 返回：{ pages: 修后的 pages, repaired: 哪些 index 走了修复, fallbacked: 哪些 index 走了 fallback }
async function validateAndRepairPages({ pages, plan, userInput }, agent) {
  const repaired = [];
  const fallbacked = [];
  const total = pages.length;

  for (let i = 0; i < total; i++) {
    const initial = validatePage(pages[i], i);
    if (initial.valid) continue;

    console.warn(`[PptBuilderAgent] 第 ${i + 1} 页 schema 错误，尝试单页修复:`, initial.errors.join('; '));

    let recovered = null;
    try {
      const repairedPage = await repairSinglePage(
        { badPage: pages[i], index: i, total, errors: initial.errors, plan, userInput },
        agent
      );
      // 修复返回的可能是 { layout, ... } 也可能被 LLM 包了一层 { page: {...} }
      const candidate = repairedPage?.page && typeof repairedPage.page === 'object' ? repairedPage.page : repairedPage;
      const v = validatePage(candidate, i);
      if (v.valid) {
        recovered = candidate;
        repaired.push(i);
      } else {
        console.warn(`[PptBuilderAgent] 第 ${i + 1} 页修复后仍不合规:`, v.errors.join('; '));
      }
    } catch (err) {
      console.warn(`[PptBuilderAgent] 第 ${i + 1} 页修复 LLM 调用失败:`, err.message);
    }

    if (recovered) {
      pages[i] = recovered;
    } else {
      pages[i] = pickFallbackPageForBadIndex(plan, userInput, i, pages[i]);
      fallbacked.push(i);
    }
  }

  return { pages, repaired, fallbacked };
}

class PptBuilderAgent extends BaseAgent {
  constructor(apiKeys = {}) {
    super('PptBuilderAgent', 'minimax', apiKeys);
  }

  async run({ plan, userInput, docContent, imageMap = {}, onOutlineReady, onPageReady }) {
    console.log('[PptBuilderAgent] 开始生成 PPT...');
    const { systemPrompt, userPrompt } = buildPptBuilderPrompt(plan, userInput);
    let result;
    try {
      result = await this.callLLMJson(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        { maxTokens: 16000, temperature: 0.22 }
      );
    } catch (err) {
      console.warn('[PptBuilderAgent] 首轮结构化 JSON 生成失败，回退到程序化结构化版式:', err.message);
      result = buildStructuredFallback({ plan, userInput, docContent }, this);
    }

    const theme = result.theme || {};
    theme.globalStyle = result.globalStyle || 'dark_tech';
    result.pages = stabilizePages(Array.isArray(result.pages) ? result.pages : []);

    // 逐页 schema 校验：失败的页做单页修复，再失败用同 layout 的 fallback 页替换那一页。
    // 关键：不会因为某一页坏了就把整个 LLM 输出推翻 → 大多数好页保留下来。
    const { repaired, fallbacked } = await validateAndRepairPages(
      { pages: result.pages, plan, userInput },
      this
    );
    if (repaired.length || fallbacked.length) {
      // 修复/兜底的页可能引入了 fallback 才有的字段（regions 等），再 stabilize 一遍统一。
      result.pages = stabilizePages(result.pages);
      console.log(`[PptBuilderAgent] 单页修复 ${repaired.length} 页, fallback 替换 ${fallbacked.length} 页`);
    }
    const pages = result.pages || [];
    const total = pages.length;
    console.log(`[PptBuilderAgent] 生成完成，共 ${total} 页`);

    if (typeof onOutlineReady === 'function') {
      await onOutlineReady(result, total);
    }

    await refinePagesWithImages({ plan, userInput, result, imageMap }, this);

    const processedPages = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const layout = page.layout || page.type || 'bento_grid';
      const style = page.style || result.globalStyle || 'dark_tech';

      console.log(`[PptBuilderAgent] 处理第 ${i + 1}/${total} 页：${layout}`);

      // 注入背景图
      const bgCategory = (layout === 'immersive_cover' || layout === 'cover') ? 'cover'
        : (layout === 'end_card' || layout === 'end') ? 'end'
        : 'content';
      const pageImage = imageMap?.pages?.[i];
      const useBackground = page?.imageStrategy?.useBackground !== false;
      if (useBackground && pageImage?.localPath) {
        page.bgImagePath = pageImage.localPath;
        if (pageImage?.insertMode && page?.imagePlacement) {
          page.imagePlacement = { ...page.imagePlacement, mode: pageImage.insertMode };
        }
        page.imageMeta = {
          query: pageImage.query || '',
          treatment: pageImage.treatment || '',
          source: pageImage.source || '',
          sceneType: pageImage.sceneType || '',
          assetType: pageImage.assetType || '',
          insertMode: pageImage.insertMode || ''
        };
      } else if (useBackground && imageMap[bgCategory]) {
        page.bgImagePath = imageMap[bgCategory];
      } else {
        delete page.bgImagePath;
        delete page.imageMeta;
      }

      // 兼容旧渲染器：同时设置 type，确保无 layout 字段时也能渲染
      page.type = layout;

      processedPages.push(page);

      if (typeof onPageReady === 'function') {
        onPageReady(page, i, total, theme);
      }
      // 让事件循环有机会将 SSE 事件真正发出，实现逐页流式预览
      await new Promise(r => setImmediate(r));
    }

    console.log(`[PptBuilderAgent] 全部 ${processedPages.length} 页处理完成`);
    return {
      title: result.title || plan?.planTitle || 'PPT',
      globalStyle: result.globalStyle || 'dark_tech',
      theme: { ...theme, globalStyle: result.globalStyle },
      pages: processedPages
    };
  }
}

module.exports = PptBuilderAgent;
