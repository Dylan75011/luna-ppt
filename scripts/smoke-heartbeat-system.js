// 系统化心跳验证：所有走 callLLMJson / callLLM / callMinimaxStreamText 的 skill
// 都会把 streaming_heartbeat / blocking_wait_heartbeat 推到上层 tool，
// 上层 tool 通过 skillStatusBridge 转成 tool_progress，让 brainAgent idle watchdog 刷新。
//
// 用法：node scripts/smoke-heartbeat-system.js
const path = require('path');
const assert = require('assert');

// ─── 注入 fake LLM 客户端：模拟"持续吐短 chunk 25 秒"───────────────────
const llmClientsAbs = path.resolve(__dirname, '../src/services/llmClients.js');
require.cache[llmClientsAbs] = {
  id: llmClientsAbs, filename: llmClientsAbs, loaded: true, paths: [], children: [],
  exports: {
    callMinimax: async () => '{"ok":true}',
    callDeepseekReasoner: async () => '{"ok":true}',
    callMinimaxStreamText: async (messages, opts, onChunk) => {
      // 25s 内每 200ms 吐一个 5 字符 chunk —— 攒不齐 onSection 触发条件
      const totalMs = opts._testMs ?? 25_000;
      const stepMs = 200;
      const start = Date.now();
      while (Date.now() - start < totalMs) {
        if (opts.signal?.aborted) return;
        await new Promise(r => setTimeout(r, stepMs));
        onChunk('一二三四五');
      }
    }
  }
};

// 测试 callLLM streaming 心跳冒泡到 onStatus
async function testCallLLMHeartbeatBubble() {
  console.log('\n[case 1] callLLM streaming → onStatus 冒泡 streaming_heartbeat');
  const { callLLM } = require('../src/utils/llmUtils');
  const events = [];
  await Promise.race([
    callLLM([{ role: 'user', content: 'x' }], {
      streaming: true,
      model: 'minimax',
      runtimeKey: 'fake',
      onStatus: (s) => events.push(s)
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('case 1 超时')), 30_000))
  ]);
  const heartbeats = events.filter(e => e.status === 'streaming_heartbeat');
  // 25s / 8s = ~3 次心跳
  assert.ok(heartbeats.length >= 2, `streaming_heartbeat 应至少 2 次，实际 ${heartbeats.length}`);
  assert.ok(heartbeats[heartbeats.length - 1].chars > 0, '心跳应携带 chars 计数');
  console.log(`  ✅ callLLM streaming 在 25s 内推 ${heartbeats.length} 次 streaming_heartbeat`);
  console.log(`     最后一次 chars=${heartbeats[heartbeats.length - 1].chars}`);
}

// 测试 callLLMJson 透传 onStatus 给 callLLM
async function testCallLLMJsonForwardsOnStatus() {
  console.log('\n[case 2] callLLMJson 把 onStatus 透传给 callLLM');
  // 模拟一个返回有效 JSON 的 stream
  require.cache[llmClientsAbs].exports.callMinimaxStreamText =
    async (messages, opts, onChunk) => {
      const start = Date.now();
      while (Date.now() - start < 18_000) {
        if (opts.signal?.aborted) return;
        await new Promise(r => setTimeout(r, 200));
        onChunk('a');
      }
      onChunk('{"ok": true}');
    };
  // 重置 require cache 让 llmUtils 重新引用 fake
  delete require.cache[path.resolve(__dirname, '../src/utils/llmUtils.js')];
  const { callLLMJson } = require('../src/utils/llmUtils');

  const events = [];
  await Promise.race([
    callLLMJson([{ role: 'user', content: 'x' }], {
      streaming: true,
      model: 'minimax',
      runtimeKey: 'fake',
      maxTokens: 100,
      validate: (j) => j,
      onStatus: (s) => events.push(s),
      fallback: () => ({ ok: 'fallback' })
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('case 2 超时')), 25_000))
  ]);
  const heartbeats = events.filter(e => e.status === 'streaming_heartbeat');
  assert.ok(heartbeats.length >= 2, `心跳应冒泡上来，实际 ${heartbeats.length}`);
  console.log(`  ✅ callLLMJson 透传 onStatus 成功，收到 ${heartbeats.length} 次心跳`);
}

// 测试 skillStatusBridge：所有 status 都映射成 tool_progress
async function testSkillStatusBridge() {
  console.log('\n[case 3] skillStatusBridge 把各种 status 转成 tool_progress');
  const { makeSkillStatusBridge } = require('../src/services/tools/skillStatusBridge');
  const events = [];
  const onEvent = (type, data) => events.push({ type, data });
  const handleStatus = makeSkillStatusBridge(onEvent, { skillLabel: '测试' });

  handleStatus({ status: 'streaming_heartbeat', chars: 100 });
  handleStatus({ status: 'blocking_wait_heartbeat', attempt: 1 });
  handleStatus({ status: 'retrying', attempt: 2 });
  handleStatus({ status: 'repairing' });
  handleStatus({ status: 'fallback_start' });
  handleStatus({ status: 'beautifying' });
  handleStatus({ status: 'requesting' }); // 不该推（噪音过滤）
  handleStatus({ status: 'received' });   // 不该推

  const progress = events.filter(e => e.type === 'tool_progress');
  assert.strictEqual(progress.length, 6, `应推 6 条 tool_progress（heartbeat×2 + retry/repair/fallback/beautify），实际 ${progress.length}`);
  assert.ok(progress[0].data.message.includes('100 字'), 'streaming_heartbeat 应带字数');
  assert.ok(progress[1].data.message.includes('等待模型响应'), 'blocking_wait 应表明等待');
  assert.ok(progress[2].data.message.includes('重试'), 'retrying 应表明重试');
  assert.ok(progress[3].data.message.includes('修复'), 'repairing 应表明修复');
  assert.ok(progress[4].data.message.includes('兜底'), 'fallback_start 应表明兜底');
  console.log(`  ✅ bridge 正确转换 6 类 status，2 类噪音被过滤`);
}

// 测试 onCustom 优先级
async function testSkillStatusBridgeCustom() {
  console.log('\n[case 4] skillStatusBridge 的 onCustom 优先于默认行为');
  const { makeSkillStatusBridge } = require('../src/services/tools/skillStatusBridge');
  const events = [];
  const onEvent = (type, data) => events.push({ type, data });

  let customCalled = 0;
  const handleStatus = makeSkillStatusBridge(onEvent, {
    skillLabel: '测试',
    onCustom: (status, payload) => {
      customCalled++;
      if (status === 'streaming_heartbeat') {
        onEvent('tool_progress', { message: `自定义心跳：${payload.chars} 字` });
        return true; // 已处理，bridge 不再走默认
      }
      return false;
    }
  });

  handleStatus({ status: 'streaming_heartbeat', chars: 50 });
  handleStatus({ status: 'fallback_start' }); // onCustom 返回 false → bridge 默认处理

  assert.strictEqual(customCalled, 2);
  assert.strictEqual(events.length, 2);
  assert.ok(events[0].data.message.includes('自定义心跳'), 'onCustom 路径生效');
  assert.ok(events[1].data.message.includes('兜底'), 'onCustom 返回 false 走默认');
  console.log('  ✅ onCustom 优先级正确，返回 false 时回落到默认行为');
}

// 测试 buildNextActionHint：每种 errorClass 都有具体建议（直接函数测试，不静态扫源码）
async function testNextActionHint() {
  console.log('\n[case 5] hard fail 错误信息按 errorClass 给具体建议');
  const { buildNextActionHint } = require('../src/utils/llmRetry');

  for (const [cls, errMsg, mustInclude] of [
    ['fatal', '401 unauthorized', '401'],
    ['fatal', 'quota exceeded', '配额'],
    ['retryable_compress', 'context length exceeded', '历史'],
    ['retryable_protocol', '400 invalid function arguments', '工具调用格式'],
    ['retryable_transport', '502 Bad Gateway', '网络'],
    ['user_abort', 'aborted', '停止'],
    ['unknown', 'something weird', '未识别'],
  ]) {
    const hint = buildNextActionHint(cls, new Error(errMsg));
    assert.ok(hint && hint.length > 10, `${cls} 应返回非空建议`);
    assert.ok(hint.includes(mustInclude), `${cls} 路径应提到 "${mustInclude}"，实际：${hint.slice(0, 60)}`);
    console.log(`  ✅ ${cls} → "${hint.slice(0, 35)}..."`);
  }
}

(async () => {
  try {
    await testCallLLMHeartbeatBubble();
    await testCallLLMJsonForwardsOnStatus();
    await testSkillStatusBridge();
    await testSkillStatusBridgeCustom();
    await testNextActionHint();
    console.log('\n✅ ALL HEARTBEAT-SYSTEM SMOKE PASSED');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ SMOKE FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
