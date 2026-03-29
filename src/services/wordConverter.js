/**
 * Word (.docx) ↔ HTML 双向转换服务
 *
 * 导入：mammoth  (.docx → HTML)
 * 导出：html-to-docx  (HTML → .docx Buffer)
 */

const mammoth   = require('mammoth');
const HTMLtoDOCX = require('html-to-docx');

// ─── Tiptap JSON → HTML（服务端轻量转换，供导出使用）─────────────────
function tiptapJsonToHtml(node) {
  if (!node) return '';

  function renderMark(text, marks = []) {
    let result = text;
    for (const mark of marks) {
      switch (mark.type) {
        case 'bold':          result = `<strong>${result}</strong>`; break;
        case 'italic':        result = `<em>${result}</em>`; break;
        case 'underline':     result = `<u>${result}</u>`; break;
        case 'strike':        result = `<s>${result}</s>`; break;
        case 'code':          result = `<code>${result}</code>`; break;
        case 'highlight':     result = `<mark>${result}</mark>`; break;
        case 'link':          result = `<a href="${mark.attrs?.href || ''}">${result}</a>`; break;
      }
    }
    return result;
  }

  function renderInline(nodes = []) {
    return nodes.map(n => {
      if (n.type === 'text') return renderMark(escHtml(n.text || ''), n.marks || []);
      if (n.type === 'hardBreak') return '<br>';
      return '';
    }).join('');
  }

  function renderNode(n) {
    const inner = renderInline(n.content || []);
    const children = (n.content || []).map(renderNode).join('');

    switch (n.type) {
      case 'doc':       return children;
      case 'paragraph': return `<p>${inner || '<br>'}</p>`;
      case 'heading': {
        const level = n.attrs?.level || 1;
        return `<h${level}>${inner}</h${level}>`;
      }
      case 'bulletList':  return `<ul>${children}</ul>`;
      case 'orderedList': return `<ol>${children}</ol>`;
      case 'listItem':    return `<li>${children}</li>`;
      case 'blockquote':  return `<blockquote>${children}</blockquote>`;
      case 'codeBlock':   return `<pre><code>${inner}</code></pre>`;
      case 'horizontalRule': return '<hr>';
      case 'taskList':   return `<ul>${children}</ul>`;
      case 'taskItem':   return `<li>${children}</li>`;
      default:           return inner || children;
    }
  }

  return renderNode(node);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── 将工作空间内容统一转为 HTML ─────────────────────────────────────
function contentToHtml(content, contentFormat) {
  if (!content) return '<p></p>';

  // HTML 字符串
  if (typeof content === 'string') {
    return content.trim() || '<p></p>';
  }

  // Tiptap JSON 对象
  if (typeof content === 'object') {
    if (content.type === 'doc') return tiptapJsonToHtml(content) || '<p></p>';
    // JSON string
    try {
      const parsed = JSON.parse(JSON.stringify(content));
      if (parsed.type === 'doc') return tiptapJsonToHtml(parsed) || '<p></p>';
    } catch {}
  }

  return '<p></p>';
}

// ─── 导入：.docx Buffer → HTML 字符串 ───────────────────────────────
async function docxToHtml(buffer) {
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='标题 1']   => h1:fresh",
        "p[style-name='标题 2']   => h2:fresh",
        "p[style-name='标题 3']   => h3:fresh"
      ]
    }
  );
  if (result.messages && result.messages.length) {
    const warns = result.messages.filter(m => m.type === 'warning');
    if (warns.length) console.warn('[wordConverter] mammoth warnings:', warns.map(m => m.message));
  }
  return result.value;
}

// ─── 导出：HTML → .docx Buffer ──────────────────────────────────────
async function htmlToDocx(html, title = '策划文档') {
  const fullHtml = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>${escHtml(title)}</title></head>
    <body>${html}</body>
    </html>
  `;

  const buffer = await HTMLtoDOCX(fullHtml, null, {
    title,
    lang: 'zh-CN',
    orientation: 'portrait',
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },  // 720 twips = 1.27cm
    font: '微软雅黑',
    fontSize: 24,   // half-points，= 12pt
    lineNumber: false,
    pageNumber: false,
    table: { row: { cantSplit: true } }
  });

  return buffer;
}

module.exports = { docxToHtml, htmlToDocx, contentToHtml, tiptapJsonToHtml };
