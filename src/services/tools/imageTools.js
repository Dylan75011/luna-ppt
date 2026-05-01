// 图片相关工具：search_images, generate_image, review_uploaded_images
const path = require('path');
const { analyzeAgentImages } = require('../visionMcp');
const { toPublicUrl, getRunAssetDir, getConversationRunAssetDir } = require('../outputPaths');
const { buildImageSearchPayload } = require('../imageCanvas');
const { searchImages, generateMiniMaxImage, downloadImage, processImageForPpt } = require('../imageSearch');

async function execGenerateImage(args, session, onEvent) {
  const prompt = String(args.prompt || '').trim();
  const intent = String(args.intent || '').trim();
  if (!prompt) return { success: false, error: '请提供图片描述（prompt）' };

  const minimaxKey = session.apiKeys?.minimaxApiKey;
  if (!minimaxKey) return { success: false, error: '需要配置 MiniMax API Key 才能生成图片' };

  onEvent('tool_progress', { message: `正在生成图片：${intent || prompt.slice(0, 30)}…（约 10-20 秒）` });

  try {
    const imageUrl = await generateMiniMaxImage(prompt, minimaxKey);
    if (!imageUrl) return { success: false, error: 'MiniMax 生图返回为空，请稍后重试' };

    const runId = `gen_${Date.now()}`;
    const outputBase = session?.conversationId
      ? getConversationRunAssetDir(session.conversationId, runId, 'images')
      : getRunAssetDir(runId, 'images');
    const localPath = path.join(outputBase, `${runId}.jpg`);
    await downloadImage(imageUrl, localPath);
    await processImageForPpt(localPath);

    const previewUrl = toPublicUrl(localPath);
    onEvent('tool_progress', { message: '图片已生成' });
    onEvent('artifact', {
      artifactType: 'generated_image',
      payload: {
        prompt,
        intent,
        url: previewUrl,
        localPath
      }
    });

    return {
      success: true,
      url: previewUrl,
      markdown: `![${intent || '生成图片'}](${previewUrl})`,
      prompt,
      intent
    };
  } catch (e) {
    return { success: false, error: `生成失败：${e.message}` };
  }
}

async function execSearchImages(args, session, onEvent) {
  const rawQuery = String(args.query || '').trim();
  if (!rawQuery) {
    return { success: false, error: '缺少搜图关键词', images: [] };
  }

  const site = String(args.site || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const finalQuery = site ? `site:${site} ${rawQuery}` : rawQuery;
  const maxResults = Math.min(Math.max(Number(args.max_results) || 8, 1), 12);
  const progressMsg = site ? `正在从 ${site} 找图：${rawQuery}` : `正在找图：${rawQuery}`;
  onEvent('tool_progress', { message: progressMsg });

  const images = await searchImages(finalQuery, {
    perPage: maxResults,
    serpApiKey:   session?.apiKeys?.serpApiKey,
    bingApiKey:   session?.apiKeys?.bingApiKey,
    pexelsApiKey: session?.apiKeys?.pexelsApiKey,
  });
  if (!images.length) {
    return {
      success: false,
      error: '暂时没有找到合适的图片结果',
      images: [],
      query: rawQuery,
      intent: String(args.intent || '').trim()
    };
  }

  const normalizedImages = images.map((item, index) => ({
    id: String(item.id || `pexels_${index}`),
    url: item.url,
    thumb: item.thumb || item.url,
    previewUrl: item.thumb || item.url,
    originQuery: rawQuery,
    source: 'pexels',
    selected: index === 0,
    photographer: item.photographer || '',
    photographerUrl: item.photographerUrl || ''
  }));

  onEvent('tool_progress', { message: `已找到 ${normalizedImages.length} 张图片` });
  onEvent('artifact', {
    artifactType: 'image_search_result',
    payload: buildImageSearchPayload({
      query: rawQuery,
      intent: String(args.intent || '').trim(),
      images: normalizedImages,
      title: args.intent ? `找图结果：${args.intent}` : `找图结果：${rawQuery}`,
      summary: `共找到 ${normalizedImages.length} 张图片，可直接继续筛选或指定风格细化。`
    })
  });

  return {
    success: true,
    query: rawQuery,
    intent: String(args.intent || '').trim(),
    count: normalizedImages.length,
    images: normalizedImages.map((item) => ({
      id: item.id,
      url: item.url,
      thumb: item.thumb,
      photographer: item.photographer,
      photographerUrl: item.photographerUrl
    }))
  };
}

async function execReviewUploadedImages(args, session, onEvent) {
  const allAttachments = Array.isArray(session.attachments) ? session.attachments : [];
  if (!allAttachments.length) {
    return {
      success: false,
      error: '当前会话还没有可供查看的用户图片'
    };
  }

  const requestedIds = Array.isArray(args.image_ids)
    ? args.image_ids.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const selectedAttachments = requestedIds.length
    ? allAttachments.filter((item) => requestedIds.includes(item.id))
    : allAttachments.slice(-4);

  if (!selectedAttachments.length) {
    return {
      success: false,
      error: '没有匹配到指定的图片 ID'
    };
  }

  onEvent('tool_progress', { message: `正在重新查看 ${selectedAttachments.length} 张图片...` });
  const analyses = await analyzeAgentImages(selectedAttachments, {
    minimaxApiKey: session.apiKeys.minimaxApiKey,
    userText: String(args.prompt || '').trim()
  });

  const summary = analyses.map((item, index) => {
    if (item.analysis) {
      return `[图片${index + 1}] ${item.name}\n${item.analysis}`;
    }
    return `[图片${index + 1}] ${item.name}\n分析失败：${item.error || '未知错误'}`;
  }).join('\n\n');

  return {
    success: true,
    count: analyses.length,
    summary,
    images: analyses.map((item) => ({
      id: item.id,
      name: item.name,
      url: item.url,
      analysis: item.analysis || '',
      error: item.error || ''
    }))
  };
}

module.exports = { execGenerateImage, execSearchImages, execReviewUploadedImages };
