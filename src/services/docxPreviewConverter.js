const docxPreview = require('docx-preview');
const { htmlToTiptap } = require('./richText');

// ─── 主转换函数 ────────────────────────────────────────────────────────────

/**
 * 将 .docx Buffer 转换为 Tiptap JSON 格式
 * @param {Buffer} buffer - .docx 文件的 Buffer
 * @returns {Promise<Object>} Tiptap JSON 文档
 */
async function docxToTiptapJson(buffer) {
  try {
    const result = await docxPreview.renderAsync(buffer, null, {
      className: 'docx-preview',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPage: false,
      experimental: false,
      trimXmlDeclaration: true,
      useBase64URL: true,
      useMathMLPolyfill: false,
      renderChanges: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderTrackChanges: false
    });
    
    let html = '';
    if (result && result.innerHTML) {
      html = result.innerHTML;
    } else if (typeof result === 'string') {
      html = result;
    } else if (result && result.document) {
      html = result.document.innerHTML || '';
    }
    
    html = html.replace(/class="docx-preview[^"]*"/g, '');
    html = html.replace(/data-docx[^"]*"/g, '');
    
    return htmlToTiptap(html);
    
  } catch (error) {
    console.error('[docxPreviewConverter] Error converting docx:', error);
    throw error;
  }
}

/**
 * 将 .docx Buffer 转换为 HTML（保留用于预览）
 * @param {Buffer} buffer - .docx 文件的 Buffer
 * @returns {Promise<string>} HTML 字符串
 */
async function docxToHtml(buffer) {
  try {
    const result = await docxPreview.renderAsync(buffer, null, {
      className: 'docx-preview',
      inWrapper: true,
      useBase64URL: true
    });
    
    if (result && result.innerHTML) {
      return result.innerHTML;
    }
    return '<p></p>';
  } catch (error) {
    console.error('[docxPreviewConverter] Error converting to HTML:', error);
    throw error;
  }
}

module.exports = { docxToTiptapJson, docxToHtml, htmlToTiptap };
