const BaseAgent = require('./baseAgent');
const { searchPexels, generateMiniMaxImage, downloadImage, processImageForPpt } = require('../services/imageSearch');
const { analyzeImageForLayout, colorDistance } = require('../services/imageAnalyzer');
const config = require('../config');
const path   = require('path');

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'page';
}

class ImageAgent extends BaseAgent {
  constructor() {
    super('ImageAgent', 'minimax');
  }

  /**
   * @param {{ plan, userInput, taskId, pptOutline }} input
   * @returns {Promise<{ cover: Candidate[], content: Candidate[], end: Candidate[], pages: object[] }>}
   */
  async run({ plan, userInput, taskId = `img_${Date.now()}`, pptOutline = null }) {
    console.log('[ImageAgent] 开始搜索配图...');

    // ─── Step 1: 确定视觉风格方向 ────────────────────────────────
    // 优先使用策划方案里 AI 已生成的 visualTheme，减少一次 LLM 调用
    let styleAnalysis = {};
    const planVisualTheme = plan?.visualTheme;

    if (planVisualTheme && planVisualTheme.imageKeywords?.length) {
      console.log('[ImageAgent] 使用方案 visualTheme:', planVisualTheme);
      styleAnalysis = {
        visualPersonality: planVisualTheme.style || '科技感+电影质感',
        colorPalette: planVisualTheme.colorMood || '深蓝+光效',
        styleKeywords: planVisualTheme.imageKeywords,
        styleDescription: planVisualTheme.imageKeywords.join(' ')
      };
    } else {
      // 回退：让 LLM 从方案内容推断视觉风格
      const styleAnalysisMessages = [
        {
          role: 'system',
          content: `你是一位资深视觉策划专家，负责为PPT确定整体视觉风格和图片调性。
图片风格要全局一致，不要和具体内容绑定太死（"芯片发布会"→"科技感+高端感"，而非找芯片图）。`
        },
        {
          role: 'user',
          content: `请分析以下策划方案，确定视觉风格方向：

品牌：${userInput.brand}  活动类型：${userInput.eventType}  主题：${userInput.topic}
用户风格偏好：${userInput.style || '未指定'}
方案标题：${plan?.planTitle || ''}
核心策略：${plan?.coreStrategy || ''}
高亮亮点：${(plan?.highlights || []).join('；')}

请输出 JSON：
{
  "visualPersonality": "视觉人格描述（1句话）",
  "colorPalette": "色彩基调",
  "styleKeywords": ["英文风格词1", "英文风格词2", "英文风格词3"],
  "styleDescription": "英文风格描述（3-5个词，用于图片搜索）"
}`
        }
      ];
      try {
        styleAnalysis = await this.callLLMJson(styleAnalysisMessages, { maxTokens: 512, temperature: 0.5 });
        console.log('[ImageAgent] 视觉风格分析（推断）:', styleAnalysis);
      } catch (e) {
        console.warn('[ImageAgent] 风格分析失败，使用默认风格:', e.message);
        styleAnalysis = {
          visualPersonality: '科技感+电影质感',
          colorPalette: '深蓝+光效',
          styleKeywords: ['tech', 'dark', 'elegant', 'cinematic'],
          styleDescription: 'dark technology cinematic atmosphere'
        };
      }
    }

    // ─── Step 2: 基于视觉风格，为每类页面生成搜索词 ───────────────
    const { styleDescription = 'dark cinematic tech' } = styleAnalysis;
    const queries = await this.generateSearchQueries(userInput, plan, styleAnalysis, pptOutline);
    console.log('[ImageAgent] 搜索词:', queries);

    // ─── Step 3: 基于风格化搜索词搜索 Pexels + MiniMax 生图 ────────
    const minimaxKey = this.apiKeys?.minimaxApiKey || config.minimaxApiKey;
    const outputBase = path.resolve(config.outputDir, 'images');

    // 使用风格化搜索词 + 少量变体，保持全局一致性
    const coverSearchQueries = [
      queries.cover?.primary,
      ...(queries.cover?.variations || []).slice(0, 2)
    ].filter(Boolean);

    const contentSearchQueries = [
      queries.content?.primary,
      ...(queries.content?.variations || []).slice(0, 2)
    ].filter(Boolean);

    const endSearchQueries = [
      queries.end?.primary,
      ...(queries.end?.variations || []).slice(0, 2)
    ].filter(Boolean);

    // 并行搜索多个方向
    const pagePlans = Array.isArray(queries.pages) ? queries.pages.slice(0, 16) : [];
    const pageSearchPromises = pagePlans.map(async (pagePlan, index) => {
      const searchTerms = [
        pagePlan.query,
        ...(pagePlan.variations || []).slice(0, 1)
      ].filter(Boolean);
      return {
        pageIndex: Number.isInteger(pagePlan.pageIndex) ? pagePlan.pageIndex : index,
        pageTitle: pagePlan.pageTitle || '',
        role: pagePlan.role || 'content',
        query: pagePlan.query || '',
        treatment: pagePlan.treatment || 'ambient-texture',
        searchTerms,
      };
    });

    const [coverResults, contentResults, endResults, aiImageUrl, pageResults] = await Promise.all([
      Promise.all(coverSearchQueries.map(q => searchPexels(q, { perPage: 2 }))),
      Promise.all(contentSearchQueries.map(q => searchPexels(q, { perPage: 2 }))),
      Promise.all(endSearchQueries.map(q => searchPexels(q, { perPage: 2 }))),
      // MiniMax 生成封面图（有 key 时）
      queries.coverGeneratePrompt && minimaxKey
        ? generateMiniMaxImage(queries.coverGeneratePrompt, minimaxKey).catch(() => null)
        : Promise.resolve(null),
      Promise.all(pageSearchPromises)
    ]);

    // 合并去重
    const coverPhotos = [...new Map(coverResults.flat().map(p => [p.id, p])).values()];
    const contentPhotos = [...new Map(contentResults.flat().map(p => [p.id, p])).values()];
    const endPhotos = [...new Map(endResults.flat().map(p => [p.id, p])).values()];

    // ─── Step 3: 如果 MiniMax 生成成功，下载到本地（URL 24h 过期）
    let aiCandidate = null;
    if (aiImageUrl) {
      try {
        const localName = `${taskId}_cover_ai.jpg`;
        const localPath = path.join(outputBase, localName);
        await downloadImage(aiImageUrl, localPath);
        // AI 生成图尺寸不可控，立即处理为 1920×1080 JPEG 82%
        await processImageForPpt(localPath);
        aiCandidate = {
          id:        'ai_generated',
          url:       `/output/images/${localName}`,
          thumb:     `/output/images/${localName}`,
          localPath: localPath,
          photographer: 'MiniMax AI',
          photographerUrl: '',
          isAI: true
        };
        console.log('[ImageAgent] MiniMax 封面图已处理:', localPath);
      } catch (e) {
        console.warn('[ImageAgent] MiniMax 图片下载失败:', e.message);
      }
    }

    const normalizedCover = aiCandidate ? [aiCandidate, ...coverPhotos] : coverPhotos;
    const preparedPageCandidates = await this.collectPageCandidates(pageResults, taskId, outputBase);
    const selectedPages = await this.selectPageImages(preparedPageCandidates, styleAnalysis);
    const result = {
      cover:   await this.prepareTopCandidates(normalizedCover, 'cover', taskId, outputBase),
      content: await this.prepareTopCandidates(contentPhotos, 'content', taskId, outputBase),
      end:     await this.prepareTopCandidates(endPhotos, 'end', taskId, outputBase),
      pages:   selectedPages
    };

    console.log(`[ImageAgent] 完成：cover=${result.cover.length} content=${result.content.length} end=${result.end.length} pages=${result.pages.length}`);
    return result;
  }

  /**
   * 基于视觉风格分析，生成统一的图片搜索词
   */
  async generateSearchQueries(userInput, plan, styleAnalysis, pptOutline = null) {
    const { styleDescription, styleKeywords } = styleAnalysis;
    const styleStr = styleKeywords?.join(' ') || styleDescription || 'dark cinematic tech';
    const pageSummary = Array.isArray(pptOutline?.pages)
      ? pptOutline.pages.slice(0, 16).map((page, index) => ({
          pageIndex: index,
          layout: page.layout || page.type || 'bento_grid',
          title: page.content?.title || page.title || page.content?.mainTitle || page.mainTitle || `Page ${index + 1}`,
          subtitle: page.content?.subtitle || page.subtitle || '',
          role: page.visualIntent?.role || page.content?.role || ''
        }))
      : [];

    const messages = [
      {
        role: 'system',
        content: `你是一位图片搜索专家，负责为PPT生成Pexels搜索词。

核心原则：
1. 所有图片必须基于同一个视觉风格（已由风格分析确定）
2. cover/content/end三类页面可以有细微变化，但要保持系列感
3. 搜索词必须和策划方案的视觉风格匹配，不能另起炉灶
4. 背景图必须是氛围图，不能太具体（如：不要出现具体产品、人物、会议场景）

风格约束（必须遵守）：
- 统一的色彩基调（深蓝+光效/黑白极简/暖橙渐变等）
- 统一的氛围感（科技感/电影感/自然人文等）
- 所有图片像是同一组照片

请为每类页面生成2-3个搜索词（英文，2-5个词），形成风格统一的图片系列。
如果提供了页面列表，请额外为每页生成一个更具体的 page query，用于让图片与该页内容产生关系。`
      },
      {
        role: 'user',
        content: `## 视觉风格要求
风格描述：${styleDescription}
风格关键词：${styleStr}

## 活动信息
品牌：${userInput.brand}
活动类型：${userInput.eventType}
主题：${userInput.topic}

## 策划方案摘要
核心策略：${plan?.coreStrategy || ''}
方案亮点：${(plan?.highlights || []).join('；')}

## 页面列表
${pageSummary.length ? JSON.stringify(pageSummary, null, 2) : '暂未提供页面列表，只生成 cover/content/end 搜索词'}

请输出 JSON（所有搜索词必须体现上述视觉风格）：
{
  "cover": {
    "primary": "封面主搜索词（最能代表整体风格）",
    "variations": ["备选搜索词1", "备选搜索词2"]
  },
  "content": {
    "primary": "内容页主搜索词（与封面风格一致）",
    "variations": ["备选搜索词1", "备选搜索词2"]
  },
  "end": {
    "primary": "结尾页主搜索词（风格呼应，可略有意境感）",
    "variations": ["备选搜索词1", "备选搜索词2"]
  },
  "pages": [
    {
      "pageIndex": 0,
      "pageTitle": "页面标题",
      "role": "cover/section_opener/highlights/manifesto/comparison/timeline/metrics/ending",
      "query": "该页主搜图词",
      "variations": ["该页备选词"],
      "treatment": "full-bleed-dark / editorial-fade / split-atmosphere / ambient-texture / subtle-grid / quiet-finale"
    }
  ],
  "coverGeneratePrompt": "AI生图prompt（英文，50字以内，描述风格化的封面图）"
}`
      }
    ];

    try {
      return await this.callLLMJson(messages, { maxTokens: 512, temperature: 0.4 });
    } catch (e) {
      console.warn('[ImageAgent] 搜索词生成失败，使用风格化默认值:', e.message);
      return {
        cover: { primary: `${styleStr} elegant dark`, variations: [`${styleStr} dramatic dark`, `${styleStr} cinematic lights`] },
        content: { primary: `${styleStr} abstract atmosphere`, variations: [`${styleStr} particles light`, `${styleStr} moody dark`] },
        end: { primary: `${styleStr} minimalist elegant`, variations: [`${styleStr} stars night`, `${styleStr} horizon dark`] },
        pages: pageSummary.map(page => ({
          pageIndex: page.pageIndex,
          pageTitle: page.title,
          role: page.role || page.layout,
          query: `${styleStr} ${page.layout === 'timeline_flow' ? 'linear light path' : page.layout === 'data_cards' ? 'subtle technology texture' : page.layout === 'immersive_cover' ? 'cinematic architectural atmosphere' : 'editorial atmospheric space'}`,
          variations: [],
          treatment: page.layout === 'immersive_cover' ? 'full-bleed-dark'
            : page.layout === 'end_card' ? 'quiet-finale'
            : page.layout === 'split_content' ? 'split-atmosphere'
            : page.layout === 'data_cards' ? 'subtle-grid'
            : 'ambient-texture'
        })),
        coverGeneratePrompt: `${styleStr} elegant dark cinematic background`
      };
    }
  }

  async prepareTopCandidates(candidates, category, taskId, outputBase) {
    const normalized = [];
    for (let i = 0; i < Math.min(candidates.length, 3); i++) {
      const item = candidates[i];
      if (!item) continue;
      const prepared = await this.prepareCandidate(item, `${taskId}_${category}_${i}`, outputBase);
      normalized.push(prepared || item);
    }
    return normalized;
  }

  async prepareCandidate(candidate, baseName, outputBase) {
    if (!candidate) return null;
    if (candidate.localPath) {
      await processImageForPpt(candidate.localPath).catch(() => {});
      return candidate;
    }

    if (candidate.url?.startsWith('/output/')) {
      candidate.localPath = path.resolve('.', candidate.url.replace(/^\//, ''));
      await processImageForPpt(candidate.localPath).catch(() => {});
      return candidate;
    }

    try {
      const localPath = path.join(outputBase, `${baseName}.jpg`);
      await downloadImage(candidate.url, localPath);
      await processImageForPpt(localPath);
      return { ...candidate, localPath };
    } catch (e) {
      console.warn('[ImageAgent] 图片准备失败:', e.message);
      return candidate;
    }
  }

  async collectPageCandidates(pagePlans, taskId, outputBase) {
    const preparedPages = [];
    for (let index = 0; index < pagePlans.length; index++) {
      const pagePlan = pagePlans[index];
      const resultSets = await Promise.all((pagePlan.searchTerms || []).map(q => searchPexels(q, { perPage: 4 })));
      const rawCandidates = [...new Map(resultSets.flat().map(p => [p.id, p])).values()].slice(0, 6);
      const candidates = [];
      for (let i = 0; i < rawCandidates.length; i++) {
        const prepared = await this.prepareCandidate(
          rawCandidates[i],
          `${taskId}_page_${String(index).padStart(2, '0')}_${slugify(pagePlan.pageTitle || pagePlan.role)}_${i}`,
          outputBase
        );
        if (!prepared?.localPath) continue;
        const analysis = await analyzeImageForLayout(prepared.localPath).catch(() => null);
        candidates.push({
          ...prepared,
          analysis,
        });
      }
      preparedPages.push({
        ...pagePlan,
        candidates,
      });
    }
    return preparedPages;
  }

  scoreCandidateForPage(pagePlan, candidate, styleAnalysis) {
    const analysis = candidate.analysis || {};
    const brightness = analysis.overallBrightness ?? 80;
    const contrast = analysis.contrast ?? 40;
    const avgColor = analysis.averageColor || '#444444';
    const warmPalette = /bronze|warm|amber|gold|orange/i.test(styleAnalysis?.colorPalette || '');
    const role = pagePlan.role || '';
    const treatment = pagePlan.treatment || 'ambient-texture';

    let score = 0;
    if (brightness >= 28 && brightness <= 145) score += 18;
    if (contrast >= 22 && contrast <= 78) score += 16;
    if (treatment === 'full-bleed-dark' && brightness < 95) score += 16;
    if (treatment === 'subtle-grid' && contrast < 52) score += 12;
    if (treatment === 'editorial-fade' && ['left', 'right', 'top', 'bottom'].includes(analysis.safestTextPlacement)) score += 10;
    if (role === 'cover' && contrast >= 28) score += 10;
    if (role === 'timeline' && contrast >= 40) score += 8;
    if (role === 'metrics' && brightness < 90) score += 8;
    if (warmPalette && colorDistance(avgColor, '#8a6f4d') < 120) score += 10;
    if (!warmPalette && colorDistance(avgColor, '#2d3d45') < 120) score += 10;
    if (candidate.isAI) score += 6;
    return score;
  }

  async selectPageImages(pagePlans, styleAnalysis) {
    const usedIds = new Set();
    const selected = [];
    let lastAverageColor = null;

    for (const pagePlan of pagePlans) {
      const ranked = (pagePlan.candidates || [])
        .map((candidate) => ({
          candidate,
          score: this.scoreCandidateForPage(pagePlan, candidate, styleAnalysis)
            - (usedIds.has(candidate.id) ? 80 : 0)
            - (lastAverageColor && candidate.analysis?.averageColor
                ? Math.max(0, 22 - colorDistance(lastAverageColor, candidate.analysis.averageColor) / 10)
                : 0)
        }))
        .sort((a, b) => b.score - a.score);

      const picked = ranked[0]?.candidate || null;
      selected.push({
        pageIndex: pagePlan.pageIndex,
        pageTitle: pagePlan.pageTitle,
        role: pagePlan.role,
        query: pagePlan.query,
        treatment: pagePlan.treatment,
        source: picked?.isAI ? 'minimax' : (picked ? 'pexels' : ''),
        localPath: picked?.localPath || '',
        analysis: picked?.analysis || null,
        candidates: ranked.slice(0, 3).map(item => ({
          id: item.candidate.id,
          localPath: item.candidate.localPath,
          score: Math.round(item.score),
          averageColor: item.candidate.analysis?.averageColor || '',
        })),
      });

      if (picked?.id) usedIds.add(picked.id);
      if (picked?.analysis?.averageColor) lastAverageColor = picked.analysis.averageColor;
    }

    return selected;
  }
}

module.exports = ImageAgent;
