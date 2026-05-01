const assert = require('assert');
const path = require('path');

const generatePlanDocPath = path.resolve(__dirname, '../src/skills/generatePlanDoc.js');
const { _private } = require(generatePlanDocPath);

function run() {
  const { cleanPlanText, renderPlanMarkdown } = _private;

  assert.strictEqual(
    cleanPlanText('<think>先分析一下</think>正式正文'),
    '正式正文'
  );
  assert.strictEqual(
    cleanPlanText('半截正文</think>正式正文'),
    '正式正文'
  );
  assert.strictEqual(
    cleanPlanText('<think>未闭合的模型思考'),
    ''
  );

  const markdown = renderPlanMarkdown({
    planTitle: '测试方案',
    coreStrategy: '<think>策略推理</think>正式策略',
    highlights: ['<think>亮点推理</think>正式亮点'],
    sections: [
      {
        title: '核心环节',
        keyPoints: ['<think>要点推理</think>正式要点'],
        narrative: '<think>整段未闭合思考'
      },
      {
        title: '传播环节',
        keyPoints: [],
        narrative: '<think>叙事推理</think>正式叙事'
      }
    ],
    budget: {
      total: '50万',
      breakdown: [
        { item: '<think>预算推理</think>场地搭建', amount: '20万', percentage: '40%', rationale: '<think>原因</think>保证体验质感' }
      ]
    },
    timeline: { phases: [] },
    kpis: [],
    riskMitigation: ['<think>风险推理</think>准备雨天预案'],
    visualExecutionHints: {
      sceneTone: '<think>视觉推理</think>轻盈明亮',
      onsiteDesignSuggestions: []
    }
  });

  assert(!markdown.includes('<think>'));
  assert(!markdown.includes('</think>'));
  assert(markdown.includes('正式策略'));
  assert(markdown.includes('正式亮点'));
  assert(markdown.includes('正式要点'));
  assert(markdown.includes('正式叙事'));
  assert(markdown.includes('场地搭建'));
  assert(markdown.includes('准备雨天预案'));
  assert(!markdown.includes('整段未闭合思考'));

  console.log('generatePlanDoc sanitize test passed');
}

run();
