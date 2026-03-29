const BaseAgent = require('./baseAgent');
const { searchPexels, generateMiniMaxImage, downloadImage, processImageForPpt } = require('../services/imageSearch');
const config = require('../config');
const path   = require('path');

class ImageAgent extends BaseAgent {
  constructor() {
    super('ImageAgent', 'minimax');
  }

  /**
   * @param {{ plan, userInput, taskId }} input
   * @returns {Promise<{ cover: Candidate[], content: Candidate[], end: Candidate[] }>}
   */
  async run({ plan, userInput, taskId }) {
    console.log('[ImageAgent] 开始搜索配图...');

    // ─── Step 1: 分析策划方案，确定视觉风格方向 ──────────────────
    const styleAnalysisMessages = [
      {
        role: 'system',
        content: `你是一位资深视觉策划专家，负责为PPT确定整体视觉风格和图片调性。

你的任务：
1. 分析策划方案的关键词（核心命题、高亮、叙事风格）
2. 确定这套PPT应该是什么"视觉人格"（比如：科技未来感、高端奢华、自然人文、年轻活力、电影质感等）
3. 确定统一的色彩基调（冷色调/暖色调/中性，暗调/亮调）
4. 给出具体的视觉风格描述词（英文，2-4个词）

注意：
- 视觉风格要能从策划方案中推断出来，服务于内容调性
- 但不要和具体内容绑定太死（比如"芯片发布会"不是找芯片图，而是推断出"科技感+高端感"）
- 图片风格要全局一致，整套PPT像同一组照片
- 可以允许10-20%的风格微调（比如80%统一风格+偶尔换个角度）`
      },
      {
        role: 'user',
        content: `请分析以下策划方案，确定视觉风格方向：

## 活动信息
品牌：${userInput.brand}
活动类型：${userInput.eventType}
主题：${userInput.topic}
产品类别：${userInput.productCategory}
用户风格偏好：${userInput.style || '未指定'}

## 策划方案
方案标题：${plan?.planTitle || ''}
核心策略：${plan?.coreStrategy || ''}
高亮亮点：${(plan?.highlights || []).join('；')}
章节叙事：${(plan?.sections || []).map(s => s.narrative).join(' ')}
关键词语：${(plan?.highlights || []).join(' ') + ' ' + (plan?.sections || []).map(s => s.title + ' ' + s.narrative).join(' ')}

请输出 JSON：
{
  "visualPersonality": "视觉人格描述（1句话，如：高端科技感+电影质感）",
  "colorPalette": "色彩基调（如：深蓝+金色光效 / 黑白灰极简 / 暖橙渐变）",
  "styleKeywords": ["风格关键词1", "风格关键词2", "风格关键词3"],
  "styleDescription": "详细风格描述（英文，3-5个词，用于图片搜索）"
}`
      }
    ];

    let styleAnalysis = {};
    try {
      styleAnalysis = await this.callLLMJson(styleAnalysisMessages, { maxTokens: 512, temperature: 0.5 });
      console.log('[ImageAgent] 视觉风格分析:', styleAnalysis);
    } catch (e) {
      console.warn('[ImageAgent] 风格分析失败，使用默认风格:', e.message);
      styleAnalysis = {
        visualPersonality: '科技感+电影质感',
        colorPalette: '深蓝+光效',
        styleKeywords: ['tech', 'dark', 'elegant', 'cinematic'],
        styleDescription: 'dark technology cinematic atmosphere'
      };
    }

    // ─── Step 2: 基于视觉风格，为每类页面生成搜索词 ───────────────
    const { styleDescription = 'dark cinematic tech' } = styleAnalysis;
    const queries = await this.generateSearchQueries(userInput, plan, styleAnalysis);
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
    const [coverResults, contentResults, endResults, aiImageUrl] = await Promise.all([
      Promise.all(coverSearchQueries.map(q => searchPexels(q, { perPage: 2 }))),
      Promise.all(contentSearchQueries.map(q => searchPexels(q, { perPage: 2 }))),
      Promise.all(endSearchQueries.map(q => searchPexels(q, { perPage: 2 }))),
      // MiniMax 生成封面图（有 key 时）
      queries.coverGeneratePrompt && minimaxKey
        ? generateMiniMaxImage(queries.coverGeneratePrompt, minimaxKey).catch(() => null)
        : Promise.resolve(null)
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

    const result = {
      cover:   [...(aiCandidate ? [aiCandidate] : []), ...coverPhotos],
      content: contentPhotos,
      end:     endPhotos
    };

    console.log(`[ImageAgent] 完成：cover=${result.cover.length} content=${result.content.length} end=${result.end.length}`);
    return result;
  }

  /**
   * 基于视觉风格分析，生成统一的图片搜索词
   */
  async generateSearchQueries(userInput, plan, styleAnalysis) {
    const { styleDescription, styleKeywords } = styleAnalysis;
    const styleStr = styleKeywords?.join(' ') || styleDescription || 'dark cinematic tech';

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

请为每类页面生成2-3个搜索词（英文，2-4个词），形成风格统一的图片系列。`
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
        coverGeneratePrompt: `${styleStr} elegant dark cinematic background`
      };
    }
  }
}

module.exports = ImageAgent;
