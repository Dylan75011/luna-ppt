// 验证 idle-aware budget：工具持续 emit 进度事件时不会被误判为挂死，
// 只有真没动静超过 budget 才转后台。
// 用法：node scripts/smoke-idle-budget.js
const assert = require('assert');
const path = require('path');

// 注入 fake toolRegistry：模拟"长任务、持续吐进度"的工具
const toolRegistryAbs = path.resolve(__dirname, '../src/services/tools/index.js');
require.cache[toolRegistryAbs] = {
  id: toolRegistryAbs, filename: toolRegistryAbs, loaded: true, paths: [], children: [],
  exports: {
    TOOL_DEFINITIONS: [],
    getToolDisplay: (n) => n,
    executeTool: async (toolName, args, session, onEvent) => {
      if (toolName === 'fake_streaming') {
        // 持续吐进度 600ms（每 100ms 一次），budget 200ms 但不应触发——因为有进度
        const totalMs = args?.totalMs ?? 600;
        const stepMs = args?.stepMs ?? 100;
        const steps = Math.ceil(totalMs / stepMs);
        for (let i = 0; i < steps; i++) {
          await new Promise(r => setTimeout(r, stepMs));
          onEvent('doc_section_added', { progress: (i + 1) * (90 / steps), title: 'test' });
        }
        return { ok: true, sections: steps };
      }
      if (toolName === 'fake_silent_long') {
        // 静默挂 600ms 不发任何 event——idle budget 200ms 应该兜住转后台
        await new Promise(r => setTimeout(r, args?.totalMs ?? 600));
        return { ok: true };
      }
      throw new Error('unknown tool: ' + toolName);
    }
  }
};

const brainAgent = require('../src/agents/brainAgent');
const agentSession = require('../src/services/agentSession');
const { runToolWithBudget } = brainAgent.__internal;

async function testIdleBudgetSurvivesProgress() {
  console.log('\n[case 1] idle budget: 工具持续吐进度 → 不应转后台');
  const session = agentSession.createSession({ apiKeys: {} });
  session.status = 'running';
  session.messages = [];

  const events = [];
  const onEvent = (type, data) => events.push({ type, data });

  const t0 = Date.now();
  const out = await runToolWithBudget({
    session, onEvent,
    toolCallId: 'c1', toolName: 'fake_streaming',
    args: { totalMs: 600, stepMs: 100 },
    budgetMs: 200,        // 200ms idle budget——比工具 step 长，但比工具总时长短
    budgetKind: 'idle'
  });
  const dt = Date.now() - t0;
  assert.strictEqual(out.status, 'ok', `工具应正常完成，实际 status=${out.status}`);
  assert.ok(out.result.ok === true, '应返回真实结果');
  assert.ok(dt >= 600 && dt < 1000, `应等到工具完成（~600ms），实际 ${dt}ms`);
  // doc_section_added 多次刷新了 lastProgressAt，watchdog 永不触发
  console.log(`  ✅ 工具持续 600ms 期间 emit ${out.result.sections} 次进度，全程不被误转后台（耗时 ${dt}ms）`);

  agentSession.deleteSession(session.sessionId);
}

async function testIdleBudgetCatchesSilent() {
  console.log('\n[case 2] idle budget: 工具静默挂死 → 200ms 后转后台');
  const session = agentSession.createSession({ apiKeys: {} });
  session.status = 'running';
  session.messages = [];

  const events = [];
  const onEvent = (type, data) => events.push({ type, data });

  const t0 = Date.now();
  const out = await runToolWithBudget({
    session, onEvent,
    toolCallId: 'c2', toolName: 'fake_silent_long',
    args: { totalMs: 600 },
    budgetMs: 200,
    budgetKind: 'idle'
  });
  const dt = Date.now() - t0;
  assert.strictEqual(out.status, 'backgrounded', `静默挂死应转后台，实际 ${out.status}`);
  // watchdog 间隔 500ms，所以最快也要 500ms 才能检测到 idle 超过 200ms
  assert.ok(dt < 800, `应快速转后台，实际 ${dt}ms`);
  console.log(`  ✅ 静默 600ms 在 ${dt}ms 内识别为挂死并转后台`);

  agentSession.deleteSession(session.sessionId);
}

async function testTotalBudgetStillWorks() {
  console.log('\n[case 3] total budget: 即使有进度，到点必定转后台（与 idle 区分）');
  const session = agentSession.createSession({ apiKeys: {} });
  session.status = 'running';
  session.messages = [];

  const events = [];
  const onEvent = (type, data) => events.push({ type, data });

  const t0 = Date.now();
  const out = await runToolWithBudget({
    session, onEvent,
    toolCallId: 'c3', toolName: 'fake_streaming',
    args: { totalMs: 1500, stepMs: 100 },
    budgetMs: 400,           // 400ms total
    budgetKind: 'total'      // ← 不管有没有进度，到点就转
  });
  const dt = Date.now() - t0;
  assert.strictEqual(out.status, 'backgrounded', '即使工具在吐进度，total 模式到点也转');
  assert.ok(dt < 1100, `应在 ~400ms 后转后台（含 watchdog 500ms 间隔），实际 ${dt}ms`);
  console.log(`  ✅ total 模式不看进度事件，${dt}ms 内转后台`);

  agentSession.deleteSession(session.sessionId);
}

async function testRunStrategyConfigIsIdle() {
  console.log('\n[case 4] 配置审查：长任务工具都是 idle kind');
  const fs = require('fs');
  const src = fs.readFileSync(path.resolve(__dirname, '../src/agents/brainAgent.js'), 'utf-8');
  const match = src.match(/const TOOL_BUDGET = \{[\s\S]+?\n\};/);
  assert.ok(match, 'TOOL_BUDGET 应存在');
  const cfg = match[0];
  for (const tool of ['build_ppt', 'run_strategy', 'review_strategy', 'propose_concept', 'challenge_brief']) {
    const re = new RegExp(`${tool}:.*kind:\\s*'idle'`);
    assert.ok(re.test(cfg), `${tool} 应配置为 idle kind`);
    console.log(`  ✅ ${tool}: idle kind`);
  }
  for (const tool of ['web_search', 'web_fetch', 'generate_image', 'search_images']) {
    const re = new RegExp(`${tool}:.*kind:\\s*'total'`);
    assert.ok(re.test(cfg), `${tool} 应配置为 total kind`);
    console.log(`  ✅ ${tool}: total kind`);
  }
}

(async () => {
  try {
    await testIdleBudgetSurvivesProgress();
    await testIdleBudgetCatchesSilent();
    await testTotalBudgetStillWorks();
    await testRunStrategyConfigIsIdle();
    console.log('\n✅ ALL IDLE-BUDGET SMOKE PASSED');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ SMOKE FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
