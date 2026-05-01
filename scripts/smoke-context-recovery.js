// 验证 context-length 自救：classifyLlmError 识别 + compressSessionMessagesForRecovery 压缩
// 用法：node scripts/smoke-context-recovery.js
const assert = require('assert');
const brainAgent = require('../src/agents/brainAgent');
const { classifyLlmError } = require('../src/utils/llmRetry');

const { compressSessionMessagesForRecovery } = brainAgent.__internal;

function makeSession(numMessages = 30) {
  const session = {
    sessionId: 'test',
    messages: [
      { role: 'system', content: '你是 Luna' }
    ]
  };
  for (let i = 0; i < numMessages; i++) {
    if (i % 4 === 0) {
      session.messages.push({ role: 'user', content: `用户问题 #${i}：` + 'X'.repeat(80) });
    } else if (i % 4 === 1) {
      session.messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'web_search', arguments: '{}' } }]
      });
    } else if (i % 4 === 2) {
      session.messages.push({ role: 'tool', tool_call_id: `c${i - 1}`, content: JSON.stringify({ ok: true, data: 'Y'.repeat(200) }) });
    } else {
      session.messages.push({ role: 'assistant', content: `回答 #${i}：` + 'Z'.repeat(80) });
    }
  }
  return session;
}

function testIdentifyContextLength() {
  console.log('\n[case 1] classifyLlmError 识别 context length 错误');
  // 几种常见错误信息变体
  const cases = [
    'context length exceeded',
    'maximum context length is 32000 tokens',
    'too many tokens in input',
    'please reduce the length of the messages',
    'prompt is too long for the model',
    'exceeded the model token limit'
  ];
  for (const msg of cases) {
    assert.strictEqual(classifyLlmError(new Error(msg)), 'retryable_compress', msg);
    console.log(`  ✅ "${msg}" → retryable_compress`);
  }
}

function testCompressLong() {
  console.log('\n[case 2] compressSessionMessagesForRecovery: 长对话被压缩，最近消息保留');
  const session = makeSession(30); // 1 system + 30 messages = 31
  const originalLast = session.messages[session.messages.length - 1];
  const originalLast2 = session.messages[session.messages.length - 2];
  const before = session.messages.length;

  const compressed = compressSessionMessagesForRecovery(session, 6);
  assert.strictEqual(compressed, true);
  assert.ok(session.messages.length < before, `应短于 ${before}，实际 ${session.messages.length}`);
  console.log(`  ✅ ${before} → ${session.messages.length} 条`);

  // 末尾 2 条应原样保留（identity 相同）
  assert.strictEqual(session.messages[session.messages.length - 1], originalLast, '末尾消息应原样保留');
  assert.strictEqual(session.messages[session.messages.length - 2], originalLast2, '倒数第 2 条也保留');
  console.log('  ✅ 末尾消息原样保留（同一对象引用）');

  // 应该至少有一条 system 摘要在最前
  const firstNonOriginalSystem = session.messages.find(m => m.role === 'system' && m.content?.includes('历史对话摘要'));
  assert.ok(firstNonOriginalSystem, '应注入历史摘要');
  console.log('  ✅ 历史摘要已生成');
}

function testCompressShort() {
  console.log('\n[case 3] compressSessionMessagesForRecovery: 消息很少时不压缩');
  const session = { messages: [
    { role: 'system', content: 'Luna' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' }
  ]};
  const before = session.messages.length;
  const compressed = compressSessionMessagesForRecovery(session, 6);
  assert.strictEqual(compressed, false, '消息太短不应压缩');
  assert.strictEqual(session.messages.length, before, '消息数不变');
  console.log('  ✅ 短对话不压缩，messages 不变');
}

function testCompressPreservesToolPairing() {
  console.log('\n[case 4] compressSessionMessagesForRecovery: 切点不破坏 assistant→tool 配对');
  // 构造：让 keepRecent=6 时切点正好在 tool 上
  const session = { messages: [
    { role: 'system', content: 'Luna' },
    // older（应被压缩）
    { role: 'user', content: 'old user' },
    { role: 'assistant', content: 'old reply' },
    { role: 'user', content: 'old user 2' },
    { role: 'assistant', content: 'old reply 2' },
    // recent 边界
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' }, // 这条原本切点会切到这
    { role: 'assistant', content: 'recent 1' },
    { role: 'user', content: 'recent user' },
    { role: 'assistant', content: 'recent 2' },
    { role: 'user', content: 'newest' }
  ]};
  compressSessionMessagesForRecovery(session, 6);

  // 验证：tool 一定紧跟在它的 assistant tool_calls 后面
  for (let i = 0; i < session.messages.length; i++) {
    if (session.messages[i].role === 'tool') {
      const prev = session.messages[i - 1];
      assert.ok(prev?.role === 'assistant' && Array.isArray(prev?.tool_calls),
        `tool message at ${i} 没有紧跟 assistant tool_calls`);
    }
  }
  console.log('  ✅ tool message 始终紧跟它的 assistant tool_calls，协议未破坏');
}

(async () => {
  try {
    testIdentifyContextLength();
    testCompressLong();
    testCompressShort();
    testCompressPreservesToolPairing();
    console.log('\n✅ ALL CONTEXT RECOVERY SMOKE PASSED');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ SMOKE FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
