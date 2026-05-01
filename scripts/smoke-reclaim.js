// 端到端验证 race → auto-background → reclaim → 系统注入 全链路。
// 用法：node scripts/smoke-reclaim.js
//
// 思路：通过 require.cache 注入 fake toolRegistry，模拟一个慢工具
// （比 budget 慢），让 brainAgent.runToolWithBudget 真实走 race 流程。
// 不依赖 LLM / 网络 / API key。
const path = require('path');
const assert = require('assert');

// ─── 1. 注入 fake toolRegistry，让 executeTool 走我们的 stub ───────────
const toolRegistryAbs = path.resolve(__dirname, '../src/services/tools/index.js');
const fakeRegistry = {
  TOOL_DEFINITIONS: [],
  getToolDisplay: (name) => name,
  executeTool: async (toolName, args /*, session, onEvent */) => {
    if (toolName === 'fake_slow') {
      const ms = args?.delayMs ?? 300;
      await new Promise(r => setTimeout(r, ms));
      return { ok: true, message: `slept ${ms}ms`, args };
    }
    if (toolName === 'fake_slow_fail') {
      const ms = args?.delayMs ?? 300;
      await new Promise(r => setTimeout(r, ms));
      throw new Error('fake_failure_after_delay');
    }
    if (toolName === 'fake_fast') {
      return { ok: true, fast: true };
    }
    throw new Error(`unknown tool: ${toolName}`);
  }
};
require.cache[toolRegistryAbs] = {
  id: toolRegistryAbs, filename: toolRegistryAbs, loaded: true,
  exports: fakeRegistry, paths: [], children: []
};

// ─── 2. require brainAgent 与 agentSession ────────────────────────────
const brainAgent = require('../src/agents/brainAgent');
const agentSession = require('../src/services/agentSession');

const { runToolWithBudget, drainPendingBackgroundInjects } = brainAgent.__internal;

// ─── 3. 把 TOOL_BUDGET_DEFAULT_MS 间接覆盖：读源代码常量太麻烦，
// 直接给 args 里指定一个比 budget 长的 delay 来触发超时。
// brainAgent 默认 budget 是 30s，太长。我们通过为 fake_slow 设一个
// 覆盖：TOOL_BUDGET_MS[fake_slow] = 100ms ——但 brainAgent 模块内的
// 常量我们不能改。改用更直接的：调 runToolWithBudget 时它内部读
// TOOL_BUDGET_MS[toolName] || 30s。我们让 fake_slow 用 30s default
// 也太长。所以走"猴子补丁"：直接修改 brainAgent require 出来的对象。
//
// 实际上 TOOL_BUDGET_MS 是模块作用域 const，外面改不到。
// 解决办法：把我们的"慢工具"等待时间设置成可控小值，并通过 monkey-patch
// 内部 export 的常量——这里没法。
//
// 折中：用 fake_slow 的 delayMs=200ms，配合一个非常 small 的 budget。
// 但 budget 是 const TOOL_BUDGET_DEFAULT_MS 写死的。
// 最简单的方法：临时改 brainAgent 暴露一个 setBudget。
// 我懒得改源代码，改成"工具内部慢得超过 30s 不现实"——所以改思路：
//
// **真正的验证**：直接调 enqueueBackgroundTask + 一个手工 race 模拟，
// 验证 reclaim 行为正确。runToolWithBudget 自己的 race 行为靠
// 单元逻辑断言（race 输出 status='backgrounded' 当 budget 小时）。
//
// 但 runToolWithBudget 没暴露"自定义 budget"接口。OK，那就直接构造
// 一个会被 backgrounded 的场景：让 fake_slow delay 比 default budget
// 长——不现实（30s 等不起）。
//
// 最简：内联复现 runToolWithBudget 的内部逻辑，用极小 budget 跑一遍。
// 我们已经有 enqueueBackgroundTask + drainPendingBackgroundInjects，
// 这两个是 reclaim 的核心，单独验证它们已经够。

const { enqueueBackgroundTask } = brainAgent.__internal;

async function testReclaimSuccess() {
  console.log('\n[case 1] reclaim: 后台任务成功完成 → 注入到 session.messages');
  const session = agentSession.createSession({ apiKeys: {} });
  session.status = 'running';
  session.messages = [];

  // 模拟 race 失败：构造一个还在跑的真 promise，把它丢到 enqueueBackgroundTask
  const realPromise = new Promise((resolve) => {
    setTimeout(() => resolve({ ok: true, data: 'late_real_result', size: 1234 }), 60);
  });

  enqueueBackgroundTask(session, {
    toolCallId: 'call_xxx_1',
    toolName: 'web_fetch',
    promise: realPromise
  });

  // 立刻验证：backgroundTasks Map 里有这一项
  assert.strictEqual(session.backgroundTasks.size, 1, 'backgroundTasks 应有 1 项');
  assert.ok(session.backgroundTasks.has('call_xxx_1'));
  console.log('  ✅ enqueueBackgroundTask: backgroundTasks 已记录');

  // 等真 promise resolve + finish 处理完
  await new Promise(r => setTimeout(r, 120));

  // 验证：backgroundTasks 已清空（finish 删除了）
  assert.strictEqual(session.backgroundTasks.size, 0, 'finish 后应清空');
  console.log('  ✅ finish 后 backgroundTasks 自动清空');

  // 验证：session.messages 多了一条注入消息（status === 'running'）
  assert.strictEqual(session.messages.length, 1, '应注入 1 条消息');
  const injected = session.messages[0];
  assert.strictEqual(injected.role, 'user');
  assert.ok(injected.content.includes('系统注入'));
  assert.ok(injected.content.includes('web_fetch'));
  assert.ok(injected.content.includes('call_xxx_1'));
  assert.ok(injected.content.includes('late_real_result'));
  assert.ok(injected._backgroundInject === true);
  console.log('  ✅ session.messages 已注入"[系统注入｜后台任务返回]"消息');
  console.log('     片段:', injected.content.slice(0, 80) + '...');

  // 验证：SSE backlog 里有 background_done 事件
  const sse = session.eventBacklog.find(ev => ev.eventType === 'background_done');
  assert.ok(sse, 'SSE backlog 应有 background_done 事件');
  assert.ok(sse.raw.includes('"toolCallId":"call_xxx_1"'));
  assert.ok(sse.raw.includes('"status":"success"'));
  assert.ok(sse.raw.includes('"toolName":"web_fetch"'));
  console.log('  ✅ SSE backlog 已记录 background_done 事件');

  agentSession.deleteSession(session.sessionId);
}

async function testReclaimError() {
  console.log('\n[case 2] reclaim: 后台任务失败 → 错误也注入');
  const session = agentSession.createSession({ apiKeys: {} });
  session.status = 'running';
  session.messages = [];

  const realPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('fake_backend_500')), 50);
  });

  enqueueBackgroundTask(session, {
    toolCallId: 'call_err_1',
    toolName: 'generate_image',
    promise: realPromise
  });

  await new Promise(r => setTimeout(r, 120));

  assert.strictEqual(session.backgroundTasks.size, 0);
  assert.strictEqual(session.messages.length, 1);
  const injected = session.messages[0];
  assert.ok(injected.content.includes('执行失败'));
  assert.ok(injected.content.includes('fake_backend_500'));
  console.log('  ✅ 错误情况也注入到 messages');

  const sse = session.eventBacklog.find(ev => ev.eventType === 'background_done');
  assert.ok(sse.raw.includes('"status":"error"'));
  console.log('  ✅ SSE 事件状态正确为 error');

  agentSession.deleteSession(session.sessionId);
}

async function testReclaimWhenIdle() {
  console.log('\n[case 3] reclaim: session 已 idle 时 → push 到 pendingBackgroundInjects 等下轮');
  const session = agentSession.createSession({ apiKeys: {} });
  session.status = 'idle';
  session.messages = [];

  const realPromise = new Promise((resolve) => setTimeout(() => resolve({ data: 'late' }), 40));
  enqueueBackgroundTask(session, {
    toolCallId: 'call_idle_1',
    toolName: 'search_images',
    promise: realPromise
  });

  await new Promise(r => setTimeout(r, 100));

  // 因为 session.status === 'idle'，结果 push 到 pendingBackgroundInjects 而非 messages
  assert.strictEqual(session.messages.length, 0, 'idle 状态不该污染 messages');
  assert.strictEqual((session.pendingBackgroundInjects || []).length, 1);
  console.log('  ✅ idle 时 push 到 pendingBackgroundInjects（不污染 messages）');

  // 模拟下一次 run/resume 入口处的 drain
  drainPendingBackgroundInjects(session);
  assert.strictEqual(session.messages.length, 1, 'drain 后应进 messages');
  assert.strictEqual((session.pendingBackgroundInjects || []).length, 0, 'pending 应清空');
  console.log('  ✅ drainPendingBackgroundInjects 把暂存消息合并进对话历史');

  agentSession.deleteSession(session.sessionId);
}

async function testCancelAllAfterStop() {
  console.log('\n[case 4] stop 后 cancelAllBackgroundTasks → 后续真实结果不会幽灵注入');
  const session = agentSession.createSession({ apiKeys: {} });
  session.status = 'running';
  session.messages = [];

  // 启一个慢任务
  const realPromise = new Promise((resolve) => setTimeout(() => resolve({ ghost: true }), 200));
  enqueueBackgroundTask(session, {
    toolCallId: 'call_ghost_1',
    toolName: 'web_search',
    promise: realPromise
  });
  assert.strictEqual(session.backgroundTasks.size, 1);

  // 50ms 后用户 stop —— 期间真任务还没结束
  await new Promise(r => setTimeout(r, 50));
  brainAgent.cancelAllBackgroundTasks(session);
  assert.strictEqual(session.backgroundTasks.size, 0, 'cancelAll 后清空');

  // 等真 promise resolve（200ms）+ 一些缓冲
  await new Promise(r => setTimeout(r, 250));

  // 验证：messages / pending 都没被注入（cancelled 标记拦截了 finish）
  assert.strictEqual(session.messages.length, 0, 'cancelled 后不应再注入 messages');
  assert.strictEqual((session.pendingBackgroundInjects || []).length, 0);
  console.log('  ✅ cancel 后真实结果到达也不再注入');

  agentSession.deleteSession(session.sessionId);
}

async function testRunToolWithBudgetFastPath() {
  console.log('\n[case 5] runToolWithBudget: 工具够快 → status=ok');
  const session = agentSession.createSession({ apiKeys: {} });
  session.status = 'running';

  let lastEvent = null;
  const onEvent = (type, data) => { lastEvent = { type, data }; };

  // fake_fast 不需要 delay，立即返回
  const out = await runToolWithBudget({
    session, onEvent,
    toolCallId: 'call_fast', toolName: 'fake_fast', args: {}
  });
  assert.strictEqual(out.status, 'ok');
  assert.deepStrictEqual(out.result, { ok: true, fast: true });
  assert.strictEqual(session.backgroundTasks?.size || 0, 0, '快路径不该入后台');
  console.log('  ✅ 快路径 status=ok，无后台任务');

  agentSession.deleteSession(session.sessionId);
}

async function testRunToolWithBudgetTimeoutPath() {
  console.log('\n[case 6] runToolWithBudget: 工具超慢 → status=backgrounded + 后台真完成 → 注入');
  const session = agentSession.createSession({ apiKeys: {} });
  session.status = 'running';
  session.messages = [];
  const events = [];
  const onEvent = (type, data) => events.push({ type, data });

  // fake_slow 实际耗时 1500ms，budget 强制 600ms total → 必超时
  // 注意：runToolWithBudget 用 setInterval 500ms watchdog，所以 budget 必须 ≥ 500ms 才能精准
  const startedAt = Date.now();
  const out = await runToolWithBudget({
    session, onEvent,
    toolCallId: 'call_slow_1',
    toolName: 'fake_slow',
    args: { delayMs: 1500 },
    budgetMs: 600,
    budgetKind: 'total'
  });
  const raceTook = Date.now() - startedAt;

  assert.strictEqual(out.status, 'backgrounded', 'race 超时应返回 backgrounded');
  assert.ok(out.result.backgrounded === true);
  // watchdog 500ms 检查一次，所以 budget=600ms 实际触发在 600-1100ms 之间
  assert.ok(raceTook >= 500 && raceTook < 1200, `race 应在 ~600-1000ms 返回，实际 ${raceTook}ms`);
  console.log(`  ✅ race 在 ${raceTook}ms 内返回 status=backgrounded`);

  // 验证：tool_progress "已转后台" 事件已推
  const progressEvent = events.find(e => e.type === 'tool_progress');
  assert.ok(progressEvent, '应推送 tool_progress 事件');
  assert.ok(progressEvent.data.message.includes('已转后台'));
  console.log(`  ✅ tool_progress 事件: "${progressEvent.data.message}"`);

  // 验证：backgroundTasks 里有这一项
  assert.strictEqual(session.backgroundTasks.size, 1);

  // 等 fake_slow 真完成（1500ms - race 已耗 ~600ms = 还需 ~900ms + 缓冲）
  await new Promise(r => setTimeout(r, 1100));

  // 验证：真完成后的注入
  assert.strictEqual(session.backgroundTasks.size, 0, '真完成后清空');
  assert.strictEqual(session.messages.length, 1, '应注入 1 条系统消息');
  const injected = session.messages[0];
  assert.ok(injected.content.includes('fake_slow'));
  assert.ok(injected.content.includes('slept 1500ms'));
  console.log('  ✅ 真任务完成后已注入到 session.messages');

  // 验证：SSE backlog 里有 background_done
  const sse = session.eventBacklog.find(ev => ev.eventType === 'background_done');
  assert.ok(sse, 'SSE backlog 应有 background_done');
  assert.ok(sse.raw.includes('"toolName":"fake_slow"'));
  assert.ok(sse.raw.includes('"status":"success"'));
  console.log('  ✅ SSE backlog 已记录 background_done');

  agentSession.deleteSession(session.sessionId);
}

(async () => {
  try {
    await testReclaimSuccess();
    await testReclaimError();
    await testReclaimWhenIdle();
    await testCancelAllAfterStop();
    await testRunToolWithBudgetFastPath();
    await testRunToolWithBudgetTimeoutPath();
    console.log('\n✅ ALL SMOKE CHECKS PASSED');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ SMOKE FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
