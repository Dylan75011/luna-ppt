// PPT JSON → HTML 幻灯片数组（与 pptGenerator 共用同一数据源）

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCover(page, vars) {
  return `<div class="slide slide-cover" style="${vars}">
    <div class="cover-bg"></div>
    <div class="cover-accent"></div>
    <div class="cover-content">
      <h1 class="cover-title">${esc(page.mainTitle || page.title)}</h1>
      ${page.subtitle ? `<p class="cover-subtitle">${esc(page.subtitle)}</p>` : ''}
      <div class="cover-divider"></div>
      ${(page.date || page.location) ? `<p class="cover-meta">${esc([page.date, page.location].filter(Boolean).join('  |  '))}</p>` : ''}
    </div>
    ${page.brand ? `<p class="cover-brand">${esc(page.brand)}</p>` : ''}
  </div>`;
}

function renderToc(page, vars) {
  const items = page.items || [];
  const itemsHtml = items.map((item, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `<div class="toc-item">
      <span class="toc-num">${num}</span>
      <span class="toc-text">${esc(item.title || item)}</span>
    </div>`;
  }).join('');
  return `<div class="slide slide-toc" style="${vars}">
    <div class="slide-topbar"></div>
    <h2 class="slide-heading">目录</h2>
    <div class="toc-list">${itemsHtml}</div>
  </div>`;
}

function renderContent(page, vars) {
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

  const heading = page.sectionNum ? `<span class="section-num">${esc(page.sectionNum)}</span> ${esc(page.title)}` : esc(page.title);

  return `<div class="slide slide-content" style="${vars}">
    <div class="slide-topbar"></div>
    <h2 class="slide-heading">${heading}</h2>
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
    <h2 class="slide-heading">${esc(page.title)}</h2>
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
    <h2 class="slide-heading">${esc(page.title)}</h2>
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
    <h2 class="slide-heading">${esc(page.title)}</h2>
    <div class="timeline-row">${phasesHtml}</div>
  </div>`;
}

function renderEnd(page, vars) {
  return `<div class="slide slide-end" style="${vars}">
    <div class="end-topbar"></div>
    <div class="end-content">
      <h1 class="end-title">${esc(page.mainText || '感谢观看')}</h1>
      ${page.subText ? `<p class="end-sub">${esc(page.subText)}</p>` : ''}
      ${page.brand ? `<p class="end-brand">${esc(page.brand)}</p>` : ''}
      ${page.contact ? `<p class="end-contact">${esc(page.contact)}</p>` : ''}
    </div>
  </div>`;
}

/**
 * 将 PPT JSON 转为 HTML 幻灯片数组
 * @param {Object} pptData
 * @returns {string[]}
 */
function renderToHtml(pptData) {
  const theme = pptData.theme || {};
  const primary = '#' + (theme.primary || '1A1A1A').replace('#', '');
  const secondary = '#' + (theme.secondary || '333333').replace('#', '');

  return (pptData.pages || []).map((page, index) => {
    // bgImagePath 是本地路径，转为 /output/images/ URL 供 HTML 预览
    let bgStyle = '';
    if (page.bgImagePath) {
      const imgName = require('path').basename(page.bgImagePath);
      const imgUrl  = `/output/images/${imgName}`;
      bgStyle = `background-image:url('${imgUrl}');background-size:cover;background-position:center;`;
    }
    const vars = `--primary:${primary};--secondary:${secondary};${bgStyle}`;

    let html;
    switch (page.type) {
      case 'cover':      html = renderCover(page, vars); break;
      case 'toc':        html = renderToc(page, vars); break;
      case 'content':    html = renderContent(page, vars); break;
      case 'two_column': html = renderTwoColumn(page, vars); break;
      case 'cards':      html = renderCards(page, vars); break;
      case 'timeline':   html = renderTimeline(page, vars); break;
      case 'end':        html = renderEnd(page, vars); break;
      default:           html = renderContent({ ...page, type: 'content' }, vars);
    }

    // 如果有背景图，在第一个子元素前插入半透明遮罩
    if (page.bgImagePath) {
      html = html.replace(/(<div class="slide[^"]*"[^>]*>)/,
        '$1<div style="position:absolute;inset:0;background:rgba(0,0,0,0.4);z-index:0;pointer-events:none"></div>');
    }

    return html;
  });
}

module.exports = { renderToHtml };
