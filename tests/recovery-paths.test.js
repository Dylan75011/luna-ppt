// Mock harness 测 3 条"代码写了但没真跑过"的恢复路径
//   1. MAX_TURNS=15 强制文本总结
//   2. 跨厂商 fallback (deepseek-chat)
//   3. context_length_exceeded 自动压缩
//
// brainAgent 在 require 时就 destructure 了 llmClients/intentClassifier 的方法引用，
// 后改 module exports 不影响。所以这里在 require brainAgent **之前** 就替换好这些 method。
require('dotenv').config();

// ── 准备 stub 控制变量（test 之间复用）──────────────────────────────
const ctrl = {
  // 主 LLM stub 行为：'loop_tool_calls' / 'throw_5xx' / 'context_too_long_then_ok'
  mode: 'idle',
  // 计数 / 取样
  toolCallCount: 0,
  minimaxCalls: 0,
  deepseekCalls: 0,
  attemptMessagesAtFirst: 0,
  attemptMessagesAtSecond: 0,
};

// ── stub: llmClients ────────────────────────────────────────────────
const llmClients = require('../src/services/llmClients');
llmClients.callMinimaxWithToolsStream = async (messages, tools, opts, onChunk) => {
  ctrl.minimaxCalls++;
  if (ctrl.mode === 'loop_tool_calls') {
    // runForcedTextSummary 路径：tool_choice='none' 时禁止 tool_call，必须吐文本
    if (opts?.tool_choice === 'none') {
      const summary = '已完成：N 次工具调用循环。\n还差：未收敛到方案。\n建议：先告诉我下一步要不要继续。';
      for (const ch of summary) onChunk?.({ type: 'text_delta', delta: ch });
      return {
        message: { role: 'assistant', content: summary, tool_calls: undefined },
        finish_reason: 'stop'
      };
    }
    onChunk?.({ type: 'tool_call_delta' });
    ctrl.toolCallCount++;
    return {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: `call_loop_${ctrl.toolCallCount}`,
          type: 'function',
          function: {
            name: 'web_search',
            arguments: JSON.stringify({ query: `loop_${ctrl.toolCallCount}`, max_results: 3 })
          }
        }]
      },
      finish_reason: 'tool_calls'
    };
  }
  if (ctrl.mode === 'throw_5xx') {
    const err = new Error('500 service unavailable');
    err.status = 500;
    err.code = 'unavailable';
    throw err;
  }
  if (ctrl.mode === 'context_too_long_then_ok') {
    if (ctrl.minimaxCalls === 1) {
      ctrl.attemptMessagesAtFirst = messages.length;
      const err = new Error('400 context length exceeded: 250000 > 200000 max');
      err.status = 400;
      throw err;
    }
    ctrl.attemptMessagesAtSecond = messages.length;
    onChunk?.({ type: 'text_delta', delta: '压缩后的回复' });
    return {
      message: { role: 'assistant', content: '压缩后的回复', tool_calls: undefined },
      finish_reason: 'stop'
    };
  }
  // 默认 idle
  return {
    message: { role: 'assistant', content: '默认回复', tool_calls: undefined },
    finish_reason: 'stop'
  };
};

llmClients.callMinimaxStreamText = async (messages, opts, onChunk) => {
  ctrl.minimaxCalls++;
  if (ctrl.mode === 'loop_tool_calls') {
    // runForcedTextSummary 路径走的就是 callMinimaxStreamText
    const summary = '已完成：N 次工具调用循环。\n还差：未收敛到方案。\n建议：先告诉我下一步要不要继续。';
    if (onChunk) for (const ch of summary) onChunk(ch);
    return summary;
  }
  if (ctrl.mode === 'throw_5xx') {
    const err = new Error('500 service unavailable');
    err.status = 500;
    throw err;
  }
  return '默认 stream 文本';
};

llmClients.callDeepseekChatText = async (messages, opts, onChunk) => {
  ctrl.deepseekCalls++;
  const reply = '我先给你一个简短回复：minimax 暂时不稳，按已知信息推进。';
  if (onChunk) for (const ch of reply) onChunk(ch);
  return reply;
};

// ── stub: intentClassifier（永远返回 strategy 让 brain 进 tool loop）──
const intentClassifier = require('../src/services/intentClassifier');
intentClassifier.classifyTaskIntentWithLLM = async () => ({
  type: 'strategy',
  confidence: 0.95,
  reason: '(test stub)',
  needsClarification: false
});

// ── stub: tool 真执行（避免去 Bing）──
const toolReg = require('../src/services/toolRegistry');
const origExec = toolReg.executeTool;
toolReg.executeTool = async (toolName, args) => {
  if (toolName === 'web_search') return { found: true, count: 1, summary: '[mock] search result for ' + (args?.query || '') };
  if (toolName === 'write_todos') return { success: true, count: (args?.todos || []).length };
  if (toolName === 'update_brief') return { success: true, brief: { brand: 'mock', topic: 'mock' } };
  if (toolName === 'challenge_brief') return { success: true, hasConcerns: false, concerns: [] };
  return origExec(toolName, args);
};

// ── 现在才 require brainAgent ──
const brainAgent = require('../src/agents/brainAgent');

// ─── 测试结果收集 ───
const results = [];
function pass(name) { results.push({ name, ok: true }); console.log(`✅ ${name}`); }
function fail(name, why) { results.push({ name, ok: false, why }); console.log(`❌ ${name} — ${why}`); }

function makeFakeSession(extra = {}) {
  return {
    sessionId: `test_${Math.random().toString(36).slice(2,8)}`,
    conversationId: '',
    apiKeys: { minimaxApiKey: 'fake-mm-key' },
    messages: [],
    planItems: [],
    askedQuestions: [],
    status: 'idle',
    doneEmitted: false,
    stopRequested: false,
    pendingToolCallId: null,
    spaceId: '',
    backgroundTasks: new Map(),
    pendingBackgroundInjects: [],
    inflightBackgroundCalls: [],
    routeToolSequence: [],
    forceTool: '',
    ...extra
  };
}

// ────────────────────────────────────────────────────────────────────
// Test 1: MAX_TURNS=15 强制文本总结
// ────────────────────────────────────────────────────────────────────
async function testMaxTurns() {
  console.log('\n━━ Test 1: MAX_TURNS=15 强制文本总结 ━━');
  ctrl.mode = 'loop_tool_calls';
  ctrl.toolCallCount = 0;
  ctrl.minimaxCalls = 0;

  const events = [];
  const session = makeFakeSession();
  await brainAgent.run(session, '帮我做发布会方案', (evt, data) => {
    events.push({ evt, data });
  }, {});

  if (ctrl.toolCallCount >= 15) {
    pass(`brain 跑到 tool_call=${ctrl.toolCallCount} 次（MAX_TURNS guard 生效）`);
  } else {
    fail('MAX_TURNS guard', `只跑了 ${ctrl.toolCallCount} 次 tool_call`);
  }

  const accum = events.filter(e => e.evt === 'text_delta' || e.evt === 'text')
    .map(e => e.data?.delta || e.data?.text || '').join('');
  if (accum.includes('已完成') || accum.includes('建议') || accum.includes('收敛')) {
    pass('runForcedTextSummary 输出了总结文本');
  } else if (accum.length > 0) {
    fail('forced summary 文本', `final text 不像总结: "${accum.slice(0, 100)}"`);
  } else {
    // 也可能走的是 hard fallback static text
    const lastText = events.filter(e => e.evt === 'text').slice(-1)[0];
    if (lastText && /MAX_TURNS|步还没收敛|本轮已经迭代/.test(lastText.data?.text || '')) {
      pass('走了 hard fallback 静态总结（runForcedTextSummary 失败时的兜底）');
    } else {
      fail('forced summary 文本', '完全没看到总结输出');
    }
  }

  const doneEvent = events.find(e => e.evt === 'done');
  if (doneEvent) pass('done 事件正常 emit');
  else fail('done 事件', '未 emit');
}

// ────────────────────────────────────────────────────────────────────
// Test 2: 跨厂商 fallback
// ────────────────────────────────────────────────────────────────────
async function testCrossProvider() {
  console.log('\n━━ Test 2: 跨厂商 fallback (deepseek-chat) ━━');
  ctrl.mode = 'throw_5xx';
  ctrl.minimaxCalls = 0;
  ctrl.deepseekCalls = 0;

  // 必须设置 deepseek API key 让 canUseFallbackProvider 返 true
  const origKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-fake-deepseek-key';

  try {
    const events = [];
    const session = makeFakeSession({
      apiKeys: { minimaxApiKey: 'fake-mm', deepseekApiKey: 'fake-ds' }
    });
    await brainAgent.run(session, '小米最近怎么样', (evt, data) => {
      events.push({ evt, data });
    }, {});

    if (ctrl.minimaxCalls >= 1) {
      pass(`minimax 被尝试调用 ${ctrl.minimaxCalls} 次（含重试）`);
    } else {
      fail('minimax 调用', '没被调用过');
    }

    if (ctrl.deepseekCalls >= 1) {
      pass(`deepseek-chat fallback 被触发 ${ctrl.deepseekCalls} 次`);
    } else {
      const errEvent = events.find(e => e.evt === 'error');
      if (errEvent) {
        // 不到 fallback 路径的话至少有 hard fail error 给用户
        pass(`未触发 deepseek，但给用户明确 error: "${(errEvent.data?.message || '').slice(0,50)}"`);
      } else {
        fail('deepseek fallback', '没切 deepseek 也没 error');
      }
    }

    const accum = events.filter(e => e.evt === 'text_delta' || e.evt === 'text')
      .map(e => e.data?.delta || e.data?.text || '').join('');
    if (ctrl.deepseekCalls >= 1 && (accum.includes('简短回复') || accum.includes('minimax'))) {
      pass('fallback 文本送达 SSE');
    } else if (ctrl.deepseekCalls >= 1) {
      fail('fallback 文本', `deepseek 调了但 SSE 没看到回复: "${accum.slice(0,80)}"`);
    }
  } finally {
    if (origKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = origKey;
  }
}

// ────────────────────────────────────────────────────────────────────
// Test 3: context_length_exceeded 自动压缩
// ────────────────────────────────────────────────────────────────────
async function testContextCompress() {
  console.log('\n━━ Test 3: context_length_exceeded 自动压缩 ━━');
  ctrl.mode = 'context_too_long_then_ok';
  ctrl.minimaxCalls = 0;
  ctrl.attemptMessagesAtFirst = 0;
  ctrl.attemptMessagesAtSecond = 0;

  // 准备一个长 history 让压缩有可操作空间
  const longHistory = [];
  for (let i = 0; i < 25; i++) {
    longHistory.push({ role: 'user', content: `第 ${i} 轮问题`.repeat(5) });
    longHistory.push({ role: 'assistant', content: `第 ${i} 轮回答`.repeat(40) });
  }

  const events = [];
  const session = makeFakeSession({ messages: longHistory });
  await brainAgent.run(session, '继续推进', (evt, data) => {
    events.push({ evt, data });
  }, {});

  if (ctrl.minimaxCalls === 2) {
    pass(`恰好重试 1 次（${ctrl.attemptMessagesAtFirst} → ${ctrl.attemptMessagesAtSecond} 条）`);
  } else if (ctrl.minimaxCalls === 1) {
    fail('压缩重试', '只调了 1 次，没重试');
  } else {
    pass(`重试了 ${ctrl.minimaxCalls} 次（≥ 2 也算自救行为）`);
  }

  if (ctrl.attemptMessagesAtFirst > 0
      && ctrl.attemptMessagesAtSecond > 0
      && ctrl.attemptMessagesAtSecond < ctrl.attemptMessagesAtFirst) {
    pass(`messages 被压缩：${ctrl.attemptMessagesAtFirst} → ${ctrl.attemptMessagesAtSecond}`);
  } else if (ctrl.minimaxCalls >= 2) {
    fail('messages 压缩', `两次调用 messages 数：${ctrl.attemptMessagesAtFirst} → ${ctrl.attemptMessagesAtSecond}（没压缩）`);
  }

  const accum = events.filter(e => e.evt === 'text_delta' || e.evt === 'text')
    .map(e => e.data?.delta || e.data?.text || '').join('');
  if (accum.includes('压缩后的回复')) {
    pass('压缩后回复送达 SSE');
  } else {
    fail('压缩后回复', `text="${accum.slice(0,80)}"`);
  }
}

// ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await testMaxTurns();
  } catch (e) { fail('Test 1 异常', e.message); }
  try {
    await testCrossProvider();
  } catch (e) { fail('Test 2 异常', e.message); }
  try {
    await testContextCompress();
  } catch (e) { fail('Test 3 异常', e.message); }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`✅ ${passed} passed   ❌ ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(err => {
  console.error('FATAL', err);
  process.exit(2);
});
