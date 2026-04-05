// Skill: 将策划方案转化为 Markdown 文档并渲染为 Tiptap 兼容的 HTML
const { callLLM } = require('../utils/llmUtils');
const { buildDocWriterPrompt } = require('../prompts/docWriter');
const { markdownToHtml } = require('../services/richText');

/**
 * @param {{ plan, userInput, reviewFeedback }} input
 * @param {object} apiKeys  { minimaxApiKey, minimaxModel }
 * @returns {Promise<{ markdown: string, html: string }>}
 */
async function writeDoc({ plan, userInput, reviewFeedback }, apiKeys) {
  console.log('[skill:writeDoc] 开始生成策划文档...');
  const { systemPrompt, userPrompt } = buildDocWriterPrompt(plan, userInput, reviewFeedback);
  const markdown = await callLLM(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    {
      model: 'minimax',
      runtimeKey: apiKeys.minimaxApiKey,
      minimaxModel: apiKeys.minimaxModel,
      maxTokens: 6000,
      temperature: 0.4,
      name: 'writeDoc'
    }
  );
  const html = markdownToHtml(markdown);
  console.log('[skill:writeDoc] 文档生成完成');
  return { markdown, html };
}

module.exports = { writeDoc };
