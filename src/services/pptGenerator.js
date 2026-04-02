// PPT 生成服务 - Puppeteer 截图方案
// 流程：HTML 模板 → Puppeteer 截图 → PptxGenJS 打包为 .pptx

const puppeteer = require('puppeteer');
const PptxGenJS = require('pptxgenjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../config');
const { renderToHtml, wrapForScreenshot } = require('./previewRenderer');

let _browser = null;

async function getBrowser() {
  if (!_browser || !_browser.connected) {
    _browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });
  }
  return _browser;
}

/**
 * 生成 PPTX 文件
 * @param {Object} templateData - { title, theme, pages }
 * @param {string} outputFilename - 输出文件名（可选）
 */
async function generatePPT(templateData, outputFilename = null) {
  const htmlFragments = renderToHtml(templateData);
  const pages = templateData.pages || [];

  const outputDir = path.resolve(config.outputDir);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const tempDir = path.join(os.tmpdir(), `oc_ppt_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const screenshotPaths = [];

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    // 使用 2x 设备像素比：CSS 960×540，实际截图 1920×1080（高清）
    await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 2 });

    for (let i = 0; i < htmlFragments.length; i++) {
      const bgImagePath = pages[i]?.bgImagePath || null;
      const fullHtml = wrapForScreenshot(htmlFragments[i], bgImagePath);

      await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 15000 });

      // 等背景图加载（若有）
      if (bgImagePath) {
        await page.waitForFunction(
          () => document.querySelectorAll('img').length === 0 ||
                Array.from(document.querySelectorAll('img')).every(img => img.complete),
          { timeout: 5000 }
        ).catch(() => {});
      }

      const screenshotPath = path.join(tempDir, `slide_${String(i).padStart(3, '0')}.png`);
      await page.screenshot({ path: screenshotPath, type: 'png' });
      screenshotPaths.push(screenshotPath);
    }

    await page.close();
  } catch (err) {
    console.error('[pptGenerator] Puppeteer 截图失败:', err.message);
    // 浏览器实例可能损坏，下次重建
    _browser = null;
    throw err;
  }

  // ─── 打包 PPTX ────────────────────────────────────────────────────────────
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9'; // 10" × 5.625"
  pptx.author = 'OpenClaw PPT';
  pptx.title = templateData.title || 'PPT Document';

  for (const screenshotPath of screenshotPaths) {
    const slide = pptx.addSlide();
    slide.addImage({
      path: screenshotPath,
      x: 0, y: 0, w: 10, h: 5.625
    });
  }

  const filename = outputFilename || `ppt_${Date.now()}.pptx`;
  const filepath = path.join(outputDir, filename);
  await pptx.writeFile({ fileName: filepath });

  // 清理临时截图
  screenshotPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
  try { fs.rmdirSync(tempDir); } catch {}

  console.log(`[pptGenerator] 生成完成: ${filename}（${screenshotPaths.length} 页）`);

  return {
    filename,
    filepath,
    path: `/api/files/download/${filename}`
  };
}

// 进程退出时关闭 Puppeteer 浏览器，释放内存
process.on('exit', () => { if (_browser) _browser.close().catch(() => {}); });
process.on('SIGTERM', () => { if (_browser) _browser.close().catch(() => {}); });

// 保留原有 COLORS 导出，防止其他模块意外引用
const COLORS = {
  HUAWEI_RED: 'FA2F1F', DEEP_BLUE: '002D6B', DARK_BG: '0D1B2E',
  LIGHT_GRAY: 'F5F5F5', TEXT_DARK: '1A1A1A', TEXT_GRAY: '666666',
  ACCENT_BLUE: '007ACC', WHITE: 'FFFFFF'
};

module.exports = { generatePPT, COLORS };
