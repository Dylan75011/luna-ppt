const BaseAgent = require('./baseAgent');
const { buildPptBuilderPrompt, buildImageAwareRefinementPrompt } = require('../prompts/pptBuilder');
const { analyzePagesForLayout } = require('../services/imageAnalyzer');

const STABLE_LAYOUTS = new Set([
  'immersive_cover',
  'cover',
  'toc',
  'editorial_quote',
  'data_cards',
  'asymmetrical_story',
  'split_content',
  'timeline_flow',
  'end_card',
  'bento_grid'
]);

class PptBuilderAgent extends BaseAgent {
  constructor(apiKeys = {}) {
    super('PptBuilderAgent', 'minimax', apiKeys);
  }

  estimateTextWeight(text = '') {
    const value = String(text || '').trim();
    const cjkCount = (value.match(/[\u4e00-\u9fff]/g) || []).length;
    const latinCount = value.length - cjkCount;
    return cjkCount + latinCount * 0.45;
  }

  summarizeText(text = '', maxWeight = 42) {
    const value = String(text || '').trim();
    if (!value) return '';
    const clauses = value
      .split(/[。！？；]/)
      .map(part => part.trim())
      .filter(Boolean);
    if (clauses.length > 1) {
      let combined = '';
      for (const clause of clauses) {
        const candidate = combined ? `${combined}，${clause}` : clause;
        if (this.estimateTextWeight(candidate) > maxWeight) break;
        combined = candidate;
      }
      if (combined) return combined.length < value.length ? `${combined}...` : combined;
    }
    let weight = 0;
    let result = '';
    for (const char of value) {
      weight += /[\u4e00-\u9fff]/.test(char) ? 1 : 0.45;
      if (weight > maxWeight) break;
      result += char;
    }
    return result.length < value.length ? `${result.trim()}...` : value;
  }

  trimLine(text = '', maxWeight = 24) {
    const value = String(text || '').trim();
    if (!value) return '';
    return this.estimateTextWeight(value) > maxWeight ? this.summarizeText(value, maxWeight) : value;
  }

  inferPageRole(page = {}, index = 0, total = 0) {
    if (index === 0) return 'cover';
    if (total > 1 && index === total - 1) return 'closing';
    return page?.visualIntent?.role || page?.layout || page?.type || 'section';
  }

  stableLayoutForRole(role = 'section', index = 0, total = 0) {
    if (index === 0 || role === 'cover') return 'immersive_cover';
    if (total > 1 && index === total - 1) return 'end_card';
    if (role === 'toc') return 'toc';
    if (role === 'manifesto') return 'editorial_quote';
    if (role === 'highlights' || role === 'metrics') return 'data_cards';
    if (role === 'timeline') return 'timeline_flow';
    if (role === 'comparison') return 'split_content';
    return 'asymmetrical_story';
  }

  sanitizeList(items, { maxItems = 4, maxWeight = 28 } = {}) {
    return (Array.isArray(items) ? items : [])
      .map(item => this.trimLine(item, maxWeight))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  stabilizePage(page = {}, index = 0, total = 0) {
    const next = { ...page };
    const role = this.inferPageRole(next, index, total);
    const targetLayout = STABLE_LAYOUTS.has(next.layout || next.type)
      ? (next.layout || next.type)
      : this.stableLayoutForRole(role, index, total);

    next.layout = targetLayout;
    next.type = targetLayout;
    next.style = next.style || 'dark_tech';
    next.title = this.trimLine(next.title || (index === 1 && role === 'toc' ? '目录' : ''), index === 0 ? 26 : 22);
    next.subtitle = this.trimLine(next.subtitle, role === 'cover' ? 42 : 28);
    next.quote = this.trimLine(next.quote, role === 'manifesto' ? 88 : role === 'closing' ? 56 : 44);
    next.body = this.trimLine(next.body || next.story, role === 'section' ? 80 : 56);
    next.story = next.body || next.story || '';
    next.facts = this.sanitizeList(next.facts, {
      maxItems: role === 'highlights' ? 5 : role === 'section' ? 3 : 4,
      maxWeight: role === 'section' ? 34 : 30
    });
    next.leftItems = this.sanitizeList(next.leftItems, { maxItems: 4, maxWeight: 28 });
    next.rightItems = this.sanitizeList(next.rightItems, { maxItems: 4, maxWeight: 28 });
    next.metrics = (Array.isArray(next.metrics) ? next.metrics : [])
      .slice(0, role === 'highlights' ? 5 : 4)
      .map((item) => ({
        ...item,
        value: this.trimLine(item?.value, 18),
        label: this.trimLine(item?.label, 26),
        sub: this.trimLine(item?.sub, 16)
      }));
    next.phases = (Array.isArray(next.phases) ? next.phases : []).slice(0, 5).map((phase) => ({
      ...phase,
      date: this.trimLine(phase?.date, 16),
      name: this.trimLine(phase?.name, 18),
      tasks: this.sanitizeList(phase?.tasks, { maxItems: 3, maxWeight: 20 })
    }));

    if (Array.isArray(next.textBlocks)) {
      next.textBlocks = next.textBlocks.map((block) => {
        const normalized = { ...block };
        if (typeof normalized.text === 'string') {
          const maxWeight = normalized.kind === 'title'
            ? 24
            : normalized.kind === 'quote'
              ? (role === 'manifesto' ? 84 : 52)
              : normalized.kind === 'body'
                ? (role === 'section' ? 84 : 56)
                : 28;
          normalized.text = this.trimLine(normalized.text, maxWeight);
        }
        if (Array.isArray(normalized.items)) {
          normalized.items = this.sanitizeList(normalized.items, {
            maxItems: normalized.kind === 'timeline' ? 5 : role === 'highlights' ? 5 : 4,
            maxWeight: normalized.kind === 'stats' ? 18 : 28
          });
        }
        return normalized;
      }).filter(block => block.text || (Array.isArray(block.items) && block.items.length));
    }

    if (!next.visualIntent) next.visualIntent = {};
    next.visualIntent.role = role;
    return next;
  }

  stabilizePages(pages = []) {
    return pages.map((page, index) => this.stabilizePage(page, index, pages.length));
  }

  computeDynamicRegions(page = {}) {
    const role = page?.visualIntent?.role || page?.layout || 'content';
    const placement = page?.imageAnalysis?.safestTextPlacement || page?.imageStrategy?.textPlacement || 'left';
    const titleWeight = this.estimateTextWeight(page?.title || '');
    const quoteWeight = this.estimateTextWeight(page?.quote || page?.subtitle || page?.story || page?.body || '');
    const factCount = Array.isArray(page?.facts) ? page.facts.length : 0;
    const timelineCount = Array.isArray(page?.phases) ? page.phases.length : 0;
    const metricCount = Array.isArray(page?.metrics) ? page.metrics.length : 0;

    if (role === 'cover') {
      return placement === 'right'
        ? [
            { name: 'header', x: 48, y: 12, w: 36, h: titleWeight > 18 ? 24 : 20, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
            { name: 'body', x: 48, y: 46, w: 28, h: 16, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
            { name: 'rail', x: 10, y: 18, w: 22, h: Math.min(46, 22 + factCount * 6), stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
          ]
        : [
            { name: 'header', x: 7, y: 12, w: 38, h: titleWeight > 18 ? 24 : 20, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
            { name: 'body', x: 7, y: 46, w: 30, h: 16, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
            { name: 'rail', x: 64, y: 18, w: 22, h: Math.min(46, 22 + factCount * 6), stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
          ];
    }

    if (role === 'manifesto') {
      const quoteHeight = quoteWeight > 42 ? 38 : quoteWeight > 28 ? 32 : 26;
      const factsY = Math.min(54, 22 + Math.max(0, quoteHeight - 26));
      return placement === 'right'
        ? [
            { name: 'header', x: 48, y: 12, w: 24, h: 16, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
            { name: 'quote', x: 40, y: 32, w: 36, h: quoteHeight, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
            { name: 'facts', x: 10, y: factsY, w: 24, h: 20 + factCount * 6, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
          ]
        : [
            { name: 'header', x: 8, y: 12, w: 24, h: 16, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
            { name: 'quote', x: 8, y: 32, w: 38, h: quoteHeight, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
            { name: 'facts', x: 58, y: factsY, w: 28, h: 20 + factCount * 6, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
          ];
    }

    if (role === 'highlights') {
      const twoCol = factCount > 3;
      return [
        { name: 'header', x: 7, y: 10, w: 34, h: 15, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
        { name: 'facts', x: 7, y: 27, w: 84, h: twoCol ? 42 : 30, stack: twoCol ? 'grid' : 'vertical', columns: factCount >= 5 ? 3 : (twoCol ? 2 : undefined), gap: twoCol ? 20 : 14, align: 'stretch', valign: 'start' }
      ];
    }

    if (role === 'timeline') {
      const headerHeight = 13;
      const timelineHeight = Math.min(62, 28 + timelineCount * 10);
      return [
        { name: 'header', x: 7, y: 8, w: 36, h: headerHeight, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
        { name: 'timeline', x: 7, y: 23, w: 86, h: timelineHeight, stack: 'vertical', gap: 0, align: 'stretch', valign: 'stretch' }
      ];
    }

    if (role === 'metrics') {
      const rightWidth = metricCount >= 3 ? 36 : 30;
      return placement === 'right'
        ? [
            { name: 'header', x: 46, y: 10, w: 28, h: 16, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
            { name: 'left', x: 46, y: 34, w: 30, h: 34, stack: 'vertical', gap: 12, align: 'stretch', valign: 'start' },
            { name: 'right', x: 8, y: 22, w: rightWidth, h: 42, stack: 'vertical', gap: 12, align: 'stretch', valign: 'start' }
          ]
        : [
            { name: 'header', x: 8, y: 10, w: 28, h: 16, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
            { name: 'left', x: 8, y: 34, w: 30, h: 34, stack: 'vertical', gap: 12, align: 'stretch', valign: 'start' },
            { name: 'right', x: 52, y: 20, w: rightWidth, h: 42, stack: 'vertical', gap: 12, align: 'stretch', valign: 'start' }
          ];
    }

    if (role === 'comparison') {
      return [
        { name: 'header', x: 7, y: 10, w: 30, h: 12, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
        { name: 'left', x: 7, y: 22, w: 38, h: 56, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' },
        { name: 'right', x: 56, y: 22, w: 32, h: 56, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
      ];
    }

    if (role === 'closing') {
      return placement === 'right'
        ? [
            { name: 'header', x: 48, y: 12, w: 26, h: 16, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
            { name: 'quote', x: 42, y: 34, w: 34, h: 24, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
            { name: 'facts', x: 10, y: 24, w: 24, h: 18, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
          ]
        : [
            { name: 'header', x: 8, y: 12, w: 26, h: 16, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
            { name: 'quote', x: 8, y: 34, w: 34, h: 24, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
            { name: 'facts', x: 58, y: 22, w: 26, h: 18, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
          ];
    }

    if (role === 'section') {
      const headerWidth = quoteWeight > 34 ? 40 : 36;
      const railHeight = 20 + factCount * 8;
      return placement === 'right'
        ? [
            { name: 'header', x: 44, y: 12, w: headerWidth, h: 20, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
            { name: 'body', x: 44, y: 38, w: 32, h: quoteWeight > 36 ? 28 : 24, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
            { name: 'rail', x: 8, y: 18, w: 24, h: railHeight, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
          ]
        : [
            { name: 'header', x: 7, y: 12, w: headerWidth, h: 20, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
            { name: 'body', x: 7, y: 38, w: 34, h: quoteWeight > 36 ? 28 : 24, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
            { name: 'rail', x: 64, y: 18, w: 22, h: railHeight, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
          ];
    }

    return page.regions || [];
  }

  async run({ plan, userInput, docContent, imageMap = {}, onOutlineReady, onPageReady }) {
    console.log('[PptBuilderAgent] 开始生成 PPT...');
    const { systemPrompt, userPrompt } = buildPptBuilderPrompt(plan, userInput);
    let result;
    try {
      result = await this.callLLMJson(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        { maxTokens: 4096, temperature: 0.22 }
      );
    } catch (err) {
      console.warn('[PptBuilderAgent] 首轮结构化 JSON 生成失败，回退到程序化结构化版式:', err.message);
      result = this.buildStructuredFallback({ plan, userInput, docContent });
    }

    const theme = result.theme || {};
    theme.globalStyle = result.globalStyle || 'dark_tech';
    result.pages = this.stabilizePages(Array.isArray(result.pages) ? result.pages : []);
    const pages = result.pages || [];
    const total = pages.length;
    console.log(`[PptBuilderAgent] 生成完成，共 ${total} 页`);

    if (typeof onOutlineReady === 'function') {
      await onOutlineReady(result, total);
    }

    await this.refinePagesWithImages({ plan, userInput, result, imageMap });

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
    }

    console.log(`[PptBuilderAgent] 全部 ${processedPages.length} 页处理完成`);
    return {
      title: result.title || plan?.planTitle || 'PPT',
      globalStyle: result.globalStyle || 'dark_tech',
      theme: { ...theme, globalStyle: result.globalStyle },
      pages: processedPages
    };
  }

  async refinePagesWithImages({ plan, userInput, result, imageMap }) {
    const pages = Array.isArray(result?.pages) ? result.pages : [];
    if (!pages.length) return;

    // 没有任何图片时跳过二轮 LLM，避免无意义的额外调用
    const hasAnyImage = Object.keys(imageMap).some(k => {
      if (k === 'pages') return Object.keys(imageMap.pages || {}).length > 0;
      return !!imageMap[k];
    });
    if (!hasAnyImage) return;

    const pagesWithImages = pages.map((page, index) => {
      const layout = page.layout || page.type || 'bento_grid';
      const bgCategory = (layout === 'immersive_cover' || layout === 'cover') ? 'cover'
        : (layout === 'end_card' || layout === 'end') ? 'end'
        : 'content';
      const useBackground = page?.imageStrategy?.useBackground !== false;
      const pageImage = imageMap?.pages?.[index];
      const bgImagePath = useBackground
        ? (pageImage?.localPath || imageMap?.[bgCategory] || '')
        : '';

      return {
        ...page,
        bgImagePath,
      };
    });

    const imageAnalyses = await analyzePagesForLayout(pagesWithImages);
    pagesWithImages.forEach((page, index) => {
      if (imageAnalyses[index]) {
        page.imageAnalysis = imageAnalyses[index];
      }
    });

    if (!imageAnalyses.some(Boolean)) return;

    try {
      const { systemPrompt, userPrompt } = buildImageAwareRefinementPrompt({
        plan,
        userInput,
        pages: pagesWithImages,
        imageAnalyses,
      });
      const refined = await this.callLLMJson(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        { maxTokens: 4096, temperature: 0.35 }
      );
      const nextPages = Array.isArray(refined?.pages) ? refined.pages : [];
      if (!nextPages.length || nextPages.length !== pages.length) return;

      for (let i = 0; i < pages.length; i++) {
        pages[i] = {
          ...pages[i],
          ...nextPages[i],
          content: nextPages[i]?.content || pages[i].content || {},
        };
      }
      this.applyProgrammaticImageAwareLayout(pages);
      result.pages = this.stabilizePages(pages);
    } catch (err) {
      console.warn('[PptBuilderAgent] 图片感知二次排版失败，保留初版布局:', err.message);
      for (let i = 0; i < pages.length; i++) {
        pages[i].imageAnalysis = imageAnalyses[i] || undefined;
        if (pages[i].imageStrategy && imageAnalyses[i]) {
          if (!pages[i].imageStrategy.textPlacement || pages[i].imageStrategy.textPlacement === 'auto') {
            pages[i].imageStrategy.textPlacement = imageAnalyses[i].safestTextPlacement;
          }
          if (typeof pages[i].imageStrategy.overlay !== 'number') {
            pages[i].imageStrategy.overlay = imageAnalyses[i].recommendedOverlay;
          }
        }
      }
      this.applyProgrammaticImageAwareLayout(pages);
      result.pages = this.stabilizePages(pages);
    }
  }

  applyProgrammaticImageAwareLayout(pages = []) {
    for (const page of pages) {
      const analysis = page?.imageAnalysis;
      const placement = analysis?.safestTextPlacement || page?.imageStrategy?.textPlacement || 'left';
      const role = page?.visualIntent?.role || page?.layout || 'content';
      const longestFact = Math.max(0, ...((page?.facts || []).map(item => String(item || '').length)));

      if (page.imageStrategy && analysis) {
        page.imageStrategy.textPlacement = placement;
        page.imageStrategy.overlay = analysis.recommendedOverlay;
      }

      if (Array.isArray(page.textBlocks)) {
        page.textBlocks = page.textBlocks.map((block) => {
          if (block.kind === 'body' || block.kind === 'subtitle') {
            const text = String(block.text || '').trim();
            const maxChars = role === 'section' ? 148 : role === 'manifesto' ? 120 : 108;
            return {
              ...block,
              text: text.length > maxChars ? this.summarizeText(text, role === 'section' ? 132 : role === 'manifesto' ? 96 : 84) : text,
              clamp: block.kind === 'body' ? (role === 'section' ? 7 : role === 'timeline' ? 4 : 5) : block.clamp,
            };
          }
          if (block.kind === 'fact-list') {
            const compactItems = (block.items || []).map((item) => {
              const text = String(item || '').trim();
              if (text.length <= (role === 'highlights' ? 44 : role === 'comparison' ? 46 : role === 'section' ? 48 : 40)) return text;
              return this.summarizeText(
                text,
                role === 'highlights' ? 34 : role === 'comparison' ? 40 : role === 'section' ? 42 : 32
              );
            }).slice(0, role === 'highlights' ? 5 : role === 'section' ? 3 : role === 'comparison' ? 4 : 4);
            return {
              ...block,
              items: compactItems,
              variant: role === 'highlights'
                ? 'floating-tags'
                : role === 'section'
                ? (longestFact > 26 ? 'compact-notes' : 'side-notes')
                : role === 'manifesto'
                  ? (longestFact > 28 ? 'compact-notes' : 'side-notes')
                  : role === 'comparison'
                    ? 'compact-notes'
                  : 'editorial-list'
            };
          }
          if (block.kind === 'stats') {
            return {
              ...block,
              variant: block.variant || (role === 'metrics'
                ? 'ledger'
                : role === 'highlights'
                  ? 'staggered-notes'
                  : 'annotation-strip')
            };
          }
          if (block.kind === 'timeline') {
            return {
              ...block,
              variant: 'editorial-steps'
            };
          }
          return block;
        });
      }

      if (page.composition === 'hero-asymmetric') {
        page.regions = this.computeDynamicRegions(page);
      }

      if (page.composition === 'manifesto-center') {
        page.regions = placement === 'right'
          ? [
              { name: 'header', x: 50, y: 14, w: 28, h: 18, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
              { name: 'quote', x: 42, y: 38, w: 34, h: 26, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
              { name: 'facts', x: 10, y: 48, w: 22, h: 22, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
            ]
          : [
              { name: 'header', x: 8, y: 14, w: 30, h: 18, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
              { name: 'quote', x: 8, y: 40, w: 34, h: 26, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
              { name: 'facts', x: 66, y: 48, w: 20, h: 22, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
            ];
      }

      if (page.composition === 'annotation-runway') {
        page.regions = this.computeDynamicRegions(page);
      }

      if (page.composition === 'staggered-metrics') {
        page.regions = this.computeDynamicRegions(page);
      }

      if (page.composition === 'compare-columns') {
        page.regions = this.computeDynamicRegions(page);
      }

      if (page.composition === 'ledger-split') {
        page.regions = this.computeDynamicRegions(page);
      }

      if (page.composition === 'highlights-board') {
        page.regions = this.computeDynamicRegions(page);
      }

      if (role === 'timeline' && (!Array.isArray(page.regions) || !page.regions.length || page.composition === 'split-editorial')) {
        page.regions = this.computeDynamicRegions(page);
      }
    }
  }

  buildStructuredFallback({ plan, userInput }) {
    const brand = userInput?.brand || plan?.visualTheme?.brand || '品牌'
    const visualTheme = plan?.visualTheme || {}
    const imageKeywords = Array.isArray(visualTheme.imageKeywords) && visualTheme.imageKeywords.length
      ? visualTheme.imageKeywords
      : ['premium automotive launch', 'cinematic stage lighting', 'luxury technology atmosphere', 'future mobility']
    const sections = Array.isArray(plan?.sections) ? plan.sections : []
    const highlights = Array.isArray(plan?.highlights) ? plan.highlights.filter(Boolean) : []
    const phases = Array.isArray(plan?.timeline?.phases) ? plan.timeline.phases.filter(Boolean) : []
    const kpis = Array.isArray(plan?.kpis) ? plan.kpis.filter(Boolean) : []
    const budgetBreakdown = Array.isArray(plan?.budget?.breakdown) ? plan.budget.breakdown.filter(Boolean) : []
    const risks = Array.isArray(plan?.riskMitigation) ? plan.riskMitigation.filter(Boolean) : []

    const keywordSeed = imageKeywords.join(' ')
    const compositionCycle = ['editorial-left', 'split-editorial', 'annotation-runway', 'hero-asymmetric']
    const sectionPages = sections.slice(0, 6).map((section, index) => {
      const composition = compositionCycle[index % compositionCycle.length]
      const summary = String(section.narrative || '').trim()
      const compactSummary = summary.length > 84 ? `${summary.slice(0, 84).trim()}...` : summary
      const rawFacts = (section.keyPoints || []).slice(0, composition === 'hero-asymmetric' ? 3 : 4)
      const compactFacts = rawFacts.map((item) => {
        const text = String(item || '').trim()
        return text.length > 34 ? `${text.slice(0, 34).trim()}...` : text
      })
      const regionNames = composition === 'split-editorial'
        ? { lead: 'left', body: 'left', facts: 'right' }
        : composition === 'annotation-runway'
          ? { lead: 'header', body: 'quote', facts: 'facts' }
          : composition === 'hero-asymmetric'
            ? { lead: 'header', body: 'body', facts: 'rail' }
            : { lead: 'header', body: 'statement', facts: 'facts' }
      return {
        layout: 'asymmetrical_story',
        style: 'dark_tech',
        composition,
        title: section.title || `章节 ${index + 1}`,
        subtitle: compactSummary || '',
        facts: compactFacts,
        regions: composition === 'hero-asymmetric'
          ? [
              { name: 'header', x: 7, y: 12, w: 48, h: 24, stack: 'vertical', gap: 12, align: 'start', valign: 'start' },
              { name: 'body', x: 7, y: 46, w: 42, h: 24, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
              { name: 'rail', x: 68, y: 16, w: 18, h: 48, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
            ]
          : composition === 'annotation-runway'
            ? [
                { name: 'header', x: 8, y: 12, w: 36, h: 20, stack: 'vertical', gap: 12, align: 'start', valign: 'start' },
                { name: 'quote', x: 8, y: 42, w: 38, h: 22, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
                { name: 'facts', x: 58, y: 18, w: 28, h: 40, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
              ]
            : undefined,
        textBlocks: [
          { region: regionNames.lead, kind: 'eyebrow', text: `SECTION ${String(index + 1).padStart(2, '0')}` },
          { region: regionNames.lead, kind: 'title', text: section.title || `章节 ${index + 1}`, size: composition === 'hero-asymmetric' ? 38 : 42 },
          ...(compactSummary ? [{ region: regionNames.body, kind: composition === 'annotation-runway' ? 'quote' : 'body', text: compactSummary, size: composition === 'hero-asymmetric' ? 14 : 14, lineHeight: composition === 'annotation-runway' ? 1.5 : 1.7, strong: composition === 'hero-asymmetric', clamp: composition === 'hero-asymmetric' ? 5 : 6 }] : []),
          { region: regionNames.facts, kind: 'fact-list', items: compactFacts, variant: composition === 'annotation-runway' ? 'side-notes' : undefined, size: composition === 'hero-asymmetric' ? 12 : 13, lineHeight: composition === 'hero-asymmetric' ? 1.52 : 1.6, clamp: composition === 'hero-asymmetric' ? 2 : 3 }
        ],
        visualIntent: {
          role: 'section',
          mood: '坚定、专业、发布会式叙事',
          density: 'medium',
          composition,
          reason: '按章节建立连续但不重复的叙事页'
        },
        imageStrategy: {
          useBackground: true,
          query: `${brand} ${section.title || 'launch strategy'} ${keywordSeed}`.trim(),
          treatment: index % 2 === 0 ? 'editorial-fade' : 'split-atmosphere',
          overlay: index % 2 === 0 ? 0.56 : 0.48,
          focalPoint: index % 2 === 0 ? 'right-center' : 'center',
          textPlacement: composition === 'split-editorial' ? 'left' : 'left'
        }
      }
    })

    const pages = [
      {
        layout: 'immersive_cover',
        style: 'dark_tech',
        composition: 'hero-asymmetric',
        regions: [
          { name: 'header', x: 7, y: 14, w: 44, h: 34, stack: 'vertical', gap: 14, align: 'start', valign: 'start' },
          { name: 'body', x: 7, y: 68, w: 34, h: 12, stack: 'vertical', gap: 8, align: 'start', valign: 'end' },
          { name: 'rail', x: 73, y: 14, w: 14, h: 46, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' }
        ],
        title: plan?.planTitle || `${brand} 发布会活动策划方案`,
        subtitle: plan?.coreStrategy || `${brand} 新品发布会整体提案`,
        brand,
        date: plan?.timeline?.eventDate || '2026',
        location: 'Launch Proposal',
        textBlocks: [
          { region: 'header', kind: 'eyebrow', text: brand },
          { region: 'header', kind: 'title', text: plan?.planTitle || `${brand} 新品发布会活动策划方案`, size: 42 },
          { region: 'header', kind: 'subtitle', text: plan?.coreStrategy || '以发布会叙事承接技术实力、品牌高度与市场预热', size: 14, lineHeight: 1.75 },
          { region: 'body', kind: 'body', text: '让产品发布、品牌气质与传播引爆在同一条叙事线上完成闭环。', size: 13, lineHeight: 1.7 },
          { region: 'rail', kind: 'fact-list', items: highlights.slice(0, 3) }
        ],
        visualIntent: {
          role: 'cover',
          mood: '高端、克制、沉浸',
          density: 'airy',
          composition: 'left-weighted',
          reason: '用更像发布会 KV 的封面定调'
        },
        imageStrategy: {
          useBackground: true,
          query: `${brand} flagship launch cinematic key visual ${keywordSeed}`.trim(),
          treatment: 'full-bleed-dark',
          overlay: 0.42,
          focalPoint: 'right-center',
          textPlacement: 'left'
        }
      },
      {
        layout: 'toc',
        style: 'dark_tech',
        composition: 'split-editorial',
        title: '目录',
        textBlocks: [
          { region: 'left', kind: 'eyebrow', text: 'CONTENTS' },
          { region: 'left', kind: 'title', text: '目录' },
          { region: 'right', kind: 'fact-list', items: sections.slice(0, 6).map(item => item.title || '章节') }
        ],
        visualIntent: {
          role: 'toc',
          mood: '清晰、简洁、建立结构',
          density: 'medium',
          composition: 'sidebar',
          reason: '让后续内容节奏更有组织'
        },
        imageStrategy: {
          useBackground: false,
          query: '',
          treatment: 'none',
          overlay: 0,
          focalPoint: 'center',
          textPlacement: 'left'
        }
      },
      {
        layout: 'editorial_quote',
        style: 'dark_tech',
        composition: 'annotation-runway',
        regions: [
          { name: 'header', x: 8, y: 12, w: 28, h: 18, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
          { name: 'quote', x: 8, y: 40, w: 36, h: 26, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
          { name: 'facts', x: 58, y: 18, w: 28, h: 42, stack: 'vertical', gap: 12, align: 'stretch', valign: 'start' }
        ],
        title: '核心策略',
        subtitle: plan?.coreStrategy || '以高端智能叙事统领发布会表达',
        quote: plan?.coreStrategy || '用一场有仪式感的发布会，把产品实力翻译成时代性品牌语言。',
        facts: highlights.slice(0, 3),
        textBlocks: [
          { region: 'header', kind: 'eyebrow', text: 'STRATEGY' },
          { region: 'header', kind: 'title', text: '核心策略', size: 34 },
          { region: 'quote', kind: 'quote', text: plan?.coreStrategy || '用一场有仪式感的发布会，把产品实力翻译成时代性品牌语言。', size: 24, lineHeight: 1.42, clamp: 4 },
          { region: 'facts', kind: 'fact-list', items: highlights.slice(0, 3), variant: 'side-notes' }
        ],
        visualIntent: {
          role: 'manifesto',
          mood: '宣言感、克制、有压迫感',
          density: 'airy',
          composition: 'editorial',
          reason: '把方案中心命题立住'
        },
        imageStrategy: {
          useBackground: true,
          query: `${brand} premium keynote atmosphere ${keywordSeed}`.trim(),
          treatment: 'editorial-fade',
          overlay: 0.52,
          focalPoint: 'right-center',
          textPlacement: 'left'
        }
      },
      {
        layout: 'data_cards',
        style: 'dark_tech',
        composition: 'highlights-board',
        title: '活动亮点总览',
        metrics: highlights.slice(0, 6).map((item, index) => ({
          value: String(index + 1).padStart(2, '0'),
          label: item,
          sub: 'Key Highlight'
        })),
        textBlocks: [
          { region: 'header', kind: 'eyebrow', text: 'HIGHLIGHTS' },
          { region: 'header', kind: 'title', text: '活动亮点总览' },
          { region: 'facts', kind: 'fact-list', variant: 'floating-tags', items: highlights.slice(0, 5) }
        ],
        visualIntent: {
          role: 'highlights',
          mood: '有秩序但不平庸',
          density: 'medium',
          composition: 'mosaic',
          reason: '把亮点变成一面有层次的战报墙'
        },
        imageStrategy: {
          useBackground: true,
          query: `${brand} premium texture lighting ${keywordSeed}`.trim(),
          treatment: 'subtle-grid',
          overlay: 0.8,
          focalPoint: 'center',
          textPlacement: 'left'
        }
      },
      ...sectionPages,
      ...(phases.length ? [{
        layout: 'timeline_flow',
        style: 'dark_tech',
        composition: 'split-editorial',
        regions: [
          { name: 'header', x: 7, y: 9, w: 36, h: 16, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
          { name: 'timeline', x: 7, y: 28, w: 86, h: 54, stack: 'vertical', gap: 0, align: 'stretch', valign: 'stretch' }
        ],
        title: '执行时间线',
        subtitle: '从预热、发布到转化的完整节奏推进',
        phases: phases.slice(0, 5).map((phase) => ({
          date: phase.duration || '',
          name: phase.phase || '',
          tasks: [phase.milestone || '关键里程碑']
        })),
        textBlocks: [
          { region: 'header', kind: 'eyebrow', text: 'TIMELINE' },
          { region: 'header', kind: 'title', text: '执行时间线', size: 30 },
          { region: 'header', kind: 'subtitle', text: '从预热、发布到转化的完整节奏推进', size: 13, lineHeight: 1.6 },
          { region: 'timeline', kind: 'timeline', items: phases.slice(0, 5).map((phase) => ({
            date: phase.duration || '',
            name: phase.phase || '',
            tasks: [phase.milestone || '关键里程碑']
          })) }
        ],
        visualIntent: {
          role: 'timeline',
          mood: '推进感明确、执行感强',
          density: 'medium',
          composition: 'flow',
          reason: '把筹备到传播的节奏打清楚'
        },
        imageStrategy: {
          useBackground: true,
          query: `${brand} motion path stage lighting future ${keywordSeed}`.trim(),
          treatment: 'dim-atmosphere',
          overlay: 0.74,
          focalPoint: 'center',
          textPlacement: 'center'
        }
      }] : []),
      ...((budgetBreakdown.length || kpis.length) ? [{
        layout: 'data_cards',
        style: 'dark_tech',
        composition: 'ledger-split',
        title: '预算与目标',
        textBlocks: [
          { region: 'header', kind: 'eyebrow', text: 'BUDGET & KPI' },
          { region: 'header', kind: 'title', text: '预算与目标' },
          { region: 'left', kind: 'stats', variant: 'ledger', items: budgetBreakdown.slice(0, 3).map(item => ({ value: item.amount || '', label: item.item || '', sub: item.percentage || '' })) },
          { region: 'right', kind: 'stats', variant: 'annotation-strip', items: kpis.slice(0, 3).map(item => ({ value: item.target || '', label: item.metric || '', sub: 'Target' })) }
        ],
        metrics: [
          ...(budgetBreakdown.slice(0, 3).map(item => ({ value: item.amount || '', label: item.item || '', sub: item.percentage || '' }))),
          ...(kpis.slice(0, 3).map(item => ({ value: item.target || '', label: item.metric || '', sub: 'Target' })))
        ],
        visualIntent: {
          role: 'metrics',
          mood: '理性、可信、结果导向',
          density: 'compact',
          composition: 'stat-grid',
          reason: '把投入与成果预期并列呈现'
        },
        imageStrategy: {
          useBackground: true,
          query: `${brand} data mesh subtle luxury background ${keywordSeed}`.trim(),
          treatment: 'subtle-grid',
          overlay: 0.86,
          focalPoint: 'center',
          textPlacement: 'left'
        }
      }] : []),
        ...(risks.length ? [{
        layout: 'split_content',
        style: 'dark_tech',
        composition: 'compare-columns',
        title: '风险与应对',
        leftTitle: '关键风险',
        leftItems: risks.slice(0, 4),
        rightTitle: '应对原则',
        rightItems: [
          '提前彩排与多套技术备份',
          '舆情监控与现场应急机制',
          '媒体、嘉宾与用户动线分流',
          '线上线下联动保持信息一致'
        ],
        textBlocks: [
          { region: 'header', kind: 'eyebrow', text: 'RISK CONTROL' },
          { region: 'header', kind: 'title', text: '风险与应对' },
          { region: 'left', kind: 'fact-list', title: '关键风险', variant: 'compact-notes', size: 11, clamp: 2, items: risks.slice(0, 4) },
          { region: 'right', kind: 'fact-list', title: '应对原则', variant: 'editorial-list', items: [
            '提前彩排与多套技术备份',
            '舆情监控与现场应急机制',
            '媒体、嘉宾与用户动线分流',
            '线上线下联动保持信息一致'
          ], size: 11, clamp: 2 }
        ],
        visualIntent: {
          role: 'comparison',
          mood: '冷静、专业、可执行',
          density: 'medium',
          composition: 'split',
          reason: '让方案看起来像真正可落地的项目管理'
        },
        imageStrategy: {
          useBackground: true,
          query: `${brand} control room stage operations ${keywordSeed}`.trim(),
          treatment: 'dark-paneled',
          overlay: 0.82,
          focalPoint: 'center',
          textPlacement: 'split'
        }
      }] : []),
      {
        layout: 'end_card',
        style: 'dark_tech',
        composition: 'annotation-runway',
        title: '谢谢观看',
        subtitle: `${brand} 新品发布会活动策划提案`,
        quote: '让一次发布，不止完成产品亮相，更完成品牌高度的再确认。',
        facts: [plan?.timeline?.eventDate || '2026', userInput?.goal || '新品发布与品牌提升'],
        textBlocks: [
          { region: 'header', kind: 'eyebrow', text: brand },
          { region: 'header', kind: 'title', text: '谢谢观看' },
          { region: 'quote', kind: 'quote', text: '让一次发布，不止完成产品亮相，更完成品牌高度的再确认。' },
          { region: 'facts', kind: 'fact-list', variant: 'quiet-lines', items: [plan?.timeline?.eventDate || '2026', userInput?.goal || '新品发布与品牌提升'] }
        ],
        visualIntent: {
          role: 'closing',
          mood: '收束、沉稳、余韵',
          density: 'airy',
          composition: 'centered-close',
          reason: '用简洁结束页收住整份提案'
        },
        imageStrategy: {
          useBackground: true,
          query: `${brand} night skyline premium finale ${keywordSeed}`.trim(),
          treatment: 'quiet-finale',
          overlay: 0.58,
          focalPoint: 'center',
          textPlacement: 'left'
        }
      }
    ]

    return {
      globalStyle: 'dark_tech',
      title: plan?.planTitle || `${brand} PPT`,
      theme: {
        primary: (userInput?.brandColor || '1A1A1A').replace('#', ''),
        secondary: 'C6A86A',
        brand
      },
      pages
    }
  }
}

module.exports = PptBuilderAgent;
