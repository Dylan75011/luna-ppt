const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const { fetchWithTimeout, withTimeout } = require('../utils/abortx');

// 单图下载/VLM 调用的硬上限。上层 brainAgent 还会有更大的 race，这里只防"挂死在 socket"。
const IMAGE_DOWNLOAD_TIMEOUT_MS = 8_000;
const VLM_REQUEST_TIMEOUT_MS = 15_000;
// analyzeAgentImages 单图整体兜底（含下载+VLM），并发模式下用来防止某张图拖慢全局
const PER_IMAGE_BUDGET_MS = 25_000;
// 并发上限：纯 Promise.all 在用户上传 5 张图时会同时打 5 个 VLM 请求，
// 可能撞 MiniMax rate limit。3 个一批是平衡点（吞吐 vs 限速风险）。
const VLM_CONCURRENCY = 3;

function getMinimaxApiHost() {
  return String(config.minimaxBaseUrl || 'https://api.minimaxi.com/v1').replace(/\/v1\/?$/, '');
}

async function fileToDataUrl(localPath, mimeType = '') {
  const ext = path.extname(localPath).toLowerCase();
  const resolvedMimeType = mimeType
    || (ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg');
  const buffer = await fs.readFile(localPath);
  return `data:${resolvedMimeType};base64,${buffer.toString('base64')}`;
}

// 部分 CDN 对 Referer / UA 校验严格（典型例子：xhs CDN 的 sns-webpic-qc.xhscdn.com）
// 检测到这类域名时自动带上对应 Referer，避免在 Node 后端拉图被 403
function fetchHeadersFor(url) {
  if (/xhscdn\.com|xiaohongshu\.com/i.test(url)) {
    return {
      'Referer': 'https://www.xiaohongshu.com/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    };
  }
  return {};
}

async function normalizeImageSource(imageSource, mimeType = '') {
  if (!imageSource) throw new Error('图片来源不能为空');

  if (imageSource.startsWith('data:')) {
    return imageSource;
  }

  if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
    const response = await fetchWithTimeout(
      imageSource,
      { headers: fetchHeadersFor(imageSource) },
      IMAGE_DOWNLOAD_TIMEOUT_MS
    );
    if (!response.ok) throw new Error(`下载图片失败：HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || mimeType || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    return `data:${contentType};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
  }

  return fileToDataUrl(imageSource, mimeType);
}

async function understandImage(prompt, imageSource, options = {}) {
  const apiKey = options.minimaxApiKey || config.minimaxApiKey;
  if (!apiKey) throw new Error('MINIMAX_API_KEY 未配置，请在设置面板中填写');

  const imageUrl = await normalizeImageSource(imageSource, options.mimeType);
  const response = await fetchWithTimeout(`${getMinimaxApiHost()}/v1/coding_plan/vlm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      prompt,
      image_url: imageUrl
    })
  }, VLM_REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`MiniMax VLM HTTP ${response.status}`);
  }

  const data = await response.json();
  const content = String(data?.content || '').trim();
  if (!content) throw new Error('MiniMax VLM 未返回有效内容');
  return content;
}

async function analyzeAgentImages(attachments = [], options = {}) {
  const text = String(options.userText || '').trim();
  const prompt = [
    '你是活动策划对话的视觉理解助手。',
    '请分析这张图片，输出简洁中文，尽量控制在 120-180 字。',
    '重点包括：1. 主体/场景 2. 可识别的文字、品牌、产品线索 3. 风格、配色、氛围 4. 对活动策划、PPT 或用户当前问题最有帮助的信息。',
    text ? `用户本轮问题或说明：${text}` : '用户本轮未提供额外文字，请重点概括图片本身。'
  ].join('\n');

  // 并发分析：原本 for-of 串行下 5 张图 ≈ 5×VLM 延迟。
  // 现在分批并发，每批 VLM_CONCURRENCY 张（避免撞 MiniMax 限速），单图整体 race 25s 兜底。
  const analyzeOne = async (attachment) => {
    try {
      const analysis = await withTimeout(
        understandImage(prompt, attachment.localPath || attachment.url, {
          minimaxApiKey: options.minimaxApiKey,
          mimeType: attachment.mimeType
        }),
        PER_IMAGE_BUDGET_MS,
        `analyzeImage(${attachment.name || attachment.id || 'unknown'})`
      );
      return { ...attachment, analysis };
    } catch (error) {
      return { ...attachment, analysis: '', error: error.message };
    }
  };

  const results = [];
  for (let i = 0; i < attachments.length; i += VLM_CONCURRENCY) {
    const batch = attachments.slice(i, i + VLM_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(analyzeOne));
    results.push(...batchResults);
  }
  return results;
}

module.exports = {
  understandImage,
  analyzeAgentImages
};
