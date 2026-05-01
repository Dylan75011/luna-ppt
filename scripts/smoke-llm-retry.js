// 验证 L1 (transport 重试) + L2 (软失败兜底) + classifyLlmError 行为。
// 用法：node scripts/smoke-llm-retry.js
const assert = require('assert');
const { classifyLlmError, retryLlmCall } = require('../src/utils/llmRetry');
const { TimeoutError, AbortError } = require('../src/utils/abortx');

async function testClassify() {
  console.log('\n[case 1] classifyLlmError 分类');

  // user stop
  const userStop = new AbortError('user_stop');
  assert.strictEqual(classifyLlmError(userStop), 'user_abort');
  console.log('  ✅ user_stop → user_abort');

  // idle timeout (TimeoutError)
  const idle = new TimeoutError('llm_stream_idle', 30000);
  assert.strictEqual(classifyLlmError(idle), 'retryable_transport');
  console.log('  ✅ idle TimeoutError → retryable_transport');

  // total budget timeout
  const total = new TimeoutError('llm_total_budget', 90000);
  assert.strictEqual(classifyLlmError(total), 'retryable_transport');
  console.log('  ✅ total budget TimeoutError → retryable_transport');

  // 401 unauthorized
  assert.strictEqual(classifyLlmError(new Error('401 unauthorized')), 'fatal');
  console.log('  ✅ 401 → fatal');

  // 403 forbidden
  assert.strictEqual(classifyLlmError(new Error('Request 403 Forbidden')), 'fatal');
  console.log('  ✅ 403 → fatal');

  // quota exceeded
  assert.strictEqual(classifyLlmError(new Error('rate limit exceeded')), 'fatal');
  console.log('  ✅ rate limit exceeded → fatal');

  // context length —— 不是 fatal，而是可压缩重试（brainAgent 自己处理）
  assert.strictEqual(classifyLlmError(new Error('context length exceeded')), 'retryable_compress');
  console.log('  ✅ context length → retryable_compress（自救压缩）');
  assert.strictEqual(classifyLlmError(new Error('prompt is too long for the context')), 'retryable_compress');
  console.log('  ✅ prompt too long → retryable_compress');
  assert.strictEqual(classifyLlmError(new Error('please reduce the length of the messages')), 'retryable_compress');
  console.log('  ✅ reduce the length → retryable_compress');

  // 5xx
  assert.strictEqual(classifyLlmError(new Error('502 Bad Gateway')), 'retryable_transport');
  console.log('  ✅ 502 → retryable_transport');

  // ECONNRESET
  assert.strictEqual(classifyLlmError(new Error('socket ECONNRESET')), 'retryable_transport');
  console.log('  ✅ ECONNRESET → retryable_transport');

  // 400 invalid args
  assert.strictEqual(classifyLlmError(new Error('400 invalid function arguments')), 'retryable_protocol');
  console.log('  ✅ 400 invalid args → retryable_protocol');

  // unknown
  assert.strictEqual(classifyLlmError(new Error('something unexpected')), 'unknown');
  console.log('  ✅ 未识别错误 → unknown');
}

async function testRetrySuccess() {
  console.log('\n[case 2] retryLlmCall: 第一次就成功');
  let attempts = 0;
  const result = await retryLlmCall(async () => {
    attempts++;
    return 'ok';
  });
  assert.strictEqual(result, 'ok');
  assert.strictEqual(attempts, 1);
  console.log('  ✅ 1 次成功，无重试');
}

async function testRetryEventuallySuccess() {
  console.log('\n[case 3] retryLlmCall: 前 2 次 transport 失败，第 3 次成功');
  let attempts = 0;
  const result = await retryLlmCall(
    async () => {
      attempts++;
      if (attempts < 3) throw new Error('socket ECONNRESET');
      return 'recovered';
    },
    { backoffs: [50, 100] } // 短退避加速测试
  );
  assert.strictEqual(result, 'recovered');
  assert.strictEqual(attempts, 3);
  console.log('  ✅ 第 3 次 attempt 成功，重试机制工作');
}

async function testRetryExhausted() {
  console.log('\n[case 4] retryLlmCall: 全部失败 → 抛最后错误');
  let attempts = 0;
  try {
    await retryLlmCall(
      async () => {
        attempts++;
        throw new Error('502 Bad Gateway');
      },
      { backoffs: [20, 40] }
    );
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e.message.includes('502'));
  }
  assert.strictEqual(attempts, 3, '应试 3 次（1 + 2 重试）');
  console.log('  ✅ 用尽 3 次后抛最后错误');
}

async function testRetryNoRetryOnFatal() {
  console.log('\n[case 5] retryLlmCall: fatal 错误立刻抛，不重试');
  let attempts = 0;
  try {
    await retryLlmCall(async () => {
      attempts++;
      throw new Error('401 unauthorized');
    }, { backoffs: [20, 40] });
    assert.fail();
  } catch (e) {
    assert.ok(e.message.includes('401'));
  }
  assert.strictEqual(attempts, 1, 'fatal 不重试');
  console.log('  ✅ 401 立刻抛，0 次重试');
}

async function testRetryNoRetryOnUnknown() {
  console.log('\n[case 6] retryLlmCall: unknown 错误立刻抛（保守不重试）');
  let attempts = 0;
  try {
    await retryLlmCall(async () => {
      attempts++;
      throw new Error('weird unknown error');
    }, { backoffs: [20, 40] });
    assert.fail();
  } catch (e) {
    assert.ok(e.message.includes('weird'));
  }
  assert.strictEqual(attempts, 1, 'unknown 不重试');
  console.log('  ✅ unknown 不重试，避免无限循环');
}

async function testRetryProtocolNotRetried() {
  console.log('\n[case 7] retryLlmCall: 400 protocol 错误抛给 caller（caller 自己处理）');
  let attempts = 0;
  try {
    await retryLlmCall(async () => {
      attempts++;
      throw new Error('400 invalid function arguments');
    }, { backoffs: [20, 40] });
    assert.fail();
  } catch (e) {
    assert.ok(e.message.includes('400'));
  }
  assert.strictEqual(attempts, 1, 'protocol 不重试');
  console.log('  ✅ 400 invalid args 立刻抛给 caller（已有清坏消息逻辑）');
}

async function testRetryWithExternalSignal() {
  console.log('\n[case 8] retryLlmCall: 外部 abort signal → 立刻终止');
  const ac = new AbortController();
  let attempts = 0;
  setTimeout(() => ac.abort('user_stop'), 80);
  try {
    await retryLlmCall(
      async () => {
        attempts++;
        throw new Error('502 retry me');
      },
      { backoffs: [200, 200], signal: ac.signal }
    );
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof AbortError || e.name === 'AbortError', `expected AbortError, got ${e.constructor.name}`);
  }
  // 第一次 attempt 抛 502 → 排队 200ms 重试 → 80ms 时 abort → 不再 attempt
  assert.ok(attempts <= 2, `attempts=${attempts}，期望 ≤ 2`);
  console.log(`  ✅ 外部 signal abort 终止重试链（attempts=${attempts}）`);
}

async function testRetryOnRetryCallback() {
  console.log('\n[case 9] retryLlmCall: onRetry 回调被调用');
  const events = [];
  let attempts = 0;
  try {
    await retryLlmCall(
      async () => { attempts++; throw new Error('socket hang up'); },
      {
        backoffs: [10, 20],
        onRetry: ({ attempt, error, waitMs }) => events.push({ attempt, msg: error.message, waitMs })
      }
    );
  } catch {}
  assert.strictEqual(events.length, 2, '应有 2 次重试通知');
  assert.strictEqual(events[0].waitMs, 10);
  assert.strictEqual(events[1].waitMs, 20);
  console.log(`  ✅ onRetry 触发 ${events.length} 次，waitMs 序列正确`);
}

(async () => {
  try {
    await testClassify();
    await testRetrySuccess();
    await testRetryEventuallySuccess();
    await testRetryExhausted();
    await testRetryNoRetryOnFatal();
    await testRetryNoRetryOnUnknown();
    await testRetryProtocolNotRetried();
    await testRetryWithExternalSignal();
    await testRetryOnRetryCallback();
    console.log('\n✅ ALL LLM RETRY SMOKE PASSED');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ SMOKE FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
