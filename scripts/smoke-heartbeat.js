// 验证 generatePlanDoc 的流式心跳：当 LLM 持续吐短 chunk（攒不够 onSection 触发条件），
// onStatus 仍然通过 streaming_heartbeat 推保活信号给上层，避免 idle watchdog 误判挂死。
// 用法：node scripts/smoke-heartbeat.js
const path = require('path');
const assert = require('assert');

// 注入 fake callMinimaxStreamText：模拟"持续吐短 chunk 30 秒"
const llmClientsAbs = path.resolve(__dirname, '../src/services/llmClients.js');
require.cache[llmClientsAbs] = {
  id: llmClientsAbs, filename: llmClientsAbs, loaded: true, paths: [], children: [],
  exports: {
    callMinimax: () => { throw new Error('not used'); },
    callDeepseekReasoner: () => { throw new Error('not used'); },
    callMinimaxStreamText: async (messages, opts, onChunk) => {
      // 30 秒内每 200ms 吐一个 5 字符 chunk —— 总共 150 个 chunk × 5 = 750 字符
      // 不够 80 字（onSection 首次阈值）的窗口约 16 个 chunk = 3.2 秒
      // 之后还是要等遇到 \n## 才再次触发 onSection
      // 心跳应该每 8s 触发一次 → 30s 内至少 3 次
      const totalMs = opts._testTotalMs ?? 30_000;
      const stepMs = 200;
      const stepText = '一二三四五';
      const start = Date.now();
      while (Date.now() - start < totalMs) {
        if (opts.signal?.aborted) return;
        await new Promise(r => setTimeout(r, stepMs));
        onChunk(stepText);
      }
    }
  }
};

// 跑 generatePlanDoc 主路径
const { generatePlanDoc } = require('../src/skills/generatePlanDoc');

async function testHeartbeatDuringMain() {
  console.log('\n[case 1] 主流式阶段持续 8s+ 不触发 onSection 时，onStatus 应推 heartbeat');

  const heartbeatEvents = [];
  const sectionEvents = [];

  // 拦截 callMinimaxStreamText：第一阶段（main）跑 20s，第二阶段（beautify）瞬间返回
  // 但 generatePlanDoc 的 beautify 仅在 markdown 非空且未 degraded 时触发——我们让流式只跑 20s
  // 模拟 stream 没出 \n## 段标题，只攒到几百字
  // 复制注入逻辑：这次让 stream 跑 20s 短 chunk
  require.cache[llmClientsAbs].exports.callMinimaxStreamText =
    async (messages, opts, onChunk) => {
      const totalMs = 20_000;
      const stepMs = 200;
      const stepText = '一二三四五';
      const start = Date.now();
      while (Date.now() - start < totalMs) {
        if (opts.signal?.aborted) return;
        await new Promise(r => setTimeout(r, stepMs));
        onChunk(stepText);
      }
    };

  const startedAt = Date.now();
  // 设个超时兜底，万一卡了不会跑很久
  const result = await Promise.race([
    generatePlanDoc(
      {
        userInput: { brand: 'Test', topic: '测试', audience: '内部', goal: '冒烟' },
        round: 1,
        onStatus: (s) => {
          if (s.status === 'streaming_heartbeat') heartbeatEvents.push(s);
        },
        onSection: (md) => sectionEvents.push(md.length)
      },
      { minimaxApiKey: 'fake-key' }
    ),
    new Promise((_, reject) => setTimeout(() => reject(new Error('case 1 超 60s 未结束')), 60_000))
  ]).catch(err => ({ _err: err }));

  const dt = Date.now() - startedAt;

  // 期望：20s 流式 + ~10-90s beautify。我们只关心 main 阶段是否触发了 heartbeat
  const mainHeartbeats = heartbeatEvents.filter(e => e.phase === 'main');
  console.log(`  ⏱  耗时 ${dt}ms，main heartbeats: ${mainHeartbeats.length}, sections: ${sectionEvents.length}`);

  // main 阶段 20s，每 8s 一个心跳 → 至少 2 次（8s, 16s）
  assert.ok(mainHeartbeats.length >= 2, `main heartbeat 应至少 2 次（20s/8s 间隔），实际 ${mainHeartbeats.length}`);
  console.log(`  ✅ main 阶段触发了 ${mainHeartbeats.length} 次 streaming_heartbeat`);

  // 确认 sections 也来了（虽然次数比心跳少）
  assert.ok(sectionEvents.length >= 1, `应至少触发 1 次 onSection`);
  console.log(`  ✅ onSection 也正常触发 ${sectionEvents.length} 次`);

  // 心跳间隔验证
  if (mainHeartbeats.length >= 2) {
    const gap = mainHeartbeats[1].chars - mainHeartbeats[0].chars;
    console.log(`  ✅ 第 1 → 第 2 次心跳间累积字数：${gap}（持续在涨说明流没卡）`);
  }
}

(async () => {
  try {
    await testHeartbeatDuringMain();
    console.log('\n✅ HEARTBEAT SMOKE PASSED');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ SMOKE FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
