const { esc, clamp, toPercent, toPx, toPercentNumber, buildCssVars } = require('./utils');
const { renderBackgroundLayers } = require('./backgrounds');
const { mergeStructuredSpec } = require('./compositions');

function buildStructuredGridSpec(spec = {}) {
  const regionList = Array.isArray(spec.regions) ? spec.regions : [];
  const items = [
    ...regionList,
    ...(((spec.imagePlacement?.mode || 'background') === 'background' || !spec.imagePlacement) ? [] : [spec.imagePlacement]),
  ].filter(Boolean);

  const xStops = [0, 100];
  const yStops = [0, 100];

  items.forEach((item) => {
    const x = toPercentNumber(item.x, 0);
    const y = toPercentNumber(item.y, 0);
    const w = toPercentNumber(item.w, 100);
    const h = toPercentNumber(item.h, 100);
    xStops.push(x, clamp(x + w, 0, 100));
    yStops.push(y, clamp(y + h, 0, 100));
  });

  const normalizeStops = (values) => values
    .map(value => Math.round(value * 100) / 100)
    .sort((a, b) => a - b)
    .filter((value, index, list) => index === 0 || Math.abs(value - list[index - 1]) > 0.25);

  const cols = normalizeStops(xStops);
  const rows = normalizeStops(yStops);
  const colTracks = cols.slice(0, -1).map((start, index) => Math.max(1, cols[index + 1] - start));
  const rowTracks = rows.slice(0, -1).map((start, index) => Math.max(1, rows[index + 1] - start));

  return { cols, rows, colTracks, rowTracks };
}

function resolveStructuredGridPlacement(item = {}, gridSpec) {
  const cols = gridSpec?.cols || [0, 100];
  const rows = gridSpec?.rows || [0, 100];
  const x = toPercentNumber(item.x, 0);
  const y = toPercentNumber(item.y, 0);
  const w = toPercentNumber(item.w, 100);
  const h = toPercentNumber(item.h, 100);
  const endX = clamp(x + w, 0, 100);
  const endY = clamp(y + h, 0, 100);

  const findLine = (stops, target, fallback) => {
    const rounded = Math.round(target * 100) / 100;
    const exact = stops.findIndex(value => Math.abs(value - rounded) <= 0.25);
    return (exact >= 0 ? exact : fallback) + 1;
  };

  const colStart = findLine(cols, x, 0);
  const colEnd = Math.max(colStart + 1, findLine(cols, endX, cols.length - 1));
  const rowStart = findLine(rows, y, 0);
  const rowEnd = Math.max(rowStart + 1, findLine(rows, endY, rows.length - 1));

  return { colStart, colEnd, rowStart, rowEnd };
}

function renderStructuredGridCanvas(gridSpec, contentHtml = '') {
  const colTemplate = (gridSpec.colTracks.length ? gridSpec.colTracks : [100])
    .map(track => `minmax(0, ${track}fr)`)
    .join(' ');
  const rowTemplate = (gridSpec.rowTracks.length ? gridSpec.rowTracks : [100])
    .map(track => `minmax(${Math.max(16, Math.round(5.4 * track))}px, auto)`)
    .join(' ');

  return `<div class="sc-canvas" style="grid-template-columns:${colTemplate};grid-template-rows:${rowTemplate};">${contentHtml}</div>`;
}

function normalizeBlocks(page = {}) {
  if (Array.isArray(page.textBlocks) && page.textBlocks.length) return page.textBlocks;
  const blocks = [];
  const facts = Array.isArray(page.facts) ? page.facts : [];
  const metrics = Array.isArray(page.metrics) ? page.metrics : [];
  const points = Array.isArray(page.points) ? page.points : [];
  const phases = Array.isArray(page.phases) ? page.phases : [];
  if (page.eyebrow) blocks.push({ region: 'header', kind: 'eyebrow', text: page.eyebrow });
  if (page.title) blocks.push({ region: 'header', kind: 'title', text: page.title });
  if (page.subtitle) blocks.push({ region: 'header', kind: 'subtitle', text: page.subtitle });
  if (page.story || page.body) blocks.push({ region: 'body', kind: 'body', text: page.story || page.body });
  if (page.quote) blocks.push({ region: 'quote', kind: 'quote', text: page.quote });
  if (points.length) blocks.push({ region: 'rail', kind: 'numbered-list', items: points });
  if (facts.length) blocks.push({ region: 'facts', kind: 'fact-list', items: facts });
  if (metrics.length) blocks.push({ region: 'stats', kind: 'stats', items: metrics });
  if (phases.length) blocks.push({ region: 'timeline', kind: 'timeline', items: phases });
  if (Array.isArray(page.leftItems) && page.leftItems.length) {
    blocks.push({ region: 'left', kind: 'fact-list', title: page.leftTitle || '', items: page.leftItems });
  }
  if (Array.isArray(page.rightItems) && page.rightItems.length) {
    blocks.push({ region: 'right', kind: 'fact-list', title: page.rightTitle || '', items: page.rightItems });
  }
  return blocks;
}

function getPageRole(page = {}) {
  return page?.visualIntent?.role || page?.layout || page?.type || 'content';
}

function chooseListVariant(page, block) {
  const role = getPageRole(page);
  const count = Array.isArray(block?.items) ? block.items.length : 0;
  const longest = Math.max(0, ...(block?.items || []).map(item => String(item || '').length));
  if (role === 'cover') return count <= 3 ? 'quiet-lines' : 'side-notes';
  if (role === 'manifesto') return longest > 28 ? 'compact-notes' : 'side-notes';
  if (role === 'highlights') return 'floating-tags';
  if (role === 'team') return 'team-cards';
  if (role === 'closing') return 'quiet-lines';
  if (role === 'section' && count <= 4) return longest > 26 ? 'compact-notes' : 'side-notes';
  if (role === 'toc' || role === 'comparison') return 'editorial-list';
  return longest > 28 ? 'compact-notes' : 'editorial-list';
}

function chooseStatsVariant(page) {
  const role = getPageRole(page);
  if (role === 'metrics') return 'ledger';
  if (role === 'highlights') return 'staggered-notes';
  if (role === 'comparison') return 'annotation-strip';
  return 'strip';
}

function chooseTimelineVariant(page) {
  const role = getPageRole(page);
  return role === 'timeline' ? 'editorial-steps' : 'cards';
}

function getTypeScale(page = {}, block = {}) {
  const role = getPageRole(page);
  const kind = block.kind || 'body';
  const scales = {
    cover: {
      title: 48,
      subtitle: 16,
      body: 13,
      quote: 28,
      fact: 13,
      metric: 34,
      eyebrow: 11,
    },
    manifesto: {
      title: 38,
      subtitle: 15,
      body: 14,
      quote: 25,
      fact: 13,
      metric: 32,
      eyebrow: 11,
    },
    highlights: {
      title: 40,
      subtitle: 15,
      body: 13,
      quote: 24,
      fact: 12,
      metric: 30,
      eyebrow: 11,
    },
    section: {
      title: 40,
      subtitle: 15,
      body: 14,
      quote: 22,
      fact: 12,
      metric: 30,
      eyebrow: 11,
    },
    timeline: {
      title: 30,
      subtitle: 13,
      body: 13,
      quote: 22,
      fact: 12,
      metric: 28,
      eyebrow: 11,
    },
    metrics: {
      title: 36,
      subtitle: 14,
      body: 13,
      quote: 22,
      fact: 12,
      metric: 32,
      eyebrow: 11,
    },
    team: {
      title: 34,
      subtitle: 14,
      body: 13,
      quote: 22,
      fact: 12,
      metric: 28,
      eyebrow: 11,
    },
    comparison: {
      title: 36,
      subtitle: 14,
      body: 13,
      quote: 22,
      fact: 12,
      metric: 28,
      eyebrow: 11,
    },
    closing: {
      title: 42,
      subtitle: 15,
      body: 13,
      quote: 24,
      fact: 12,
      metric: 28,
      eyebrow: 11,
    },
    toc: {
      title: 36,
      subtitle: 14,
      body: 13,
      quote: 20,
      fact: 14,
      metric: 28,
      eyebrow: 11,
    },
    content: {
      title: 38,
      subtitle: 15,
      body: 14,
      quote: 22,
      fact: 12,
      metric: 30,
      eyebrow: 11,
    },
  };
  const scale = scales[role] || scales.content;
  if (kind === 'eyebrow') return scale.eyebrow;
  if (kind === 'title') return scale.title;
  if (kind === 'subtitle') return scale.subtitle;
  if (kind === 'quote') return scale.quote;
  if (kind === 'stats') return scale.metric;
  if (kind === 'fact-list' || kind === 'numbered-list' || kind === 'timeline') return scale.fact;
  return scale.body;
}

function chooseRegionStyle(page, region, blocks) {
  const role = getPageRole(page);
  if (!blocks.length) return { surface: 'none', padding: region.padding };
  if (region.name === 'header' || region.name === 'body' || region.name === 'statement' || region.name === 'quote') {
    return { surface: 'none', padding: region.padding };
  }
  if (region.name === 'timeline') {
    return { surface: 'none', padding: region.padding };
  }
  if (role === 'highlights' && region.name === 'stats') {
    return { surface: 'rule', padding: 0 };
  }
  if (role === 'team' && region.name === 'facts') {
    return { surface: 'none', padding: 0 };
  }
  if (role === 'metrics' && region.name === 'stats') {
    return { surface: 'rule', padding: 0 };
  }
  if (role === 'comparison') {
    return { surface: 'rule', padding: 0 };
  }
  if (role === 'cover' || role === 'manifesto') {
    return { surface: 'edge-fade', padding: 0 };
  }
  if (role === 'section') {
    return { surface: 'ghost', padding: 0 };
  }
  if (role === 'highlights' || role === 'metrics' || role === 'team') {
    return { surface: 'none', padding: 0 };
  }
  if (role === 'timeline') {
    return { surface: 'rule', padding: 0 };
  }
  return { surface: 'ghost', padding: 0 };
}

function renderStructuredBlock(block, style, page = {}) {
  const accent = style.tokens.colors.accent;
  const typeSize = getTypeScale(page, block);
  switch (block.kind) {
    case 'eyebrow':
      return `<div class="sc-block" style="font-size:${block.size || typeSize}px;font-weight:var(--weight-bold);letter-spacing:0.14em;text-transform:uppercase;color:${accent};">${esc(block.text)}</div>`;
    case 'title':
      return `<div class="sc-block" style="font-size:${block.size || typeSize}px;font-weight:var(--weight-black);line-height:1.04;letter-spacing:-0.035em;color:var(--text);text-wrap:balance;">${esc(block.text)}</div>`;
    case 'subtitle':
      return `<div class="sc-block" style="font-size:${block.size || typeSize}px;line-height:${block.lineHeight || 1.6};color:var(--text-muted);max-width:100%;text-wrap:pretty;">${esc(block.text)}</div>`;
    case 'body':
      return `<div class="sc-block" style="font-size:${block.size || typeSize}px;line-height:${block.lineHeight || 1.75};color:${block.strong ? 'var(--text)' : 'var(--text-muted)'};max-width:100%;text-wrap:pretty;display:-webkit-box;-webkit-line-clamp:${block.clamp || 6};-webkit-box-orient:vertical;overflow:hidden;">${esc(block.text)}</div>`;
    case 'quote':
      return `<div class="sc-block" style="padding-left:18px;border-left:2px solid ${accent};font-size:${block.size || typeSize}px;line-height:${block.lineHeight || 1.42};color:#fff;text-wrap:balance;display:-webkit-box;-webkit-line-clamp:${block.clamp || 5};-webkit-box-orient:vertical;overflow:hidden;">${esc(block.text)}</div>`;
    case 'fact-list': {
      const variant = block.variant || chooseListVariant(page, block);
      const factSize = block.size || typeSize;
      if (variant === 'quiet-lines') {
        return `${block.title ? `<div class="sc-block" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${accent};margin-bottom:10px;">${esc(block.title)}</div>` : ''}${(block.items || []).map((item, index) => `
          <div class="sc-block" style="padding:${index === 0 ? '0 0 10px 0' : '10px 0'};border-top:${index === 0 ? 'none' : '1px solid rgba(255,255,255,0.08)'};">
            <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};margin-bottom:6px;">Point ${String(index + 1).padStart(2, '0')}</div>
            <div style="font-size:${factSize}px;line-height:${block.lineHeight || 1.58};color:var(--text);display:-webkit-box;-webkit-line-clamp:${block.clamp || 3};-webkit-box-orient:vertical;overflow:hidden;">${esc(item)}</div>
          </div>`).join('')}`;
      }
      if (variant === 'side-notes') {
        return `${(block.items || []).map((item, index) => `
          <div class="sc-block" style="display:grid;grid-template-columns:54px 1fr;gap:10px;align-items:start;padding:${index === 0 ? '0 0 10px 0' : '10px 0'};border-top:${index === 0 ? 'none' : '1px solid rgba(255,255,255,0.08)'};">
            <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${accent};padding-top:2px;">0${index + 1}</div>
            <div style="font-size:${factSize}px;line-height:${block.lineHeight || 1.58};color:var(--text);display:-webkit-box;-webkit-line-clamp:${block.clamp || 3};-webkit-box-orient:vertical;overflow:hidden;">${esc(item)}</div>
          </div>`).join('')}`;
      }
      if (variant === 'compact-notes') {
        return `${(block.items || []).map((item, index) => `
          <div class="sc-block" style="padding:${index === 0 ? '0 0 8px 0' : '8px 0'};">
            <div style="font-size:${factSize}px;line-height:${block.lineHeight || 1.5};color:var(--text);display:-webkit-box;-webkit-line-clamp:${block.clamp || 2};-webkit-box-orient:vertical;overflow:hidden;">${esc(item)}</div>
          </div>`).join('')}`;
      }
      if (variant === 'floating-tags') {
        const columns = (block.items || []).length >= 5 ? 3 : 2;
        return `<div class="sc-block" style="display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:20px 24px;align-content:flex-start;width:100%;">
          ${(block.items || []).map((item, index) => `
            <div style="display:grid;grid-template-columns:30px 1fr;gap:12px;align-items:start;padding-top:${index < columns ? '0' : '8px'};border-top:${index < columns ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(255,255,255,0.08)'};">
              <span style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};padding-top:2px;flex-shrink:0;">${String(index + 1).padStart(2, '0')}</span>
              <span style="font-size:${factSize + 1}px;line-height:${block.lineHeight || 1.55};color:var(--text);display:-webkit-box;-webkit-line-clamp:${block.clamp || 3};-webkit-box-orient:vertical;overflow:hidden;">${esc(item)}</span>
            </div>`).join('')}
        </div>`;
      }
      if (variant === 'team-cards') {
        const columns = (block.items || []).length >= 5 ? 3 : 2;
        return `<div class="sc-block" style="display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:18px;width:100%;">
          ${(block.items || []).map((item, index) => `
            <div style="min-height:132px;padding:18px 16px 16px;background:linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04));border:1px solid rgba(255,255,255,0.14);box-shadow:0 10px 24px rgba(0,0,0,0.14);display:flex;flex-direction:column;gap:12px;">
              <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};">${String(index + 1).padStart(2, '0')}</div>
              <div style="font-size:${factSize + 1}px;line-height:${block.lineHeight || 1.62};color:var(--text);display:-webkit-box;-webkit-line-clamp:${block.clamp || 4};-webkit-box-orient:vertical;overflow:hidden;">${esc(item)}</div>
            </div>`).join('')}
        </div>`;
      }
      return `${block.title ? `<div class="sc-block" style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};margin-bottom:10px;">${esc(block.title)}</div>` : ''}${(block.items || []).map((item, index) => `
        <div class="sc-block" style="padding:${index === 0 ? '0' : '12px 0 0'} 0;border-top:${index === 0 ? 'none' : '1px solid rgba(255,255,255,0.08)'};">
          <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};margin-bottom:7px;">Point ${String(index + 1).padStart(2, '0')}</div>
          <div style="font-size:${factSize}px;line-height:${block.lineHeight || 1.6};color:var(--text);display:-webkit-box;-webkit-line-clamp:${block.clamp || 3};-webkit-box-orient:vertical;overflow:hidden;">${esc(item)}</div>
        </div>`).join('')}`;
    }
    case 'numbered-list':
      return (block.items || []).map((item, index) => `
        <div class="sc-block" style="display:grid;grid-template-columns:34px 1fr;gap:14px;padding:12px 0;border-top:${index === 0 ? 'none' : '1px solid var(--border)'};">
          <div style="font-size:13px;color:${accent};font-weight:var(--weight-bold);">${String(index + 1).padStart(2, '0')}</div>
          <div style="font-size:14px;line-height:1.7;color:var(--text);">${esc(item)}</div>
        </div>`).join('');
    case 'timeline': {
      const variant = block.variant || chooseTimelineVariant(page);
      if (variant === 'runway') {
        return `<div class="sc-block" style="display:grid;grid-template-columns:repeat(${Math.min((block.items || []).length, 4) || 1},1fr);gap:18px;align-items:stretch;width:100%;">
          ${(block.items || []).map((item, index) => `
            <div style="display:flex;flex-direction:column;min-height:220px;padding:14px 8px 0;border-top:1px solid rgba(255,255,255,0.12);">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                <div style="width:28px;height:28px;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(192,160,98,0.35);color:${accent};font-size:11px;font-weight:var(--weight-bold);">${String(index + 1).padStart(2, '0')}</div>
                <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.54);">${esc(item.date || '')}</div>
              </div>
              <div style="font-size:20px;line-height:1.15;font-weight:var(--weight-bold);color:var(--text);margin-bottom:10px;">${esc(item.name || '')}</div>
              <div style="display:flex;flex-direction:column;gap:8px;margin-top:auto;">
                ${(item.tasks || []).map(task => `<div style="font-size:13px;line-height:1.6;color:var(--text-muted);">${esc(task)}</div>`).join('')}
              </div>
            </div>`).join('')}
        </div>`;
      }
      if (variant === 'editorial-steps') {
        return `<div class="sc-block" style="display:flex;flex-direction:column;gap:10px;width:100%;">
          ${(block.items || []).map((item, index) => `
            <div style="display:grid;grid-template-columns:124px 138px 1fr;gap:16px;padding:12px 0;border-top:${index === 0 ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(255,255,255,0.08)'};align-items:start;">
              <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};padding-top:5px;line-height:1.65;word-break:keep-all;overflow-wrap:normal;">${esc(item.date || `Step ${index + 1}`)}</div>
              <div>
                <div style="font-size:15px;line-height:1.22;font-weight:var(--weight-bold);color:var(--text);margin-bottom:0;">${esc(item.name || '')}</div>
              </div>
              <div>
                ${(item.tasks || []).map(task => `<div style="font-size:13px;line-height:1.6;color:var(--text-muted);">${esc(task)}</div>`).join('')}
              </div>
            </div>`).join('')}
        </div>`;
      }
      return `<div class="sc-block" style="display:grid;grid-template-columns:repeat(${Math.min((block.items || []).length, 4) || 1},1fr);gap:16px;align-items:stretch;width:100%;">
        ${(block.items || []).map((item, index) => `
          <div style="display:flex;flex-direction:column;min-height:220px;background:rgba(9,14,22,0.58);border:1px solid rgba(255,255,255,0.1);border-radius:18px;padding:18px 18px 16px;backdrop-filter:blur(10px);">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
              <div style="width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:rgba(192,160,98,0.14);color:${accent};font-size:11px;font-weight:var(--weight-bold);">${String(index + 1).padStart(2, '0')}</div>
              <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.54);">${esc(item.date || '')}</div>
            </div>
            <div style="font-size:20px;line-height:1.2;font-weight:var(--weight-bold);color:var(--text);margin-bottom:12px;">${esc(item.name || '')}</div>
            <div style="display:flex;flex-direction:column;gap:10px;margin-top:auto;">
              ${(item.tasks || []).map(task => `<div style="font-size:13px;line-height:1.65;color:var(--text-muted);padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);">${esc(task)}</div>`).join('')}
            </div>
          </div>`).join('')}
      </div>`;
    }
    case 'stats': {
      const variant = block.variant || chooseStatsVariant(page);
      const metricSize = block.size || typeSize;
      if (variant === 'ledger') {
        return (block.items || []).map((item, index) => `
          <div class="sc-block" style="padding:${index === 0 ? '0 0 14px 0' : '14px 0'};border-top:${index === 0 ? 'none' : '1px solid rgba(255,255,255,0.08)'};">
            <div style="display:flex;align-items:end;justify-content:space-between;gap:18px;">
              <div style="font-size:${metricSize}px;font-weight:var(--weight-black);color:var(--text);line-height:1;">${esc(item.value || '')}</div>
              ${item.sub ? `<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${accent};">${esc(item.sub)}</div>` : ''}
            </div>
            ${item.label ? `<div style="font-size:12px;line-height:1.55;color:var(--text-muted);margin-top:8px;">${esc(item.label)}</div>` : ''}
          </div>`).join('');
      }
      if (variant === 'annotation-strip') {
        return `<div class="sc-block" style="display:grid;grid-template-columns:repeat(${Math.min((block.items || []).length, 3) || 1},1fr);gap:18px;align-items:start;width:100%;">
          ${(block.items || []).map((item, index) => `
            <div style="padding-top:16px;border-top:${index === 0 ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(255,255,255,0.08)'};">
              <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};margin-bottom:10px;">${esc(item.label || `Item ${index + 1}`)}</div>
              <div style="font-size:${metricSize}px;font-weight:var(--weight-black);color:var(--text);line-height:1;margin-bottom:8px;">${esc(item.value || '')}</div>
              ${item.sub ? `<div style="font-size:12px;line-height:1.5;color:var(--text-muted);">${esc(item.sub)}</div>` : ''}
            </div>`).join('')}
        </div>`;
      }
      if (variant === 'staggered-notes') {
        return `<div class="sc-block" style="display:grid;grid-template-columns:repeat(${Math.min((block.items || []).length, 3) || 1},1fr);gap:22px;width:100%;">
          ${(block.items || []).map((item, index) => `
            <div style="padding-top:${8 + (index % 2) * 18}px;">
              <div style="font-size:${metricSize}px;font-weight:var(--weight-black);color:var(--text);line-height:1;">${esc(item.value || '')}</div>
              <div style="width:24px;height:1px;background:rgba(192,160,98,0.7);margin:12px 0 10px;"></div>
              <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.52);margin-bottom:8px;">${esc(item.sub || item.label || '')}</div>
              ${item.label ? `<div style="font-size:12px;line-height:1.58;color:var(--text-muted);">${esc(item.label)}</div>` : ''}
            </div>`).join('')}
        </div>`;
      }
      if (variant === 'strip') {
        return (block.items || []).map((item, index) => `
          <div class="sc-block" style="padding:18px 0;border-top:${index === 0 ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(255,255,255,0.08)'};">
            <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-bottom:8px;">${esc(item.label || '')}</div>
            <div style="display:flex;align-items:baseline;gap:10px;">
              <div style="font-size:${metricSize}px;font-weight:var(--weight-black);color:var(--text);line-height:1;">${esc(item.value || '')}</div>
              ${item.sub ? `<div style="font-size:12px;color:var(--text-muted);">${esc(item.sub)}</div>` : ''}
            </div>
          </div>`).join('');
      }
      return (block.items || []).map((item) => `
        <div class="sc-block" style="padding:22px 10px 16px 0;">
          ${item.label ? `<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px;">${esc(item.label)}</div>` : ''}
          <div style="font-size:${metricSize}px;font-weight:var(--weight-black);color:var(--text);line-height:1;">${esc(item.value || '')}</div>
          ${item.sub ? `<div style="font-size:12px;color:var(--text-muted);margin-top:10px;">${esc(item.sub)}</div>` : ''}
        </div>`).join('');
    }
    default:
      return block.text ? `<div class="sc-block" style="font-size:14px;line-height:1.7;color:var(--text);">${esc(block.text)}</div>` : '';
  }
}

function renderStructuredRegion(page, region, blocks, style, gridSpec) {
  if (!blocks.length) return '';
  const minH = toPercent(region.h, '100%');
  const regionStyle = chooseRegionStyle(page, region, blocks);
  const pad = toPx(regionStyle.padding, region.panel ? 22 : 0);
  const gap = toPx(region.gap, 12);
  const alignMap = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
  const justifyMap = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'space-between' };
  const stack = region.stack || 'vertical';
  const contentHtml = blocks.map(block => renderStructuredBlock(block, style, page)).join('');
  const panelStyle = region.panel === 'glass-dark'
    ? 'background:rgba(9,14,22,0.62);border:1px solid rgba(255,255,255,0.12);backdrop-filter:blur(12px);box-shadow:0 18px 36px rgba(0,0,0,0.22);'
    : region.panel === 'soft'
      ? 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);'
      : '';
  const surfaceStyle = regionStyle.surface === 'edge-fade'
    ? 'border-left:1px solid rgba(255,255,255,0.12);padding-left:18px;'
    : regionStyle.surface === 'ghost'
      ? 'border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;'
      : regionStyle.surface === 'rule'
        ? 'border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;'
        : '';
  const innerStyle = stack === 'grid'
    ? `display:grid;grid-template-columns:repeat(${region.columns || 3},1fr);gap:${gap};align-content:${justifyMap[region.valign || 'start']};`
    : `display:flex;flex-direction:${stack === 'horizontal' ? 'row' : 'column'};gap:${gap};justify-content:${justifyMap[region.valign || 'start']};align-items:${alignMap[region.align || 'start']};`;
  const placement = resolveStructuredGridPlacement(region, gridSpec);

  // data-region 让外部测量脚本可以把 DOM 节点映射回 page.regions[name]，
  // 这样溢出处理时知道要压缩哪一组 textBlocks（block.region == region.name）。
  return `<div class="sc-region" data-region="${esc(region.name || '')}" style="grid-column:${placement.colStart} / ${placement.colEnd};grid-row:${placement.rowStart} / ${placement.rowEnd};align-self:start;min-height:${minH};height:auto;padding:${pad};overflow:visible;${panelStyle}${surfaceStyle}">
    <div class="sc-stack" style="${innerStyle}">${contentHtml}</div>
  </div>`;
}

function renderStructuredImageLayer(spec, page, gridSpec) {
  if (!page?.bgImage || page?.imageStrategy?.useBackground === false) return '';
  if ((spec?.mode || 'background') === 'background') return '';
  const radius = toPx(spec.radius, 24);
  const fit = spec.fit || 'cover';
  const shadow = spec.shadow || '0 24px 48px rgba(0,0,0,0.24)';
  const placement = resolveStructuredGridPlacement(spec, gridSpec);
  return `<div class="sc-layer" style="grid-column:${placement.colStart} / ${placement.colEnd};grid-row:${placement.rowStart} / ${placement.rowEnd};align-self:stretch;border-radius:${radius};overflow:hidden;box-shadow:${shadow};">
    <div style="position:absolute;inset:0;background-image:url('${page.bgImage}');background-size:${fit};background-position:center;"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(9,14,22,0.04), rgba(9,14,22,0.18));"></div>
  </div>`;
}

function renderStructuredSlide(page, style) {
  const spec = mergeStructuredSpec(page);
  const blocks = normalizeBlocks(page);
  const gridSpec = buildStructuredGridSpec(spec);
  const imageLayer = renderStructuredImageLayer(spec.imagePlacement, page, gridSpec);
  const regions = (spec.regions || []).map(region => {
    const regionBlocks = blocks.filter(block => (block.region || 'body') === region.name);
    return renderStructuredRegion(page, region, regionBlocks, style, gridSpec);
  }).join('');
  const canvas = renderStructuredGridCanvas(gridSpec, `${imageLayer}${regions}`);
  return `<div class="slide structured" style="${buildCssVars(style)};background:var(--bg);">
  ${renderBackgroundLayers(page, { fallbackTreatment: page?.imageStrategy?.treatment || 'ambient-texture', defaultOverlay: 0.34, defaultPlacement: 'left' })}
  ${canvas}
</div>`;
}

module.exports = {
  buildStructuredGridSpec,
  resolveStructuredGridPlacement,
  renderStructuredGridCanvas,
  normalizeBlocks,
  getPageRole,
  chooseListVariant,
  chooseStatsVariant,
  chooseTimelineVariant,
  getTypeScale,
  chooseRegionStyle,
  renderStructuredBlock,
  renderStructuredRegion,
  renderStructuredImageLayer,
  renderStructuredSlide,
};
