#!/usr/bin/env node
// 视觉回归 runner：把 3 套 fixture 喂给 generatePPT，截图与 baselines/ 比较。
//
// 用法：
//   node tests/visual-regression/run.js              # 比对模式：与 baseline 对照
//   node tests/visual-regression/run.js --update     # baseline 模式：覆盖 baseline
//   node tests/visual-regression/run.js short        # 只跑 short fixture
//
// 像素 diff 用 sharp（已是项目依赖），不引新 npm。每像素 RGB 通道差之和 > 24 算"异常像素"，
// 异常像素占比 > 1% 视为回归 fail。

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const FIXTURES = ['short', 'long', 'extreme'];
const BASELINE_DIR = path.join(__dirname, 'baselines');
const OUTPUT_DIR = path.join(__dirname, 'output');
const PIXEL_DIFF_THRESHOLD = 24; // RGB 三通道差和阈值
const ALLOWED_DIFF_RATIO = 0.01; // 允许 1% 像素差异（抗 hinting/抗锯齿微抖）

function log(level, msg) {
  const tag = { info: '✓', warn: '!', fail: '✗' }[level] || '·';
  console.log(`${tag} ${msg}`);
}

async function diffImages(baselinePath, currentPath) {
  // 用 sharp 抽 raw RGB；两图必须同尺寸（生成都是 1920×1080）
  const [a, b] = await Promise.all([
    sharp(baselinePath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(currentPath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    return { same: false, ratio: 1, reason: `dimension mismatch: ${a.info.width}x${a.info.height} vs ${b.info.width}x${b.info.height}` };
  }
  const total = a.info.width * a.info.height;
  let diffCount = 0;
  for (let i = 0; i < a.data.length; i += 3) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (dr + dg + db > PIXEL_DIFF_THRESHOLD) diffCount++;
  }
  const ratio = diffCount / total;
  return { same: ratio <= ALLOWED_DIFF_RATIO, ratio, diffCount, total };
}

async function extractSlideScreenshotsFromPptxBuild(fixtureName, fixture, screenshotDir) {
  // generatePPT 把每页截图存到临时目录，打包后清掉。我们把它的 tempDir 暴露需要 patch。
  // 简单做法：复用 puppeteer 自己截一遍，跟 generatePPT 同样的链路（renderToHtml + wrapForScreenshot
  // + ensureFontsReady + overflowGuard），不去走 pptx 打包。这样 baseline 只对"PPT 看起来啥样"负责。
  const puppeteer = require('puppeteer');
  const { renderToHtml, wrapForScreenshot } = require('../../src/services/previewRenderer');
  const { ensureFontsReady } = require('../../src/services/slideDesigner/fonts');
  const {
    measureOverflowingRegions,
    buildRegionHeightMap,
    compressPageForOverflows,
  } = require('../../src/services/slideDesigner/overflowGuard');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 2 });
    fs.mkdirSync(screenshotDir, { recursive: true });
    const paths = [];

    for (let i = 0; i < fixture.pages.length; i++) {
      let pageData = fixture.pages[i];
      const bgImagePath = pageData?.bgImagePath || null;
      const screenshotPath = path.join(screenshotDir, `slide-${String(i).padStart(2, '0')}.png`);

      const loadHtml = async (data) => {
        const html = renderToHtml({ pages: [data], theme: fixture.theme })[0];
        const fullHtml = wrapForScreenshot(html, bgImagePath);
        await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await ensureFontsReady(page).catch(() => {});
        await page.evaluate(() => new Promise((resolve) => {
          const cb = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
          if (typeof requestIdleCallback === 'function') requestIdleCallback(cb, { timeout: 200 });
          else setTimeout(cb, 16);
        })).catch(() => {});
      };

      await loadHtml(pageData);

      // 同 pptGenerator 的 overflow guard 流程，让 baseline 反映真实生产链路
      try {
        const overflows = await measureOverflowingRegions(page, buildRegionHeightMap(pageData));
        if (overflows.length) {
          const compressed = compressPageForOverflows(pageData, overflows);
          if (compressed !== pageData) {
            pageData = compressed;
            await loadHtml(pageData);
          }
        }
      } catch (err) {
        log('warn', `${fixtureName} slide#${i} overflow probe failed: ${err.message}`);
      }

      await page.screenshot({ path: screenshotPath, type: 'png' });
      paths.push(screenshotPath);
    }
    return paths;
  } finally {
    await browser.close();
  }
}

async function runFixture(name, mode) {
  const fixture = require(`./fixtures/${name}`);
  const baselineDir = path.join(BASELINE_DIR, name);
  const currentDir = path.join(OUTPUT_DIR, name);

  log('info', `${name}: 渲染 ${fixture.pages.length} 页 ...`);
  fs.rmSync(currentDir, { recursive: true, force: true });
  const screenshotPaths = await extractSlideScreenshotsFromPptxBuild(name, fixture, currentDir);

  if (mode === 'update') {
    fs.rmSync(baselineDir, { recursive: true, force: true });
    fs.mkdirSync(baselineDir, { recursive: true });
    for (const p of screenshotPaths) {
      const b = path.join(baselineDir, path.basename(p));
      fs.copyFileSync(p, b);
    }
    log('info', `${name}: baseline 已更新 (${screenshotPaths.length} 页)`);
    return { name, status: 'updated', count: screenshotPaths.length };
  }

  if (!fs.existsSync(baselineDir)) {
    log('fail', `${name}: 没有 baseline。先跑 \`node tests/visual-regression/run.js --update\` 建立 baseline`);
    return { name, status: 'no-baseline' };
  }

  let pass = 0, fail = 0;
  const fails = [];
  for (const currentPath of screenshotPaths) {
    const baselinePath = path.join(baselineDir, path.basename(currentPath));
    if (!fs.existsSync(baselinePath)) {
      fails.push({ slide: path.basename(currentPath), reason: 'baseline missing' });
      fail++;
      continue;
    }
    const r = await diffImages(baselinePath, currentPath);
    if (r.same) pass++;
    else {
      fail++;
      fails.push({ slide: path.basename(currentPath), ratio: r.ratio?.toFixed(4), reason: r.reason });
    }
  }
  if (fail) {
    log('fail', `${name}: ${pass}/${screenshotPaths.length} 通过, ${fail} 个有显著差异:`);
    fails.forEach(f => console.log(`    - ${f.slide}: ratio=${f.ratio || 'n/a'} ${f.reason || ''}`));
  } else {
    log('info', `${name}: ${pass}/${screenshotPaths.length} 通过`);
  }
  return { name, status: fail ? 'fail' : 'pass', pass, fail, fails };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--update') ? 'update' : 'check';
  const which = args.filter(a => !a.startsWith('--'));
  const targets = which.length ? which.filter(n => FIXTURES.includes(n)) : FIXTURES;
  if (!targets.length) {
    console.error(`未知 fixture，可选: ${FIXTURES.join(', ')}`);
    process.exit(2);
  }

  const results = [];
  for (const name of targets) {
    results.push(await runFixture(name, mode));
  }

  if (mode === 'check') {
    const fails = results.filter(r => r.status === 'fail' || r.status === 'no-baseline');
    if (fails.length) {
      console.log(`\n回归测试失败：${fails.length}/${results.length} 套 fixture 有问题`);
      process.exit(1);
    }
    console.log(`\n全部 ${results.length} 套 fixture 通过`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
