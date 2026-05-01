// PPT JSON → HTML 幻灯片片段
// SLIDE_CSS 同时被 wrapForScreenshot() 和 SlideViewer.vue 的 SLIDE_STYLES 使用（保持一致）
// 支持两种格式：旧版 page.type + 新版 page.layout (来自 slideDesigner)

const fs = require('fs');
const { renderAllSlides: designerRender, SLIDE_CSS: designerCSS } = require('./slideDesigner');
const { FONT_FACE_CSS } = require('./slideDesigner/fonts');
const path = require('path');
const { toOutputUrl } = require('./outputPaths');

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeImageUrl(imagePath) {
  if (!imagePath) return '';
  if (typeof imagePath === 'object') {
    imagePath = imagePath.localPath || imagePath.path || imagePath.url || '';
  }
  imagePath = String(imagePath || '').trim();
  if (!imagePath) return '';
  if (imagePath.startsWith('/output/')) return imagePath;
  if (path.isAbsolute(imagePath)) {
    return toOutputUrl(imagePath);
  }
  return imagePath;
}

function buildImageDataUrl(imagePath) {
  if (typeof imagePath === 'object') {
    imagePath = imagePath.localPath || imagePath.path || imagePath.url || '';
  }
  imagePath = String(imagePath || '').trim();
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === '.png'
    ? 'image/png'
    : ext === '.webp'
      ? 'image/webp'
      : 'image/jpeg';
  const base64 = fs.readFileSync(imagePath).toString('base64');
  return `data:${mime};base64,${base64}`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
// 注意：此处是 "源" CSS，SlideViewer.vue 里的 SLIDE_STYLES 需与此保持同步
const SLIDE_CSS = `
*,*::before,*::after{box-sizing:border-box}*{margin:0;padding:0}
.slide{width:960px;height:540px;position:relative;overflow:hidden;font-family:'PingFang SC','Noto Sans SC','Microsoft YaHei',system-ui,sans-serif;-webkit-font-smoothing:antialiased;background-color:#fff;color:#1A1A1A}

/* COVER */
.slide-cover{background-color:var(--secondary,#0F172A);display:flex;align-items:center}
.cover-accent{position:absolute;left:0;top:0;width:8px;height:100%;background-color:var(--primary,#2563EB);z-index:2}
.cover-deco{position:absolute;right:-60px;top:-80px;width:300px;height:300px;border-radius:50%;background-color:var(--primary,#2563EB);opacity:.07}
.cover-deco2{position:absolute;right:60px;bottom:-100px;width:200px;height:200px;border-radius:50%;background-color:var(--primary,#2563EB);opacity:.04}
.cover-content{position:relative;z-index:2;padding:0 72px 0 88px}
.cover-tag{display:inline-block;padding:3px 10px;background-color:var(--primary,#2563EB);color:#fff;font-size:11px;font-weight:600;border-radius:3px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:18px}
.cover-title{font-size:52px;font-weight:800;color:#fff;line-height:1.15;letter-spacing:-.02em;margin-bottom:12px}
.cover-subtitle{font-size:20px;font-weight:400;color:rgba(255,255,255,.72);line-height:1.5;margin-bottom:28px}
.cover-divider{width:44px;height:3px;background-color:var(--primary,#2563EB);margin-bottom:14px}
.cover-meta{font-size:13px;color:rgba(255,255,255,.45);letter-spacing:.04em}
.cover-brand{position:absolute;right:40px;bottom:26px;font-size:12px;color:rgba(255,255,255,.35);z-index:2}

/* TOC */
.slide-toc{background-color:#fff;display:flex}
.toc-sidebar{width:248px;flex-shrink:0;background-color:var(--primary,#2563EB);display:flex;flex-direction:column;justify-content:center;padding:48px 36px}
.toc-label{font-size:11px;font-weight:600;color:rgba(255,255,255,.55);letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px}
.toc-main-title{font-size:42px;font-weight:800;color:#fff;line-height:1.1}
.toc-sidebar-line{width:32px;height:2px;background-color:rgba(255,255,255,.3);margin-top:18px}
.toc-content{flex:1;display:flex;align-items:center;padding:40px 52px}
.toc-grid{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:8px 40px}
.toc-item{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #F1F5F9}
.toc-num{font-size:18px;font-weight:800;color:var(--primary,#2563EB);opacity:.75;min-width:30px;line-height:1}
.toc-text{font-size:14px;font-weight:500;color:var(--secondary,#1E293B);line-height:1.4}

/* SHARED: topbar + header + heading */
.slide-topbar{height:4px;background-color:var(--primary,#2563EB);flex-shrink:0}
.slide-header{padding:16px 48px 14px;background-color:#fff;border-bottom:1px solid #E2E8F0;flex-shrink:0}
.slide-heading{font-size:22px;font-weight:700;color:var(--secondary,#1E293B);line-height:1.2;padding-left:12px;border-left:3px solid var(--primary,#2563EB)}
.slide-heading .section-num{color:var(--primary,#2563EB);margin-right:8px}

/* CONTENT */
.slide-content{background-color:#F8FAFC;display:flex;flex-direction:column}
.content-sections{flex:1;display:flex;gap:12px;padding:12px 48px;min-height:0;overflow:hidden}
.content-card{flex:1;background-color:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.07),0 1px 2px rgba(0,0,0,.04);padding:14px 16px}
.content-card-title{font-size:13px;font-weight:700;color:var(--primary,#2563EB);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #F1F5F9}
.content-card-list{list-style:none;display:flex;flex-direction:column;gap:5px}
.content-card-list li{font-size:12px;color:#475569;line-height:1.5;padding-left:12px;position:relative}
.content-card-list li::before{content:'';position:absolute;left:0;top:7px;width:4px;height:4px;background-color:var(--primary,#2563EB);border-radius:50%;opacity:.5}
.kpi-row{padding:10px 48px;background-color:#fff;border-top:1px solid #E2E8F0;display:flex;gap:12px;flex-shrink:0}
.kpi-item{flex:1;background-color:var(--primary,#2563EB);border-radius:7px;padding:10px 14px;text-align:center}
.kpi-value{font-size:24px;font-weight:800;color:#fff;line-height:1;margin-bottom:3px}
.kpi-label{font-size:11px;color:rgba(255,255,255,.75)}

/* TWO COLUMN */
.slide-two-column{background-color:#F8FAFC;display:flex;flex-direction:column}
.columns-row{flex:1;display:flex;gap:12px;padding:12px 48px;min-height:0;overflow:hidden}
.col-card{flex:1;background-color:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.07);display:flex;flex-direction:column}
.col-header{background-color:var(--secondary,#1E293B);color:#fff;font-size:14px;font-weight:700;padding:10px 16px;text-align:center;flex-shrink:0}
.col-list{list-style:none;padding:12px 16px;flex:1;overflow:hidden}
.col-list li{font-size:12px;color:#334155;padding:4px 0 4px 13px;position:relative;border-bottom:1px solid #F8FAFC;line-height:1.5}
.col-list li::before{content:'•';position:absolute;left:0;color:var(--primary,#2563EB)}

/* CARDS */
.slide-cards{background-color:#fff;display:flex;flex-direction:column}
.cards-row{flex:1;display:flex;gap:12px;padding:12px 48px;min-height:0}
.card{flex:1;background-color:#F8FAFC;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);display:flex;flex-direction:column}
.card-header{background-color:var(--secondary,#1E293B);padding:14px 16px;display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0}
.card-icon{font-size:22px}
.card-title{font-size:14px;font-weight:700;color:#fff;text-align:center}
.card-tag{font-size:10px;color:rgba(255,255,255,.55)}
.card-desc{font-size:11px;color:#64748B;padding:8px 12px 0;text-align:center;line-height:1.4}
.card-price{font-size:14px;font-weight:700;color:var(--primary,#2563EB);padding:6px 12px 0;text-align:center}
.card-features{list-style:none;padding:8px 12px;flex:1;overflow:hidden}
.card-features li{font-size:11px;color:#475569;padding:2px 0 2px 12px;position:relative;line-height:1.4}
.card-features li::before{content:'';position:absolute;left:0;top:7px;width:4px;height:4px;background-color:var(--primary,#2563EB);border-radius:50%}

/* TIMELINE */
.slide-timeline{background-color:#F8FAFC;display:flex;flex-direction:column}
.timeline-row{flex:1;display:flex;gap:8px;padding:12px 48px;min-height:0;overflow-x:auto}
.timeline-phase{flex:1;min-width:120px;display:flex;flex-direction:column;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.07)}
.phase-date{background-color:var(--secondary,#1E293B);color:#fff;font-size:12px;font-weight:700;padding:7px 8px;text-align:center;flex-shrink:0}
.phase-name{background-color:var(--primary,#2563EB);color:#fff;font-size:11px;font-weight:600;padding:5px 8px;text-align:center;flex-shrink:0}
.phase-tasks{background-color:#fff;flex:1;list-style:none;padding:8px 10px;overflow:hidden}
.phase-tasks li{font-size:11px;color:#334155;padding:3px 0 3px 10px;position:relative;line-height:1.4}
.phase-tasks li::before{content:'•';position:absolute;left:0;color:var(--primary,#2563EB)}

/* END */
.slide-end{background-color:var(--secondary,#0F172A);display:flex;flex-direction:column;align-items:center;justify-content:center}
.end-topbar{position:absolute;top:0;left:0;right:0;height:4px;background-color:var(--primary,#2563EB)}
.end-corner{position:absolute;left:-80px;bottom:-80px;width:300px;height:300px;background-color:var(--primary,#2563EB);border-radius:50%;opacity:.06}
.end-corner2{position:absolute;right:-40px;top:-60px;width:200px;height:200px;background-color:var(--primary,#2563EB);border-radius:50%;opacity:.04}
.end-content{position:relative;z-index:1;text-align:center;padding:0 80px}
.end-title{font-size:50px;font-weight:800;color:#fff;line-height:1.2;margin-bottom:14px}
.end-sub{font-size:18px;font-weight:400;color:rgba(255,255,255,.62);margin-bottom:12px;line-height:1.5}
.end-brand{font-size:13px;color:rgba(255,255,255,.35)}
.end-contact{font-size:12px;color:rgba(255,255,255,.4);margin-top:8px}
`;

// ─── HTML 渲染函数 ────────────────────────────────────────────────────────────

function renderCover(page, vars) {
  return `<div class="slide slide-cover" style="${vars}">
    <div class="cover-accent"></div>
    <div class="cover-deco"></div>
    <div class="cover-deco2"></div>
    <div class="cover-content">
      ${page.brand ? `<div class="cover-tag">${esc(page.brand)}</div>` : ''}
      <h1 class="cover-title">${esc(page.mainTitle || page.title)}</h1>
      ${page.subtitle ? `<p class="cover-subtitle">${esc(page.subtitle)}</p>` : ''}
      <div class="cover-divider"></div>
      ${(page.date || page.location) ? `<p class="cover-meta">${esc([page.date, page.location].filter(Boolean).join(' · '))}</p>` : ''}
    </div>
    ${page.brand ? `<div class="cover-brand">${esc(page.brand)}</div>` : ''}
  </div>`;
}

function renderToc(page, vars) {
  const items = page.items || [];
  const itemsHtml = items.map((item, i) => `
    <div class="toc-item">
      <span class="toc-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="toc-text">${esc(item.title || item)}</span>
    </div>`).join('');
  return `<div class="slide slide-toc" style="${vars}">
    <div class="toc-sidebar">
      <div class="toc-label">Contents</div>
      <div class="toc-main-title">目录</div>
      <div class="toc-sidebar-line"></div>
    </div>
    <div class="toc-content">
      <div class="toc-grid">${itemsHtml}</div>
    </div>
  </div>`;
}

function renderContent(page, vars) {
  const heading = page.sectionNum
    ? `<span class="section-num">${esc(page.sectionNum)}</span>${esc(page.title)}`
    : esc(page.title);

  const sectionsHtml = (page.sections || []).map(s => `
    <div class="content-card">
      <div class="content-card-title">${esc(s.title)}</div>
      <ul class="content-card-list">
        ${(s.content || []).map(c => `<li>${esc(c)}</li>`).join('')}
      </ul>
    </div>`).join('');

  const kpisHtml = (page.kpis || []).map(k => `
    <div class="kpi-item">
      <div class="kpi-value">${esc(k.value)}</div>
      <div class="kpi-label">${esc(k.label)}</div>
    </div>`).join('');

  return `<div class="slide slide-content" style="${vars}">
    <div class="slide-topbar"></div>
    <div class="slide-header"><h2 class="slide-heading">${heading}</h2></div>
    <div class="content-sections">${sectionsHtml}</div>
    ${kpisHtml ? `<div class="kpi-row">${kpisHtml}</div>` : ''}
  </div>`;
}

function renderTwoColumn(page, vars) {
  const columns = page.columns || (page.left && page.right
    ? [{ title: page.left.title, items: page.left.points || page.left.items || [] },
       { title: page.right.title, items: page.right.points || page.right.items || [] }]
    : []);

  const colsHtml = columns.map(col => `
    <div class="col-card">
      <div class="col-header">${esc(col.title)}</div>
      <ul class="col-list">
        ${(col.items || []).map(item => `<li>${esc(item)}</li>`).join('')}
      </ul>
    </div>`).join('');

  return `<div class="slide slide-two-column" style="${vars}">
    <div class="slide-topbar"></div>
    <div class="slide-header"><h2 class="slide-heading">${esc(page.title)}</h2></div>
    <div class="columns-row">${colsHtml}</div>
  </div>`;
}

function renderCards(page, vars) {
  const cardsHtml = (page.cards || []).map(card => `
    <div class="card">
      <div class="card-header">
        ${card.icon ? `<span class="card-icon">${esc(card.icon)}</span>` : ''}
        <span class="card-title">${esc(card.title)}</span>
        ${card.tag ? `<span class="card-tag">${esc(card.tag)}</span>` : ''}
      </div>
      ${card.description ? `<p class="card-desc">${esc(card.description)}</p>` : ''}
      ${card.price ? `<p class="card-price">${esc(card.price)}</p>` : ''}
      <ul class="card-features">
        ${(card.features || []).map(f => `<li>${esc(f)}</li>`).join('')}
      </ul>
    </div>`).join('');

  return `<div class="slide slide-cards" style="${vars}">
    <div class="slide-topbar"></div>
    <div class="slide-header"><h2 class="slide-heading">${esc(page.title)}</h2></div>
    <div class="cards-row">${cardsHtml}</div>
  </div>`;
}

function renderTimeline(page, vars) {
  const phasesHtml = (page.phases || []).map(phase => `
    <div class="timeline-phase">
      <div class="phase-date">${esc(phase.month || phase.date || phase.phase)}</div>
      <div class="phase-name">${esc(phase.name || phase.title)}</div>
      <ul class="phase-tasks">
        ${(phase.tasks || []).map(t => `<li>${esc(t)}</li>`).join('')}
      </ul>
    </div>`).join('');

  return `<div class="slide slide-timeline" style="${vars}">
    <div class="slide-topbar"></div>
    <div class="slide-header"><h2 class="slide-heading">${esc(page.title)}</h2></div>
    <div class="timeline-row">${phasesHtml}</div>
  </div>`;
}

function renderEnd(page, vars) {
  return `<div class="slide slide-end" style="${vars}">
    <div class="end-topbar"></div>
    <div class="end-corner"></div>
    <div class="end-corner2"></div>
    <div class="end-content">
      <h1 class="end-title">${esc(page.mainText || '感谢观看')}</h1>
      ${page.subText ? `<p class="end-sub">${esc(page.subText)}</p>` : ''}
      ${page.brand ? `<p class="end-brand">${esc(page.brand)}</p>` : ''}
      ${page.contact ? `<p class="end-contact">${esc(page.contact)}</p>` : ''}
    </div>
  </div>`;
}

// ─── 公共导出 ─────────────────────────────────────────────────────────────────

/**
 * 将 PPT JSON 转为 HTML 片段数组（供 SlideViewer iframe 使用）
  */
function renderToHtml(pptData) {
  const theme = pptData.theme || {};
  const primary   = '#' + (theme.primary   || '2563EB').replace('#', '');
  const secondary = '#' + (theme.secondary || '1E293B').replace('#', '');

  const pages = pptData.pages || [];

  // 如果有 page.layout，说明是新格式，用 slideDesigner 渲染
  if (pages.some(p => p.layout)) {
    try {
      const mappedPages = pages.map(p => {
        const pageContent = p.content || {};
        return {
          ...p,
          layout: p.layout || p.type,
          style: p.style || theme.globalStyle || 'dark_tech',
          title: p.title || pageContent.title || p.mainTitle || p.topic || '',
          subtitle: p.subtitle || pageContent.subtitle || '',
          mainTitle: p.mainTitle || pageContent.mainTitle || p.title || '',
          brand: p.brand || theme.brand || '',
          date: p.date || theme.date || '',
          location: p.location || '',
          bgImagePath: normalizeImageUrl(p.bgImagePath || ''),
          ...pageContent,
        };
      });
      return designerRender({
        pages: mappedPages,
        globalStyle: theme.globalStyle || 'dark_tech',
        theme: {
          primary,
          secondary,
          brand: theme.brand || '',
          date: theme.date || '',
          bgImage: theme.bgImage || '',
          globalStyle: theme.globalStyle || 'dark_tech',
          visualStyle: theme.visualStyle || 'gradient_overlay',
        },
      });
    } catch (e) {
      console.warn('[renderToHtml] slideDesigner failed, falling back to legacy render:', e.message);
    }
  }

  // 旧格式：使用 legacy render functions
  return pages.map(page => {
    let bgStyle = '';
    if (page.bgImagePath) {
      const imageUrl = normalizeImageUrl(page.bgImagePath);
      bgStyle = `background-image:url('${imageUrl}');background-size:cover;background-position:center;`;
    }
    const vars = `--primary:${primary};--secondary:${secondary};${bgStyle}`;

    let html;
    switch (page.type) {
      case 'cover':      html = renderCover(page, vars);      break;
      case 'toc':        html = renderToc(page, vars);        break;
      case 'content':    html = renderContent(page, vars);    break;
      case 'two_column': html = renderTwoColumn(page, vars);  break;
      case 'cards':      html = renderCards(page, vars);      break;
      case 'timeline':   html = renderTimeline(page, vars);   break;
      case 'end':        html = renderEnd(page, vars);        break;
      default:           html = renderContent({ ...page, type: 'content' }, vars);
    }

    // 背景图时叠加半透明遮罩
    if (page.bgImagePath) {
      html = html.replace(/(<div class="slide[^"]*"[^>]*>)/,
        '$1<div style="position:absolute;inset:0;background:rgba(0,0,0,0.42);z-index:0;pointer-events:none"></div>');
    }

    return html;
  });
}

/**
 * 包装为完整 HTML 文档（供 Puppeteer 截图使用）
 * bgImagePath 会被转为 file:// 绝对路径，确保无头浏览器能加载
 */
function wrapForScreenshot(htmlFragment, bgImagePath = null) {
  let html = htmlFragment;
  const normalizedImagePath = bgImagePath && typeof bgImagePath === 'object'
    ? (bgImagePath.localPath || bgImagePath.path || bgImagePath.url || '')
    : bgImagePath;
  if (normalizedImagePath) {
    const imageUrl = normalizeImageUrl(normalizedImagePath);
    const dataUrl = buildImageDataUrl(normalizedImagePath);
    // 替换 output 静态 URL 为内联 data URL，避免 about:blank + file:// 加载限制
    html = html.replace(
      new RegExp(imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      dataUrl
    );
  }
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<style>${FONT_FACE_CSS}
body{margin:0;overflow:hidden;background:#fff;width:960px;height:540px;font-family:"Inter","Noto Sans SC","PingFang SC",system-ui,sans-serif}${SLIDE_CSS}${designerCSS || ''}</style>
</head><body>${html}</body></html>`;
}

module.exports = { renderToHtml, wrapForScreenshot, SLIDE_CSS };
