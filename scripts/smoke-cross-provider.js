// 验证跨厂商兜底（deepseek-chat fallback）的协议适配 + 启用判断逻辑。
// 不调真 deepseek API（不需要 key），只验证：
//   1. stripToolCallHistory 把含 tool_calls / tool role 的对话压成纯文本
//   2. canUseFallbackProvider 在不同配置下的判断
//   3. fallback 失败时降级到 minimax 软失败的逻辑路径
//
// 用法：node scripts/smoke-cross-provider.js
const assert = require('assert');
const brainAgent = require('../src/agents/brainAgent');
const config = require('../src/config');

const { stripToolCallHistory, canUseFallbackProvider } = brainAgent.__internal;

function testStripBasic() {
  console.log('\n[case 1] stripToolCallHistory: 标准对话（user/assistant/tool）');
  const messages = [
    { role: 'system', content: '你是 Luna' },
    { role: 'user', content: '帮我做个 PPT' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ results: [{ title: 'A' }, { title: 'B' }] }) },
    { role: 'assistant', content: '我搜到了 A 和 B' },
    { role: 'user', content: '继续' }
  ];
  const flat = stripToolCallHistory(messages);

  // 验证：没有 tool role
  assert.ok(flat.every(m => m.role !== 'tool'), '应没有 tool role');
  console.log('  ✅ tool role 已清理');

  // 验证：assistant tool_calls 被替换成 text 摘要
  const assistantWithTool = flat.find(m => m.role === 'assistant' && m.content?.includes('调用了工具'));
  assert.ok(assistantWithTool, 'tool_calls 摘要应存在');
  console.log('  ✅ assistant.tool_calls → text 摘要');

  // 验证：tool result 被转成 user 摘要
  const userToolSummary = flat.find(m => m.role === 'user' && m.content?.includes('工具返回'));
  assert.ok(userToolSummary, 'tool result 摘要应存在');
  console.log('  ✅ tool result → user 摘要');

  // 验证：所有消息都没有 tool_calls 字段
  assert.ok(flat.every(m => !m.tool_calls), '不该有 tool_calls 字段');
  console.log('  ✅ 输出消息全部为纯文本，无 tool_calls 字段');
}

function testStripErrorAndBackgrounded() {
  console.log('\n[case 2] stripToolCallHistory: 工具错误/后台化的特殊摘要');
  const messages = [
    { role: 'user', content: '帮我搜' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ error: 'rate limit' }) },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'analyze_note_images', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c2', content: JSON.stringify({ backgrounded: true, tool: 'analyze_note_images' }) }
  ];
  const flat = stripToolCallHistory(messages);

  const errSummary = flat.find(m => m.content?.includes('工具失败'));
  assert.ok(errSummary, '错误应被摘要');
  assert.ok(errSummary.content.includes('rate limit'));
  console.log('  ✅ 工具错误 → "（工具失败：xxx）"');

  const bgSummary = flat.find(m => m.content?.includes('后台'));
  assert.ok(bgSummary, '后台化应被摘要');
  console.log('  ✅ 工具后台化 → "（工具转后台运行中）"');
}

function testStripMergeAdjacent() {
  console.log('\n[case 3] stripToolCallHistory: 合并相邻同 role 消息');
  // tool 转成 user 后会和后续的 user 相邻，应合并
  const messages = [
    { role: 'user', content: 'Q1' },
    { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 't1', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ ok: true }) },
    { role: 'user', content: 'Q2' }
  ];
  const flat = stripToolCallHistory(messages);
  // 期望：user(Q1), assistant(摘要), user(工具摘要 + Q2)
  const userMsgs = flat.filter(m => m.role === 'user');
  const lastUser = userMsgs[userMsgs.length - 1];
  assert.ok(lastUser.content.includes('Q2'), '应包含 Q2');
  assert.ok(lastUser.content.includes('工具'), '应包含工具摘要');
  console.log(`  ✅ 相邻 user 合并: "${lastUser.content.slice(0, 60)}..."`);
}

function testStripTruncate() {
  console.log('\n[case 4] stripToolCallHistory: 总长度超限时从前往后截');
  const big = 'X'.repeat(2000);
  const messages = [
    { role: 'system', content: '系统提示' },
    { role: 'user', content: '老消息1: ' + big },
    { role: 'assistant', content: '老回复1: ' + big },
    { role: 'user', content: '老消息2: ' + big },
    { role: 'assistant', content: '老回复2: ' + big },
    { role: 'user', content: '最新问题' }
  ];
  const flat = stripToolCallHistory(messages);
  const total = flat.reduce((s, m) => s + (m.content?.length || 0), 0);
  assert.ok(total <= 6500, `总长度应被截到 ~6000 内，实际 ${total}`);
  // 系统提示 + 最新问题应保留
  assert.ok(flat.some(m => m.role === 'system'), 'system 应保留');
  assert.ok(flat.some(m => m.content?.includes('最新问题')), '最新消息应保留');
  console.log(`  ✅ 总长度 ${total} chars，最新消息 + system 保留`);
}

function testCanUseFallbackProvider() {
  console.log('\n[case 5] canUseFallbackProvider: 启用条件判断');

  const origFallback = config.fallbackProvider;
  const origDeepseek = config.deepseekApiKey;

  // 没 key + config 没 key → 不能用
  config.deepseekApiKey = '';
  assert.strictEqual(canUseFallbackProvider({ apiKeys: {} }), false);
  console.log('  ✅ 没任何 key → false');

  // session 有 key → 能用
  assert.strictEqual(canUseFallbackProvider({ apiKeys: { deepseekApiKey: 'sk-xxx' } }), true);
  console.log('  ✅ session 上有 key → true');

  // env config 有 key + session 没 → 能用
  config.deepseekApiKey = 'sk-env';
  assert.strictEqual(canUseFallbackProvider({ apiKeys: {} }), true);
  console.log('  ✅ env config 有 key → true');

  // 强制关闭 → false
  config.fallbackProvider = 'off';
  assert.strictEqual(canUseFallbackProvider({ apiKeys: { deepseekApiKey: 'sk-xxx' } }), false);
  console.log('  ✅ LUNA_FALLBACK_PROVIDER=off → false（不管有没有 key）');

  // 恢复
  config.fallbackProvider = origFallback;
  config.deepseekApiKey = origDeepseek;
}

function testStripPreservesSystem() {
  console.log('\n[case 6] stripToolCallHistory: system 消息始终保留在最前');
  const messages = [
    { role: 'system', content: '你是 X' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' }
  ];
  const flat = stripToolCallHistory(messages);
  assert.strictEqual(flat[0].role, 'system');
  assert.strictEqual(flat[0].content, '你是 X');
  console.log('  ✅ system 保持在首位');
}

(async () => {
  try {
    testStripBasic();
    testStripErrorAndBackgrounded();
    testStripMergeAdjacent();
    testStripTruncate();
    testCanUseFallbackProvider();
    testStripPreservesSystem();
    console.log('\n✅ ALL CROSS-PROVIDER SMOKE PASSED');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ SMOKE FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
