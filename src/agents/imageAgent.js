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
    const { brand, eventType, topic, productCategory } = userInput;
    console.log('[ImageAgent] 开始搜索配图...');

    // ─── Step 1: 用 LLM 生成三类英文搜索词 ───────────────────────
    const messages = [
      {
        role: 'system',
        content: `你是一位视觉策划专家，为品牌活动 PPT 寻找合适的背景图片。
请根据活动信息，为三类页面生成最合适的 Pexels 图片搜索词（英文，2-4个词组合）。

规则：
- cover：封面图，需要有视觉冲击力、与品牌/活动主题强相关的场景
- content：内容页背景，要专业、干净、不喧宾夺主，轻度虚化感最佳
- end：结尾页，优雅收尾感，可以是极简或星空等意境感强的画面
- 搜索词要具体，包含场景、氛围、色调关键词，英文效果更好`
      },
      {
        role: 'user',
        content: `品牌：${brand}
活动类型：${eventType}
主题：${topic}
产品类别：${productCategory}
核心策略：${plan?.coreStrategy || ''}

请输出 JSON：
{
  "cover":   "搜索词",
  "content": "搜索词",
  "end":     "搜索词",
  "coverGeneratePrompt": "用于 AI 生图的详细英文 prompt（50字以内，强调品牌调性、场景氛围、光线）"
}`
      }
    ];

    let queries = {};
    try {
      queries = await this.callLLMJson(messages, { maxTokens: 512, temperature: 0.4 });
    } catch (e) {
      console.warn('[ImageAgent] 关键词生成失败，使用默认词:', e.message);
      queries = {
        cover:   `${brand} ${eventType} dramatic dark`,
        content: `${productCategory} professional minimal background`,
        end:     'elegant closing minimal abstract'
      };
    }
    console.log('[ImageAgent] 搜索词:', queries);

    // ─── Step 2: 并行 Pexels 搜索 + MiniMax 生图 ────────────────
    const minimaxKey = this.apiKeys?.minimaxApiKey || config.minimaxApiKey;
    const outputBase = path.resolve(config.outputDir, 'images');

    const [coverPhotos, contentPhotos, endPhotos, aiImageUrl] = await Promise.all([
      searchPexels(queries.cover   || `${brand} event stage`, { perPage: 3 }),
      searchPexels(queries.content || `${productCategory} professional`, { perPage: 3 }),
      searchPexels(queries.end     || 'elegant minimal closing', { perPage: 3 }),
      // MiniMax 生成封面图（有 key 时）
      queries.coverGeneratePrompt && minimaxKey
        ? generateMiniMaxImage(queries.coverGeneratePrompt, minimaxKey).catch(() => null)
        : Promise.resolve(null)
    ]);

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
}

module.exports = ImageAgent;
