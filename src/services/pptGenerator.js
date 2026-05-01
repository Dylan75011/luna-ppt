// PPT 生成服务 - Puppeteer 截图方案
// 流程：HTML 模板 → Puppeteer 截图 → PptxGenJS 打包为 .pptx

const puppeteer = require('puppeteer');
const PptxGenJS = require('pptxgenjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../config');
const { renderToHtml, wrapForScreenshot } = require('./previewRenderer');
const { ensureFontsReady } = require('./slideDesigner/fonts');
const { measureOverflowingRegions, buildRegionHeightMap, compressPageForOverflows } = require('./slideDesigner/overflowGuard');
const { getRunAssetDir, getRunId, getConversationRunAssetDir, toOutputRelative, toAbsoluteUrl } = require('./outputPaths');
const { pruneRuns } = require('./outputRetention');
const { withTimeout, TimeoutError } = require('../utils/abortx');

// 单页截图整体超时：背景图死链 / 页面无限重定向 / GPU 卡顿都会被这层兜住。
// 超时的页跳过，不拖累整份 PPT。
const PER_PAGE_SCREENSHOT_BUDGET_MS = 25_000;

const PUPPETEER_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  // 关掉 hinting，让 macOS / Linux 渲染同一份 woff2 时字宽差异最小（之前
  // Mac/服务器排版漂移的主因之一）。配合内嵌 Inter+Noto Sans SC 已经能稳住像素级一致。
  '--font-render-hinting=none',
];

let _browser = null;
let _browserPromise = null;

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  // 并发 race 防护：N 个请求同时进来，只发起一次 launch
  if (_browserPromise) return _browserPromise;
  _browserPromise = puppeteer.launch({ headless: true, args: PUPPETEER_LAUNCH_ARGS })
    .then((browser) => {
      _browser = browser;
      // 浏览器进程崩溃 / 被 kill / OOM 时自动 reset，下次 getBrowser() 重建
      browser.on('disconnected', () => {
        if (_browser === browser) _browser = null;
      });
      return browser;
    })
    .catch((err) => {
      _browser = null;
      throw err;
    })
    .finally(() => {
      _browserPromise = null;
    });
  return _browserPromise;
}

async function closeBrowserSafely() {
  const browser = _browser;
  _browser = null;
  if (!browser) return;
  try { await browser.close(); } catch { /* 已断开 / 已关闭 */ }
}

// 进程退出/中断/未捕获异常时尽量关浏览器，避免遗留 zombie chromium 进程。
// 注册一次即可（模块单例），多次 require 不会重复挂同一个监听。
let _signalHandlersInstalled = false;
function installShutdownHandlers() {
  if (_signalHandlersInstalled) return;
  _signalHandlersInstalled = true;
  const teardown = () => { closeBrowserSafely().catch(() => {}); };
  process.once('exit', teardown);
  process.once('SIGINT', teardown);
  process.once('SIGTERM', teardown);
  // uncaughtException / unhandledRejection 不退出进程（交给上层框架处理），
  // 但浏览器若已和 node 进程脱节，下次 getBrowser 会自然重建。这里只做尽力关闭。
  process.on('uncaughtException', teardown);
  process.on('unhandledRejection', teardown);
}
installShutdownHandlers();

/**
 * 生成 PPTX 文件
 * @param {Object} templateData - { title, theme, pages }
 * @param {string} outputFilename - 输出文件名（可选）
 */
// 把单页 page 对象渲染成 HTML 片段（用于溢出重排时按需重新生成）。
function renderSinglePageHtml(pageData, theme) {
  const fragments = renderToHtml({ pages: [pageData], theme });
  return fragments[0] || '';
}

async function generatePPT(templateData, outputFilename = null, options = {}) {
  const pages = templateData.pages || [];
  const theme = templateData.theme || {};
  const runId = getRunId(options.runId || templateData.runId || outputFilename?.replace(/\.pptx$/i, '') || null);
  // 优先按 conversation 隔离临时输出，删会话时整目录可清理。没有 conversationId
  // 时（如离线脚本/迁移）退回旧 output/runs/<runId>/exports 路径，保持向后兼容。
  const conversationId = options.conversationId || templateData.conversationId || '';
  const outputDir = conversationId
    ? getConversationRunAssetDir(conversationId, runId, 'exports')
    : getRunAssetDir(runId, 'exports');

  // 并发安全：随机后缀，避免同毫秒并发任务共享 tempDir 互相覆盖/删除截图。
  const tempDir = path.join(os.tmpdir(), `oc_ppt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const screenshotPaths = [];

  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    // 使用 2x 设备像素比：CSS 960×540，实际截图 1920×1080（高清）
    await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 2 });

    for (let i = 0; i < pages.length; i++) {
      let pageData = pages[i];
      const bgImagePath = pageData?.bgImagePath || null;
      const screenshotPath = path.join(tempDir, `slide_${String(i).padStart(3, '0')}.png`);

      const loadPageHtml = async (data) => {
        const html = renderSinglePageHtml(data, theme);
        const fullHtml = wrapForScreenshot(html, bgImagePath);
        await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // 字体绝对到位再截图：显式 load 所有 (family, weight) 对，再等 document.fonts.ready。
        // 没这步会落入"document.fonts.ready 立即 resolve、字体却还没下载"的空白帧陷阱，
        // 导致 color:#fff 的标题在白底背景上不可见（fallback 没来得及切回）。
        await ensureFontsReady(page).catch(() => {});

        // 等背景图加载（若有）
        if (bgImagePath) {
          await page.waitForFunction(
            () => document.querySelectorAll('img').length === 0 ||
                  Array.from(document.querySelectorAll('img')).every(img => img.complete),
            { timeout: 5000 }
          ).catch(() => {});
        }

        // 让浏览器进入 idle 一帧再截：avoid FOUC + 等 transform/filter 应用
        await page.evaluate(() => new Promise((resolve) => {
          const cb = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
          if (typeof requestIdleCallback === 'function') requestIdleCallback(cb, { timeout: 200 });
          else setTimeout(cb, 16);
        })).catch(() => {});
      };

      const renderOnePage = async () => {
        await loadPageHtml(pageData);

        // 文本溢出度量：region 实际渲染高度 / 设计高度比 > 1.3，或 region 底部超出 slide 底边
        // → 触发压缩重排。只对 structured 页生效（有 data-region 属性），legacy layout 跳过。
        // 至多重排一次：避免压缩→再溢出→再压缩的抖动循环。
        try {
          const heightMap = buildRegionHeightMap(pageData);
          const overflows = await measureOverflowingRegions(page, heightMap);
          if (overflows.length) {
            console.warn(`[pptGenerator] 第 ${i + 1} 页 ${overflows.length} 个 region 溢出:`,
              overflows.map(o => `${o.regionName}(${o.actualHeight}/${o.designHeight}px)`).join(', '));
            const compressed = compressPageForOverflows(pageData, overflows);
            if (compressed !== pageData) {
              pageData = compressed;
              await loadPageHtml(pageData);
            }
          }
        } catch (err) {
          console.warn(`[pptGenerator] 第 ${i + 1} 页溢出检测失败（忽略，按原样截图）:`, err.message);
        }

        await page.screenshot({ path: screenshotPath, type: 'png' });
      };

      try {
        await withTimeout(renderOnePage(), PER_PAGE_SCREENSHOT_BUDGET_MS, `slide#${i}`);
        screenshotPaths.push(screenshotPath);
      } catch (err) {
        if (err instanceof TimeoutError) {
          console.warn(`[pptGenerator] 第 ${i} 页截图超时（${PER_PAGE_SCREENSHOT_BUDGET_MS}ms），跳过`);
          // 截图文件可能半成品，清掉避免被 PptxGenJS 引入
          try { fs.unlinkSync(screenshotPath); } catch {}
          continue;
        }
        throw err;
      }
    }

  } catch (err) {
    console.error('[pptGenerator] Puppeteer 截图失败:', err.message);
    // 关键：单次任务失败**不**关浏览器。多任务并发时浏览器是共享的，
    // 关浏览器会把其它正在跑的 page 一起干掉（"Session closed"）。
    // 真崩溃由 browser.on('disconnected') 兜底重置 _browser。
    throw err;
  } finally {
    // page 即使在循环异常时也必须关，否则浏览器进程里 frame 越积越多 → OOM
    if (page) {
      try { await page.close(); } catch { /* 浏览器已关 / 页面已断 */ }
    }
  }

  // ─── 打包 PPTX ────────────────────────────────────────────────────────────
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9'; // 10" × 5.625"
  pptx.author = 'Luna PPT';
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

  // 本次 run 产出完成后触发一次 runs 目录剪枝（不影响当前 run 的返回值）
  try { pruneRuns(); } catch (error) { console.warn('[pptGenerator] pruneRuns 失败:', error.message); }

  return {
    filename,
    filepath,
    runId,
    relativePath: toOutputRelative(filepath),
    path: toAbsoluteUrl(`/api/files/download/${toOutputRelative(filepath)}`)
  };
}

// 进程退出/信号清理已由 installShutdownHandlers() 统一注册（见上方）

// 保留原有 COLORS 导出，防止其他模块意外引用
const COLORS = {
  HUAWEI_RED: 'FA2F1F', DEEP_BLUE: '002D6B', DARK_BG: '0D1B2E',
  LIGHT_GRAY: 'F5F5F5', TEXT_DARK: '1A1A1A', TEXT_GRAY: '666666',
  ACCENT_BLUE: '007ACC', WHITE: 'FFFFFF'
};

module.exports = { generatePPT, COLORS };
