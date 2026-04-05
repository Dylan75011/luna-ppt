const { JSDOM } = require('jsdom');

function createTextNode(text, marks = []) {
  const node = { type: 'text', text };
  if (marks.length) node.marks = marks;
  return node;
}

function createParagraph(content = []) {
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function createHeading(level, content = []) {
  return { type: 'heading', attrs: { level }, content: content.length ? content : undefined };
}

function createListItem(content = []) {
  return { type: 'listItem', content: content.length ? content : [createParagraph()] };
}

function esc(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineParse(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function markdownToHtml(md = '') {
  let html = String(md || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();

  const lines = html.split('\n');
  const result = [];
  let inTable = false;
  let tableRows = [];

  for (const line of lines) {
    if (line.trim().startsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      if (/^\|[\s\-|]+\|$/.test(line.trim())) continue;
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      tableRows.push(cells);
      continue;
    }

    if (inTable) {
      inTable = false;
      const [header, ...body] = tableRows;
      const thead = header ? `<thead><tr>${header.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : '';
      const tbody = body.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
      result.push(`<table>${thead}<tbody>${tbody}</tbody></table>`);
      tableRows = [];
    }

    if (/^### (.+)/.test(line)) {
      result.push(`<h3>${inlineParse(line.replace(/^### /, ''))}</h3>`);
    } else if (/^## (.+)/.test(line)) {
      result.push(`<h2>${inlineParse(line.replace(/^## /, ''))}</h2>`);
    } else if (/^# (.+)/.test(line)) {
      result.push(`<h1>${inlineParse(line.replace(/^# /, ''))}</h1>`);
    } else if (/^- (.+)/.test(line)) {
      result.push(`<li>${inlineParse(line.replace(/^- /, ''))}</li>`);
    } else if (line.trim() === '') {
      result.push('');
    } else {
      result.push(`<p>${inlineParse(line)}</p>`);
    }
  }

  if (inTable && tableRows.length) {
    const [header, ...body] = tableRows;
    const thead = header ? `<thead><tr>${header.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : '';
    const tbody = body.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
    result.push(`<table>${thead}<tbody>${tbody}</tbody></table>`);
  }

  return result.join('\n')
    .replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
}

function parseStyleMarks(element) {
  const marks = [];
  const style = element?.style;
  if (!style) return marks;

  if (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) marks.push({ type: 'bold' });
  if (style.fontStyle === 'italic') marks.push({ type: 'italic' });
  if ((style.textDecoration || '').includes('underline')) marks.push({ type: 'underline' });
  if ((style.textDecoration || '').includes('line-through')) marks.push({ type: 'strike' });
  if (style.color) marks.push({ type: 'textStyle', attrs: { color: style.color } });
  if (style.backgroundColor) marks.push({ type: 'highlight', attrs: { color: style.backgroundColor } });

  return marks;
}

function uniqueMarks(marks = []) {
  const seen = new Set();
  return marks.filter((mark) => {
    const key = JSON.stringify(mark);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseInlineNodes(node, activeMarks = [], documentRef = null) {
  const doc = documentRef || node?.ownerDocument;
  if (!doc || !node) return [];

  if (node.nodeType === doc.TEXT_NODE) {
    return node.textContent ? [createTextNode(node.textContent, uniqueMarks(activeMarks))] : [];
  }

  if (node.nodeType !== doc.ELEMENT_NODE) return [];

  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return [{ type: 'hardBreak' }];
  if (tag === 'img') {
    const src = node.getAttribute('src');
    return src ? [{ type: 'image', attrs: { src, alt: node.getAttribute('alt') || '', title: null } }] : [];
  }

  const nextMarks = [...activeMarks, ...parseStyleMarks(node)];
  if (tag === 'strong' || tag === 'b') nextMarks.push({ type: 'bold' });
  if (tag === 'em' || tag === 'i') nextMarks.push({ type: 'italic' });
  if (tag === 'u') nextMarks.push({ type: 'underline' });
  if (tag === 's' || tag === 'strike' || tag === 'del') nextMarks.push({ type: 'strike' });
  if (tag === 'code') nextMarks.push({ type: 'code' });
  if (tag === 'mark') nextMarks.push({ type: 'highlight' });

  if (tag === 'a' && node.getAttribute('href')) {
    nextMarks.push({
      type: 'link',
      attrs: {
        href: node.getAttribute('href'),
        target: '_blank',
        rel: 'noopener noreferrer'
      }
    });
  }

  return Array.from(node.childNodes).flatMap(child => parseInlineNodes(child, nextMarks, doc));
}

function isBlockTag(tag = '') {
  return ['p', 'div', 'section', 'article', 'blockquote', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table'].includes(tag);
}

function parseListItem(element) {
  const blocks = [];
  let inlineBuffer = [];

  const flushInline = () => {
    const hasText = inlineBuffer.some(node => node.type !== 'text' || (node.text || '').trim());
    if (hasText) blocks.push(createParagraph(inlineBuffer));
    inlineBuffer = [];
  };

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === element.ownerDocument.TEXT_NODE) {
      inlineBuffer.push(...parseInlineNodes(child, [], element.ownerDocument));
      continue;
    }
    if (child.nodeType !== element.ownerDocument.ELEMENT_NODE) continue;

    const tag = child.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      flushInline();
      blocks.push(parseBlock(child));
      continue;
    }

    if (tag === 'p') {
      flushInline();
      blocks.push(createParagraph(parseInlineNodes(child, [], element.ownerDocument)));
      continue;
    }

    if (isBlockTag(tag) && tag !== 'li') {
      flushInline();
      const parsed = parseBlock(child);
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else if (parsed) blocks.push(parsed);
      continue;
    }

    inlineBuffer.push(...parseInlineNodes(child, [], element.ownerDocument));
  }

  flushInline();
  return createListItem(blocks);
}

function parseBlock(element) {
  const tag = element.tagName.toLowerCase();
  const inline = parseInlineNodes(element, [], element.ownerDocument);

  if (tag === 'h1') return createHeading(1, inline);
  if (tag === 'h2') return createHeading(2, inline);
  if (tag === 'h3') return createHeading(3, inline);
  if (tag === 'h4') return createHeading(4, inline);
  if (tag === 'h5') return createHeading(5, inline);
  if (tag === 'h6') return createHeading(6, inline);
  if (tag === 'p') return createParagraph(inline);
  if (tag === 'hr') return { type: 'horizontalRule' };
  if (tag === 'pre') return { type: 'codeBlock', content: inline.length ? inline : undefined };
  if (tag === 'blockquote') return { type: 'blockquote', content: [createParagraph(inline)] };
  if (tag === 'ul') return { type: 'bulletList', content: Array.from(element.children).filter(child => child.tagName?.toLowerCase() === 'li').map(parseListItem) };
  if (tag === 'ol') return { type: 'orderedList', content: Array.from(element.children).filter(child => child.tagName?.toLowerCase() === 'li').map(parseListItem) };
  if (tag === 'li') return parseListItem(element);
  if (tag === 'img') {
    const src = element.getAttribute('src');
    return src ? { type: 'image', attrs: { src, alt: element.getAttribute('alt') || '', title: null } } : createParagraph();
  }
  if (tag === 'table') {
    return createParagraph([{ type: 'text', text: element.textContent?.trim() || '' }].filter(Boolean));
  }

  const blockChildren = Array.from(element.children).flatMap((child) => {
    const parsed = parseBlock(child);
    return Array.isArray(parsed) ? parsed : [parsed];
  }).filter(Boolean);

  if (blockChildren.length) return blockChildren;
  return createParagraph(inline);
}

function htmlToTiptap(html = '') {
  const dom = new JSDOM(`<!DOCTYPE html><body>${String(html || '')}</body>`);
  const { document } = dom.window;
  const content = [];

  for (const node of Array.from(document.body.childNodes)) {
    if (node.nodeType === document.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) content.push(createParagraph([createTextNode(text)]));
      continue;
    }
    if (node.nodeType !== document.ELEMENT_NODE) continue;
    const parsed = parseBlock(node);
    if (Array.isArray(parsed)) content.push(...parsed);
    else if (parsed) content.push(parsed);
  }

  return {
    type: 'doc',
    content: content.length ? content : [createParagraph()]
  };
}

function markdownToTiptap(markdown = '') {
  return htmlToTiptap(markdownToHtml(markdown));
}

module.exports = {
  markdownToHtml,
  markdownToTiptap,
  htmlToTiptap
};
