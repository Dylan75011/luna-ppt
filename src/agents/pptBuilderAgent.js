const BaseAgent = require('./baseAgent');
const { buildOutlinePrompt, buildPagePrompt } = require('../prompts/pptBuilder');

class PptBuilderAgent extends BaseAgent {
  constructor() {
    super('PptBuilderAgent', 'minimax');
  }

  /**
   * 两阶段生成：
   * 1. 先生成页面大纲（轻量，速度快）
   * 2. 逐页生成完整内容，每页完成后回调 onPageReady
   *
   * @param {object}   plan        - 策划方案
   * @param {object}   userInput   - 用户输入
   * @param {function} onOutlineReady - (outline, total) => void
   * @param {function} onPageReady - (page, index, total, theme) => void
   */
  async run({ plan, userInput, docContent, imageMap = {}, onOutlineReady, onPageReady }) {
    console.log('[PptBuilderAgent] 第一阶段：生成页面大纲...');
    const { systemPrompt: os, userPrompt: ou } = buildOutlinePrompt(plan, userInput);
    const outline = await this.callLLMJson(
      [{ role: 'system', content: os }, { role: 'user', content: ou }],
      { maxTokens: 2048, temperature: 0.3 }
    );

    const theme = outline.theme || {};
    const pageSpecs = outline.pages || [];
    const total = pageSpecs.length;
    console.log(`[PptBuilderAgent] 大纲完成，共 ${total} 页，开始逐页生成...`);

    if (typeof onOutlineReady === 'function') {
      onOutlineReady(outline, total);
    }

    const pages = [];

    for (let i = 0; i < pageSpecs.length; i++) {
      const pageSpec = pageSpecs[i];
      console.log(`[PptBuilderAgent] 生成第 ${i + 1}/${total} 页：${pageSpec.hint}`);

      const { systemPrompt: ps, userPrompt: pu } = buildPagePrompt(pageSpec, i, total, plan, userInput, theme);
      const page = await this.callLLMJson(
        [{ role: 'system', content: ps }, { role: 'user', content: pu }],
        { maxTokens: 2000, temperature: 0.5 }
      );

      // 确保 type 字段存在（防止 LLM 漏输出）
      if (!page.type) page.type = pageSpec.type;

      // 根据页面类型注入背景图路径
      const bgCategory = (page.type === 'cover') ? 'cover'
        : (page.type === 'end') ? 'end'
        : 'content';
      if (imageMap[bgCategory]) {
        page.bgImagePath = imageMap[bgCategory];
      }

      pages.push(page);

      if (typeof onPageReady === 'function') {
        onPageReady(page, i, total, theme);
      }
    }

    console.log(`[PptBuilderAgent] 全部 ${pages.length} 页生成完成`);
    return { title: outline.title, theme, pages };
  }
}

module.exports = PptBuilderAgent;
