// 图片搜索与下载服务
const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const sharp  = require('sharp');
const config = require('../config');

// PPT 背景图目标尺寸（16:9，1920×1080 清晰度足够，文件体积可控）
const PPT_WIDTH  = 1920;
const PPT_HEIGHT = 1080;
const JPEG_QUALITY = 82;  // 82% JPEG：清晰且体积适中（约 200-500 KB）

/**
 * 搜索 Pexels 图片
 * 返回的 url 已附加 CDN 尺寸参数（1920×1080 裁切+压缩），下载即可直接用于 PPT
 */
async function searchPexels(query, options = {}) {
  const { perPage = 4 } = options;
  const apiKey = config.pexelsApiKey;
  if (!apiKey) return [];

  const qs = new URLSearchParams({
    query,
    orientation: 'landscape',
    size: 'large',
    per_page: String(perPage)
  });
  const url = `https://api.pexels.com/v1/search?${qs}`;

  return new Promise(resolve => {
    const req = https.get(url, { headers: { Authorization: apiKey } }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          resolve((json.photos || []).map(p => {
            // 使用 original（或 large2x 作保底）去掉原有 CDN 参数，
            // 换成精确 1920×1080 裁切 + 压缩参数，让 Pexels Imgix CDN 处理
            const base = (p.src.original || p.src.large2x || p.src.large).split('?')[0];
            const cdnUrl = `${base}?auto=compress&cs=tinysrgb&fit=crop&w=${PPT_WIDTH}&h=${PPT_HEIGHT}`;
            return {
              id:              p.id,
              url:             cdnUrl,
              thumb:           p.src.medium,
              photographer:    p.photographer,
              photographerUrl: p.photographer_url
            };
          }));
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(8000, () => { req.destroy(); resolve([]); });
  });
}

/**
 * 下载远程图片到本地（支持重定向）
 */
async function downloadImage(remoteUrl, localPath) {
  const dir = path.dirname(localPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return new Promise((resolve, reject) => {
    const proto = remoteUrl.startsWith('https') ? https : http;
    const file  = fs.createWriteStream(localPath);
    proto.get(remoteUrl, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(localPath, () => {});
        return downloadImage(res.headers.location, localPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(localPath); });
      file.on('error', err => { fs.unlink(localPath, () => {}); reject(err); });
    }).on('error', err => { fs.unlink(localPath, () => {}); reject(err); });
  });
}

/**
 * 将本地图片处理为 PPT 背景图规格
 * - 尺寸：1920×1080（cover 模式裁切，不留黑边）
 * - 格式：JPEG，quality=82（清晰度与体积的最佳平衡点）
 * - 对于 Pexels 图：已由 CDN 处理为 1920×1080，此处再过一遍 sharp 确保格式统一
 * - 对于 AI 生成图：尺寸不可控，必须经此处理
 */
async function processImageForPpt(localPath) {
  const tmpPath = localPath + '.tmp.jpg';
  try {
    const meta = await sharp(localPath).metadata();
    const sizeMB = (fs.statSync(localPath).size / 1024 / 1024).toFixed(1);
    console.log(`[imageSearch] 处理前：${meta.width}×${meta.height} ${sizeMB}MB  ${path.basename(localPath)}`);

    await sharp(localPath)
      .resize(PPT_WIDTH, PPT_HEIGHT, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(tmpPath);

    // 替换原文件
    fs.renameSync(tmpPath, localPath);

    const newSize = (fs.statSync(localPath).size / 1024 / 1024).toFixed(1);
    console.log(`[imageSearch] 处理后：${PPT_WIDTH}×${PPT_HEIGHT} ${newSize}MB  ${path.basename(localPath)}`);
  } catch (err) {
    console.warn('[imageSearch] sharp 处理失败，保留原图:', err.message);
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

/**
 * 调用 MiniMax image-01 生成图片
 * @returns {Promise<string|null>} 图片 URL（24h 有效，需立即下载）
 */
async function generateMiniMaxImage(prompt, apiKey) {
  if (!apiKey) return null;
  const body = JSON.stringify({
    model: 'image-01',
    prompt,
    aspect_ratio: '16:9',
    n: 1,
    response_format: 'url'
  });

  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.minimaxi.com',
      path:     '/v1/image_generation',
      method:   'POST',
      headers: {
        Authorization:    `Bearer ${apiKey}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          resolve(json.data?.image_urls?.[0] || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

module.exports = { searchPexels, downloadImage, processImageForPpt, generateMiniMaxImage };
