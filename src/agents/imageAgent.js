const BaseAgent = require('./baseAgent');
const { searchPexels, generateMiniMaxImage, downloadImage, processImageForPpt } = require('../services/imageSearch');
const { analyzeImageForLayout, colorDistance } = require('../services/imageAnalyzer');
const { getRunAssetDir, toOutputUrl } = require('../services/outputPaths');
const config = require('../config');
const path   = require('path');

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'page';
}

function dedupeStrings(values = []) {
  return [...new Map(values.filter(Boolean).map(v => [String(v).trim().toLowerCase(), String(v).trim()])).values()];
}

function inferPageBucket(page = {}) {
  const layout = page.layout || '';
  const role = page.role || '';
  const title = `${page.pageTitle || ''} ${page.title || ''}`.toLowerCase();

  if (layout === 'immersive_cover' || role === 'cover') return 'cover';
  if (layout === 'timeline_flow' || /结构|timeline|launch sequence|发布会结构/.test(title) || role === 'timeline') return 'timeline';
  if (layout === 'data_cards' || /效果|数据|metrics|result/.test(title) || role === 'metrics') return 'metrics';
  if (layout === 'editorial_quote' || /命题|quote|manifesto|brand/.test(title) || role === 'manifesto') return 'editorial';
  if (layout === 'bento_grid' || /亮点|highlights|feature/.test(title) || role === 'highlights') return 'highlights';
  if (layout === 'split_content' || /路径|comparison|journey/.test(title) || role === 'comparison') return 'journey';
  if (layout === 'end_card' || role === 'ending') return 'ending';
  return 'story';
}

function resolveTreatmentForLayout(layout = '') {
  if (layout === 'immersive_cover') return 'full-bleed-dark';
  if (layout === 'end_card') return 'quiet-finale';
  if (layout === 'split_content') return 'split-atmosphere';
  if (layout === 'data_cards') return 'subtle-grid';
  if (layout === 'editorial_quote') return 'editorial-fade';
  return 'ambient-texture';
}

function buildStyleModifiers(styleAnalysis = {}) {
  const styleText = [
    ...(styleAnalysis?.styleKeywords || []),
    styleAnalysis?.styleDescription || '',
    styleAnalysis?.visualPersonality || '',
    styleAnalysis?.colorPalette || '',
  ]
    .join(' ')
    .toLowerCase();

  const modifiers = [];
  if (/luxury|premium|editorial/.test(styleText)) modifiers.push('editorial luxury');
  if (/teal|cyan|blue/.test(styleText)) modifiers.push('teal haze');
  if (/bronze|amber|gold|warm/.test(styleText)) modifiers.push('bronze glow');
  if (/cinematic|film|movie/.test(styleText)) modifiers.push('cinematic');
  if (/minimal|minimalist/.test(styleText)) modifiers.push('minimal');
  if (/technology|tech|future/.test(styleText)) modifiers.push('future mood');
  return dedupeStrings(modifiers).slice(0, 2);
}

function buildRoleDrivenQueries(page = {}, styleAnalysis = {}) {
  const bucket = inferPageBucket(page);
  const warmPalette = /bronze|warm|amber|gold|orange/i.test(styleAnalysis?.colorPalette || '');
  const accent = warmPalette ? 'bronze glow' : 'teal glow';
  const modifiers = buildStyleModifiers(styleAnalysis);

  const presets = {
    cover: [
      `cinematic concept silhouette ${accent}`,
      `storm clouds dramatic key visual`,
      `moody launch atmosphere abstract`
    ],
    editorial: [
      `editorial fabric shadow ${accent}`,
      `sculptural light beams abstract`,
      `gallery light and shadow minimal`
    ],
    highlights: [
      `macro metallic texture ${accent}`,
      `precision material detail dark`,
      `abstract surface with reflected light`
    ],
    journey: [
      `light ribbon through darkness abstract`,
      `gradient tunnel minimal cinematic`,
      `directional light path moody`
    ],
    timeline: [
      `sequential light trail dark stage`,
      `motion path in black space`,
      `dark event runway lights`
    ],
    metrics: [
      `graphite grid texture macro`,
      `data mesh subtle dark pattern`,
      `precision lines abstract dark`
    ],
    ending: [
      `distant horizon glow minimal`,
      `night sky atmospheric finale`,
      `quiet cinematic horizon dark`
    ],
    story: [
      `atmospheric abstract depth dark`,
      `soft volumetric light moody`,
      `minimal cinematic environment`
    ]
  };

  return dedupeStrings(
    (presets[bucket] || presets.story).map((query, index) => {
      const modifier = modifiers[index % Math.max(modifiers.length, 1)] || '';
      return sanitizeQuery(`${query} ${modifier}`.trim());
    })
  );
}

function buildFallbackPageQuery(page = {}, styleAnalysis = {}) {
  const queries = buildRoleDrivenQueries(page, styleAnalysis);
  const seed = `${page.pageIndex || 0}-${page.pageTitle || ''}-${page.role || ''}-${page.layout || ''}`;
  const pivot = Array.from(seed).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % Math.max(queries.length, 1);
  const ordered = [...queries.slice(pivot), ...queries.slice(0, pivot)];
  return {
    query: ordered[0] || 'minimal cinematic environment',
    variations: ordered.slice(1, 4),
    treatment: resolveTreatmentForLayout(page.layout),
  };
}

function sanitizeQuery(query = '') {
  return String(query)
    .replace(/\b(architectural|architecture|industrial|corridor|warehouse|factory|metallic lines?)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function looksLikePlaceholder(value = '') {
  return /搜索词|备选|该页|prompt|主搜索词|variation|query/i.test(String(value || ''));
}

function isUsableQueryPayload(payload, expectedPageCount = 0) {
  if (!payload || typeof payload !== 'object') return false;
  if (looksLikePlaceholder(payload?.cover?.primary) || looksLikePlaceholder(payload?.content?.primary) || looksLikePlaceholder(payload?.end?.primary)) {
    return false;
  }
  if (expectedPageCount > 0 && (!Array.isArray(payload.pages) || payload.pages.length < Math.min(expectedPageCount, 4))) {
    return false;
  }
  if (Array.isArray(payload.pages) && payload.pages.some(page => looksLikePlaceholder(page?.query))) {
    return false;
  }
  return true;
}

class ImageAgent extends BaseAgent {
  constructor(apiKeys = {}) {
    super('ImageAgent', 'minimax', apiKeys);
  }

  /**
   * @param {{ plan, userInput, taskId, pptOutline, visualPlan }} input
   * @returns {Promise<{ cover: Candidate[], content: Candidate[], end: Candidate[], pages: object[] }>}
   */
  async run({ plan, userInput, taskId = `img_${Date.now()}`, pptOutline = null, visualPlan = null }) {
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
    const runId = taskId || `img_${Date.now()}`;
    const outputBase = getRunAssetDir(runId, 'images');

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
    const visualPages = this.normalizeVisualPlans(visualPlan, pptOutline);
    const pagePlans = Array.isArray(queries.pages) ? queries.pages.slice(0, 16).map((pagePlan, index) => {
      const visualPage = visualPages[index] || {};
      return {
        ...pagePlan,
        generateImage: !!visualPage.generateImage,
        generatePrompt: String(visualPage.prompt || '').trim(),
        fallbackQuery: String(visualPage.fallbackQuery || '').trim(),
        sceneType: String(visualPage.sceneType || '').trim(),
        insertMode: String(visualPage.insertMode || '').trim(),
        assetType: String(visualPage.assetType || '').trim(),
        reason: String(visualPage.reason || '').trim(),
        shotIntent: String(visualPage.shotIntent || '').trim(),
      };
    }) : [];
    const pageSearchPromises = pagePlans.map(async (pagePlan, index) => {
      const roleDrivenQueries = buildRoleDrivenQueries(pagePlan, styleAnalysis);
      const rawTerms = [
        sanitizeQuery(pagePlan.fallbackQuery),
        sanitizeQuery(pagePlan.query),
        ...(pagePlan.variations || []).slice(0, 2).map(sanitizeQuery),
        ...roleDrivenQueries
      ];
      const searchTerms = dedupeStrings(rawTerms).slice(0, 4);
      return {
        pageIndex: Number.isInteger(pagePlan.pageIndex) ? pagePlan.pageIndex : index,
        pageTitle: pagePlan.pageTitle || '',
        role: pagePlan.role || 'content',
        query: pagePlan.query || '',
        treatment: pagePlan.treatment || 'ambient-texture',
        generateImage: !!pagePlan.generateImage,
        generatePrompt: pagePlan.generatePrompt || '',
        fallbackQuery: pagePlan.fallbackQuery || '',
        sceneType: pagePlan.sceneType || '',
        insertMode: pagePlan.insertMode || 'background',
        assetType: pagePlan.assetType || '',
        reason: pagePlan.reason || '',
        shotIntent: pagePlan.shotIntent || '',
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
          url:       toOutputUrl(localPath),
          thumb:     toOutputUrl(localPath),
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
    const preparedPageCandidates = await this.collectPageCandidates(pageResults, taskId, outputBase, minimaxKey);
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
      const raw = await this.callLLMJson(messages, { maxTokens: 512, temperature: 0.4 });
      if (!isUsableQueryPayload(raw, pageSummary.length)) {
        throw new Error('query payload contains placeholders or insufficient page coverage');
      }
      if (Array.isArray(raw?.pages)) {
        raw.pages = raw.pages.map((page, index) => {
          const summary = pageSummary[index] || {};
          const extras = buildRoleDrivenQueries({
            layout: summary.layout,
            role: page.role || summary.role,
            pageTitle: page.pageTitle || summary.title
          }, styleAnalysis);
          return {
            ...page,
            query: sanitizeQuery(page.query || ''),
            variations: dedupeStrings([...(page.variations || []).map(sanitizeQuery), ...extras]).slice(0, 3)
          };
        });
      }
      return raw;
    } catch (e) {
      console.warn('[ImageAgent] 搜索词生成失败，使用风格化默认值:', e.message);
      const coverFallback = buildFallbackPageQuery({ layout: 'immersive_cover', role: 'cover', pageTitle: 'cover' }, styleAnalysis);
      const contentFallback = buildFallbackPageQuery({ layout: 'editorial_quote', role: 'manifesto', pageTitle: 'content' }, styleAnalysis);
      const endFallback = buildFallbackPageQuery({ layout: 'end_card', role: 'ending', pageTitle: 'ending' }, styleAnalysis);
      return {
        cover: { primary: coverFallback.query, variations: coverFallback.variations },
        content: { primary: contentFallback.query, variations: contentFallback.variations },
        end: { primary: endFallback.query, variations: endFallback.variations },
        pages: pageSummary.map(page => ({
          pageIndex: page.pageIndex,
          pageTitle: page.title,
          role: page.role || page.layout,
          ...buildFallbackPageQuery(page, styleAnalysis)
        })),
        coverGeneratePrompt: `${coverFallback.query} abstract launch key visual`
      };
    }
  }

  async prepareTopCandidates(candidates, category, taskId, outputBase) {
    const top = candidates.slice(0, 3).filter(Boolean);
    const results = await Promise.all(
      top.map((item, i) => this.prepareCandidate(item, `${taskId}_${category}_${i}`, outputBase))
    );
    return results.map((prepared, i) => prepared || top[i]);
  }

  async prepareCandidate(candidate, baseName, outputBase) {
    if (!candidate) return null;
    if (candidate.localPath) {
      await processImageForPpt(candidate.localPath).catch(() => {});
      return candidate;
    }

    if (candidate.url?.startsWith('/output/')) {
      candidate.localPath = path.resolve(config.outputDir, candidate.url.replace(/^\/output\/?/, ''));
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

  normalizeVisualPlans(visualPlan = null, pptOutline = null) {
    const outlinePages = Array.isArray(pptOutline?.pages) ? pptOutline.pages : [];
    const visualPages = Array.isArray(visualPlan?.pages) ? visualPlan.pages : [];
    const byIndex = new Map(
      visualPages
        .filter(item => Number.isInteger(item?.pageIndex))
        .map(item => [item.pageIndex, item])
    );
    return outlinePages.slice(0, 16).map((page, index) => {
      const visual = byIndex.get(index) || {};
      return {
        pageIndex: index,
        pageTitle: visual.pageTitle || page?.content?.title || page?.title || `Page ${index + 1}`,
        generateImage: !!visual.generateImage,
        prompt: String(visual.prompt || '').trim(),
        fallbackQuery: String(visual.fallbackQuery || '').trim(),
        sceneType: String(visual.sceneType || '').trim(),
        insertMode: String(visual.insertMode || 'background').trim(),
        assetType: String(visual.assetType || '').trim(),
        reason: String(visual.reason || '').trim(),
        shotIntent: String(visual.shotIntent || '').trim(),
      };
    });
  }

  async createAiCandidateForPage(pagePlan, taskId, outputBase, minimaxKey) {
    if (!pagePlan?.generateImage || !pagePlan?.generatePrompt || !minimaxKey) return null;
    try {
      const aiImageUrl = await generateMiniMaxImage(pagePlan.generatePrompt, minimaxKey);
      if (!aiImageUrl) return null;
      const localPath = path.join(
        outputBase,
        `${taskId}_page_ai_${String(pagePlan.pageIndex).padStart(2, '0')}_${slugify(pagePlan.pageTitle || pagePlan.sceneType)}.jpg`
      );
      await downloadImage(aiImageUrl, localPath);
      await processImageForPpt(localPath);
      const analysis = await analyzeImageForLayout(localPath).catch(() => null);
      return {
        id: `ai_generated_${pagePlan.pageIndex}`,
        url: toOutputUrl(localPath),
        thumb: toOutputUrl(localPath),
        localPath,
        photographer: 'MiniMax AI',
        photographerUrl: '',
        isAI: true,
        originQuery: pagePlan.generatePrompt,
        analysis
      };
    } catch (err) {
      console.warn(`[ImageAgent] 第 ${pagePlan.pageIndex + 1} 页 AI 生图失败:`, err.message);
      return null;
    }
  }

  async collectPageCandidates(pagePlans, taskId, outputBase, minimaxKey = '') {
    // 并发处理各页，最多 5 页同时进行（避免触发 Pexels 限流）
    const CONCURRENCY = 5;
    const results = [];
    for (let start = 0; start < pagePlans.length; start += CONCURRENCY) {
      const batch = pagePlans.slice(start, start + CONCURRENCY);
      const batchResults = await Promise.all(batch.map(async (pagePlan, batchIdx) => {
        const index = start + batchIdx;
        const resultSets = await Promise.all((pagePlan.searchTerms || []).map(async (q) => {
          const photos = await searchPexels(q, { perPage: 8 });
          return photos.map(photo => ({ ...photo, originQuery: q }));
        }));
        const rawCandidates = [...new Map(resultSets.flat().map(p => [p.id, p])).values()].slice(0, 6);
        const aiCandidate = await this.createAiCandidateForPage(pagePlan, taskId, outputBase, minimaxKey);

        // 候选图片并行下载 + 分析（每页最多 6 张，并行）
        const candidateResults = await Promise.all(
          rawCandidates.map(async (raw, i) => {
            const prepared = await this.prepareCandidate(
              raw,
              `${taskId}_page_${String(index).padStart(2, '0')}_${slugify(pagePlan.pageTitle || pagePlan.role)}_${i}`,
              outputBase
            );
            if (!prepared?.localPath) return null;
            const analysis = await analyzeImageForLayout(prepared.localPath).catch(() => null);
            return { ...prepared, originQuery: raw.originQuery || '', analysis };
          })
        );

        return {
          ...pagePlan,
          candidates: [aiCandidate, ...candidateResults].filter(Boolean)
        };
      }));
      results.push(...batchResults);
    }
    return results;
  }

  scoreCandidateForPage(pagePlan, candidate, styleAnalysis) {
    const analysis = candidate.analysis || {};
    const brightness = analysis.overallBrightness ?? 80;
    const contrast = analysis.contrast ?? 40;
    const avgColor = analysis.averageColor || '#444444';
    const warmPalette = /bronze|warm|amber|gold|orange/i.test(styleAnalysis?.colorPalette || '');
    const role = pagePlan.role || '';
    const treatment = pagePlan.treatment || 'ambient-texture';
    const originQuery = candidate.originQuery || '';

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
    if (/architect|industrial|warehouse|factory|corridor/i.test(originQuery)) score -= 10;
    if (/fabric|gallery|sculptural|silhouette|horizon|trail|ribbon|mesh|texture/i.test(originQuery)) score += 10;
    return score;
  }

  async selectPageImages(pagePlans, styleAnalysis) {
    const usedIds = new Set();
    const selected = [];
    let lastAverageColor = null;
    let lastQueryFamily = '';

    for (const pagePlan of pagePlans) {
      const ranked = (pagePlan.candidates || [])
        .map((candidate) => ({
          candidate,
          score: this.scoreCandidateForPage(pagePlan, candidate, styleAnalysis)
            - (usedIds.has(candidate.id) ? 80 : 0)
            - (lastAverageColor && candidate.analysis?.averageColor
                ? Math.max(0, 22 - colorDistance(lastAverageColor, candidate.analysis.averageColor) / 10)
                : 0)
            - (lastQueryFamily && candidate.originQuery && candidate.originQuery.toLowerCase().includes(lastQueryFamily) ? 12 : 0)
        }))
        .sort((a, b) => b.score - a.score);

      const picked = ranked[0]?.candidate || null;
      selected.push({
        pageIndex: pagePlan.pageIndex,
        pageTitle: pagePlan.pageTitle,
        role: pagePlan.role,
        query: pagePlan.query,
        treatment: pagePlan.treatment,
        sceneType: pagePlan.sceneType || '',
        insertMode: pagePlan.insertMode || 'background',
        assetType: pagePlan.assetType || '',
        reason: pagePlan.reason || '',
        shotIntent: pagePlan.shotIntent || '',
        source: picked?.isAI ? 'minimax' : (picked ? 'pexels' : ''),
        localPath: picked?.localPath || '',
        analysis: picked?.analysis || null,
        candidates: ranked.slice(0, 3).map(item => ({
          id: item.candidate.id,
          localPath: item.candidate.localPath,
          originQuery: item.candidate.originQuery || '',
          score: Math.round(item.score),
          averageColor: item.candidate.analysis?.averageColor || '',
        })),
      });

      if (picked?.id) usedIds.add(picked.id);
      if (picked?.analysis?.averageColor) lastAverageColor = picked.analysis.averageColor;
      if (picked?.originQuery) {
        const family = picked.originQuery.toLowerCase().match(/fabric|gallery|sculptural|trail|ribbon|mesh|texture|horizon|silhouette|architect|industrial|corridor|warehouse|factory/);
        lastQueryFamily = family?.[0] || '';
      }
    }

    return selected;
  }
}

module.exports = ImageAgent;
