const assert = require('assert');
const { detectTaskIntent } = require('../src/agents/brainAgent');

// 这套测试只验证 detectTaskIntent 这一层包裹逻辑：
//  - 信任 LLM 高置信结果，正确映射 label/hint
//  - 低置信 / needsClarification → 转澄清对话
//  - LLM 抛错 → 转澄清对话，不再有正则兜底
//  - 续接语在 LLM 返回时按预期沿用
//
// 真正的"语义识别质量"由 LLM + prompt 负责，对抗样本见底部 ADVERSARIAL_CASES，
// 配置 MINIMAX_API_KEY 后可跑端到端验证。

function mock(response) {
  return async () => response;
}

function failing(message = 'boom') {
  return async () => { throw new Error(message); };
}

const wrapperScenarios = [
  {
    id: 'high-conf-strategy',
    text: '基于空间里那份需求文档，帮我生成一版活动策划方案',
    options: {
      workspaceDocs: [{ id: 'doc_1', name: '车展需求.docx', docType: 'document', text: '需要在 6 月做一次品牌发布会...' }],
      intentClassifier: mock({ type: 'strategy', confidence: 0.92, reason: '产出新方案', needsClarification: false })
    },
    expect: { type: 'strategy', label: '方案策划', needsClarification: false }
  },
  {
    id: 'high-conf-doc-edit',
    text: '把我刚上传的方案润色一下，结构别动',
    options: {
      documents: [{ id: 'doc_2', name: '方案.docx', text: '一、活动背景...' }],
      intentClassifier: mock({ type: 'doc_edit', confidence: 0.93, reason: '在原文档润色', needsClarification: false })
    },
    expect: { type: 'doc_edit', label: '文档修改', needsClarification: false }
  },
  {
    id: 'high-conf-ppt',
    text: '基于这份方案直接生成 PPT 吧',
    options: {
      documents: [{ id: 'doc_3', name: '活动方案.docx' }],
      intentClassifier: mock({ type: 'ppt', confidence: 0.95, reason: '明确要 PPT', needsClarification: false })
    },
    expect: { type: 'ppt', label: 'PPT生成', needsClarification: false }
  },
  {
    id: 'high-conf-image-search',
    text: '给这页来几张科技感发布会背景图，偏暗一点',
    options: {
      intentClassifier: mock({ type: 'image_search', confidence: 0.94, reason: '要现成背景图', needsClarification: false })
    },
    expect: { type: 'image_search', label: '找图配图', needsClarification: false }
  },
  {
    id: 'high-conf-research',
    text: '帮我搜一下最近汽车品牌快闪活动的趋势',
    options: {
      intentClassifier: mock({ type: 'research', confidence: 0.9, reason: '查趋势', needsClarification: false })
    },
    expect: { type: 'research', label: '信息搜索', needsClarification: false }
  },
  {
    id: 'continuation-follows-prior-intent',
    text: '继续',
    options: {
      session: { taskIntent: { type: 'strategy', label: '方案策划' } },
      intentClassifier: mock({ type: 'strategy', confidence: 0.88, reason: '沿用上一轮方案策划', needsClarification: false })
    },
    expect: { type: 'strategy', label: '方案策划', needsClarification: false }
  },
  {
    id: 'short-followup-question-stays-chat',
    text: '你咋知道的',
    options: {
      session: { taskIntent: { type: 'strategy', label: '方案策划' } },
      intentClassifier: mock({ type: 'strategy', confidence: 0.9, reason: '不应调用', needsClarification: false })
    },
    expect: { type: 'chat', label: '普通对话', needsClarification: false }
  },
  {
    id: 'question-mark-stays-chat',
    text: '?',
    options: {
      session: { taskIntent: { type: 'strategy', label: '方案策划' } },
      intentClassifier: mock({ type: 'strategy', confidence: 0.9, reason: '不应调用', needsClarification: false })
    },
    expect: { type: 'chat', label: '普通对话', needsClarification: false }
  },
  {
    id: 'low-confidence-becomes-clarify',
    text: '帮我搞一下这个',
    options: {
      intentClassifier: mock({ type: 'strategy', confidence: 0.32, reason: '太模糊', needsClarification: false })
    },
    expect: { type: 'chat', label: '普通对话', needsClarification: true, suggestedType: 'strategy' }
  },
  {
    id: 'model-asks-for-clarification',
    text: '你看着办吧',
    options: {
      intentClassifier: mock({ type: 'chat', confidence: 0.7, reason: '指代不明', needsClarification: true })
    },
    expect: { type: 'chat', label: '普通对话', needsClarification: true }
  },
  {
    id: 'classifier-throws-falls-to-clarify',
    text: '随便帮我做点什么',
    options: { intentClassifier: failing('network down') },
    expect: { type: 'chat', label: '普通对话', needsClarification: true }
  },
  {
    id: 'empty-input',
    text: '',
    options: { intentClassifier: mock({ type: 'strategy', confidence: 0.99, reason: '不该被调用', needsClarification: false }) },
    expect: { type: 'chat', label: '普通对话', needsClarification: false }
  }
];

async function runWrapperScenarios() {
  console.log('Intent wrapper logic');
  console.log('====================');

  for (const scenario of wrapperScenarios) {
    const intent = await detectTaskIntent(scenario.text, scenario.options);

    assert.strictEqual(intent.type, scenario.expect.type, `[${scenario.id}] type 不匹配，得到 ${intent.type}`);
    assert.strictEqual(intent.label, scenario.expect.label, `[${scenario.id}] label 不匹配，得到 ${intent.label}`);
    if ('needsClarification' in scenario.expect) {
      assert.strictEqual(
        Boolean(intent.needsClarification),
        Boolean(scenario.expect.needsClarification),
        `[${scenario.id}] needsClarification 不匹配，得到 ${intent.needsClarification}`
      );
    }
    if (scenario.expect.suggestedType) {
      assert.strictEqual(intent.suggestedType, scenario.expect.suggestedType, `[${scenario.id}] suggestedType 不匹配`);
    }
    console.log(`✓ ${scenario.id}`);
  }
}

// 这些案例描述的是"真实 LLM 应当怎么判"，是给 prompt + LLM 的回归用例。
// 离线运行时只打印；接上 LLM 后可以用同样的 detectTaskIntent 跑。
const ADVERSARIAL_CASES = [
  {
    text: '基于空间里那份需求文档，帮我生成一版活动策划方案',
    workspaceDocs: [{ name: '需求.docx', docType: 'document' }],
    expectedType: 'strategy',
    note: '"基于需求文档生成方案" 不是 doc_edit'
  },
  {
    text: '基于这份方案直接生成 PPT 吧',
    documents: [{ name: '活动方案.docx' }],
    expectedType: 'ppt',
    note: '明确要 PPT，即使有文档上下文也是 ppt'
  },
  {
    text: '把这份再润色一下，语气高级点',
    documents: [{ name: '提案.docx' }],
    expectedType: 'doc_edit',
    note: '在原文档上润色才是 doc_edit'
  },
  {
    text: '帮我搞一下',
    expectedType: 'chat',
    expectedNeedsClarification: true,
    note: '没有任何动作动词或目标，应转澄清'
  },
  {
    text: '继续',
    priorIntentType: 'strategy',
    expectedType: 'strategy',
    note: '续接语沿用上一轮意图'
  },
  {
    text: '帮我找几张科技感发布会背景图',
    expectedType: 'image_search',
    note: '要现成图'
  },
  {
    text: '帮我用 AI 重新画一张主视觉',
    expectedType: 'image_generate',
    note: 'AI 生图'
  }
];

function printAdversarialCases() {
  console.log('\nLLM regression cases (manual / e2e)');
  console.log('===================================');
  ADVERSARIAL_CASES.forEach((c, i) => {
    console.log(`${i + 1}. [${c.expectedType}] ${c.text}`);
    console.log(`   note: ${c.note}`);
  });
}

runWrapperScenarios()
  .then(() => {
    printAdversarialCases();
    console.log('\nAll wrapper-level assertions passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
