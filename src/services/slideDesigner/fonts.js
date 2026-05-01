// 字体内嵌：避免 Puppeteer 容器/Linux 服务器缺 Inter/SF Pro/Geist 时回退到 system-ui，
// 导致同一份 PPT 在不同机器上字宽差 5-15%、region 边界溢出/换行不一致。
//
// 启动时一次性读 woff2 → base64，导出 FONT_FACE_CSS 字符串供 wrapForScreenshot 注入。
// 只 ship 必要字重（400/500/700/800），覆盖所有 sc-block 的 weight 取值。

const fs = require('fs');
const path = require('path');

const FONTS_TO_LOAD = [
  // Inter（西文/数字）
  { family: 'Inter', weight: 400, file: '@fontsource/inter/files/inter-latin-400-normal.woff2' },
  { family: 'Inter', weight: 500, file: '@fontsource/inter/files/inter-latin-500-normal.woff2' },
  { family: 'Inter', weight: 700, file: '@fontsource/inter/files/inter-latin-700-normal.woff2' },
  { family: 'Inter', weight: 800, file: '@fontsource/inter/files/inter-latin-800-normal.woff2' },
  // Noto Sans SC（中文）
  { family: 'Noto Sans SC', weight: 400, file: '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2' },
  { family: 'Noto Sans SC', weight: 500, file: '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-500-normal.woff2' },
  { family: 'Noto Sans SC', weight: 700, file: '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff2' },
  { family: 'Noto Sans SC', weight: 800, file: '@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-800-normal.woff2' },
];

function buildFontFaceCss() {
  const nodeModules = path.resolve(__dirname, '../../../node_modules');
  const blocks = [];
  const loaded = [];
  for (const { family, weight, file } of FONTS_TO_LOAD) {
    const fullPath = path.join(nodeModules, file);
    try {
      const buf = fs.readFileSync(fullPath);
      const b64 = buf.toString('base64');
      // 不用 font-display:block。block 让 UA 把字体当作"按需加载"，
      // 文档没真的提到这个字重就不会发起加载，document.fonts.ready 立即 resolve，
      // 截图截到的是字体到位前的空白帧。这里用默认（auto）配合 ensureFontsReady
      // 在截图前显式 load 所有 (family, weight) 对，确保字体真到位再截。
      blocks.push(`@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format("woff2");}`);
      loaded.push({ family, weight });
    } catch (err) {
      console.warn(`[slideDesigner/fonts] 字体加载失败: ${file} (${err.message})`);
    }
  }
  return { css: blocks.join('\n'), loaded };
}

const { css: FONT_FACE_CSS, loaded: LOADED_FONTS } = buildFontFaceCss();

// 注意：用单引号包裹字族名。这个字符串会以 inline style 形式注入 HTML 属性
// （style="...--font-display:'Inter','Noto Sans SC'..."）。如果用双引号，会和 style="..."
// 属性外层双引号冲突，导致整个 inline style 在第一个 " 处被截断，背景/布局全错。
const FONT_STACK = "'Inter','Noto Sans SC','PingFang SC',system-ui,sans-serif";

// 在 puppeteer page 上下文里执行：显式 load 所有声明的 (family, weight) 对，
// 再等 document.fonts.ready，确保截图前字体绝对到位。
// 序列化成函数体而不是字符串，避免拼接错引号。
async function ensureFontsReady(page) {
  await page.evaluate(async (fonts) => {
    if (!document.fonts) return;
    // 触发每个 (family, weight) 对的实际下载
    await Promise.all(fonts.map(({ family, weight }) =>
      document.fonts.load(`${weight} 16px "${family}"`).catch(() => null)
    ));
    await document.fonts.ready;
  }, LOADED_FONTS);
}

module.exports = { FONT_FACE_CSS, FONT_STACK, LOADED_FONTS, ensureFontsReady };
