const BaseAgent = require('./baseAgent');
const { buildDocWriterPrompt } = require('../prompts/docWriter');

// 将 LLM 输出的 Markdown 转换为 Tiptap 兼容的 HTML
function markdownToHtml(md) {
  let html = md
    // 剥离 <think> 标签（防御）
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();

  // 按行处理
  const lines = html.split('\n');
  const result = [];
  let inTable = false;
  let tableRows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 表格行
    if (line.trim().startsWith('|')) {
      if (!inTable) { inTable = true; tableRows = []; }
      // 跳过分隔行 |---|
      if (/^\|[\s\-|]+\|$/.test(line.trim())) continue;
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      // 表格结束，flush
      inTable = false;
      const [header, ...body] = tableRows;
      const thead = header ? `<thead><tr>${header.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : '';
      const tbody = body.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
      result.push(`<table>${thead}<tbody>${tbody}</tbody></table>`);
      tableRows = [];
    }

    // 标题
    if (/^### (.+)/.test(line)) {
      result.push(`<h3>${inlineParse(line.replace(/^### /, ''))}</h3>`);
    } else if (/^## (.+)/.test(line)) {
      result.push(`<h2>${inlineParse(line.replace(/^## /, ''))}</h2>`);
    } else if (/^# (.+)/.test(line)) {
      result.push(`<h1>${inlineParse(line.replace(/^# /, ''))}</h1>`);
    // 列表项
    } else if (/^- (.+)/.test(line)) {
      result.push(`<li>${inlineParse(line.replace(/^- /, ''))}</li>`);
    // 空行
    } else if (line.trim() === '') {
      result.push('');
    // 普通段落
    } else {
      result.push(`<p>${inlineParse(line)}</p>`);
    }
  }

  // 如果表格在最后一行结束
  if (inTable && tableRows.length) {
    const [header, ...body] = tableRows;
    const thead = header ? `<thead><tr>${header.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : '';
    const tbody = body.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
    result.push(`<table>${thead}<tbody>${tbody}</tbody></table>`);
  }

  // 合并连续 li 为 ul
  let final = result.join('\n')
    .replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => `<ul>${m}</ul>`);

  return final;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function inlineParse(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

class DocWriterAgent extends BaseAgent {
  constructor() {
    super('DocWriterAgent', 'minimax');
  }

  async run({ plan, userInput, reviewFeedback }) {
    console.log('[DocWriterAgent] 开始生成策划文档...');
    const { systemPrompt, userPrompt } = buildDocWriterPrompt(plan, userInput, reviewFeedback);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
    const markdown = await this.callLLM(messages, { maxTokens: 6000, temperature: 0.4 });
    const html = markdownToHtml(markdown);
    console.log('[DocWriterAgent] 文档生成完成');
    return { markdown, html };
  }
}

module.exports = DocWriterAgent;
