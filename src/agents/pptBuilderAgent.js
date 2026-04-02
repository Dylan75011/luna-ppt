const BaseAgent = require('./baseAgent');
const { buildPptBuilderPrompt, buildImageAwareRefinementPrompt } = require('../prompts/pptBuilder');
const { analyzePagesForLayout } = require('../services/imageAnalyzer');

class PptBuilderAgent extends BaseAgent {
  constructor() {
    super('PptBuilderAgent', 'minimax');
  }

  async run({ plan, userInput, docContent, imageMap = {}, onOutlineReady, onPageReady }) {
    console.log('[PptBuilderAgent] 开始生成 PPT...');
    const { systemPrompt, userPrompt } = buildPptBuilderPrompt(plan, userInput);
    const result = await this.callLLMJson(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      { maxTokens: 4096, temperature: 0.4 }
    );

    const theme = result.theme || {};
    theme.globalStyle = result.globalStyle || 'dark_tech';
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
        page.imageMeta = {
          query: pageImage.query || '',
          treatment: pageImage.treatment || '',
          source: pageImage.source || ''
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
      result.pages = pages;
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
    }
  }
}

module.exports = PptBuilderAgent;
