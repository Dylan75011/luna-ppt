// 验证后端 brain 自治持久化：agent_state_json 列 + immediate flush + DB 回退恢复
// 用法：node scripts/smoke-session-persistence.js
//
// 不启 HTTP server，直接调模块。每个 case 独立用一个 conversationId 隔离。

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// 让数据写到 ./data/platform.sqlite（已存在的库），新增的 agent_state_json 列会被
// idempotent migration 加上；测试用独立 conversationId 不污染线上数据。
process.chdir(path.resolve(__dirname, '..'));

const conversationStore = require('../src/services/conversationStore');
const agentSession = require('../src/services/agentSession');

function freshConversation(workspaceId = 'space_smoke_persist') {
  const conv = conversationStore.createConversation(workspaceId, 'smoke 持久化测试');
  return conv.id;
}

function cleanup(conversationId) {
  try { conversationStore.deleteConversation(conversationId); } catch {}
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function caseImmediateFlushOnClarification() {
  console.log('\n[case 1] pushEvent("clarification") 触发 immediate flush');
  const convId = freshConversation();
  try {
    const session = agentSession.createSession({
      apiKeys: {},
      spaceId: 'space_smoke_persist',
      conversationId: convId
    });
    session.pendingToolCallId = 'tc_smoke_1';
    session.brief = { topic: '冒烟测试主题' };
    session.taskIntent = { mode: 'research_only' };

    agentSession.pushEvent(session.sessionId, 'clarification', {
      header: '请确认',
      question: '主题对吗？'
    });

    // immediate flush 是同步的 patchAgentState
    const dbState = conversationStore.getAgentState(convId);
    assert.strictEqual(dbState.pendingToolCallId, 'tc_smoke_1', 'pendingToolCallId 未落盘');
    assert.deepStrictEqual(dbState.brief, { topic: '冒烟测试主题' }, 'brief 未落盘');
    assert.deepStrictEqual(dbState.taskIntent, { mode: 'research_only' }, 'taskIntent 未落盘');
    console.log('  ✅ pendingToolCallId / brief / taskIntent 都已落盘');

    agentSession.deleteSession(session.sessionId);
  } finally {
    cleanup(convId);
  }
}

async function caseDebouncedFlushOnUpdateSession() {
  console.log('\n[case 2] updateSession 触发 debounced flush（500ms）');
  const convId = freshConversation();
  try {
    const session = agentSession.createSession({
      apiKeys: {},
      spaceId: 'space_smoke_persist',
      conversationId: convId
    });

    agentSession.updateSession(session.sessionId, {
      bestPlan: { name: 'plan-A', sections: [] },
      bestScore: 87
    });

    // debounced 500ms：刚 update 完不应有
    let dbState = conversationStore.getAgentState(convId);
    assert.ok(!dbState.bestPlan, 'debounce 期间不应已落盘');

    // 等 600ms 让 debounce timer 触发
    await wait(600);
    dbState = conversationStore.getAgentState(convId);
    assert.deepStrictEqual(dbState.bestPlan, { name: 'plan-A', sections: [] }, 'debounce 后 bestPlan 应已落盘');
    assert.strictEqual(dbState.bestScore, 87, 'bestScore 应已落盘');
    console.log('  ✅ debounce 后 bestPlan / bestScore 落盘');

    agentSession.deleteSession(session.sessionId);
  } finally {
    cleanup(convId);
  }
}

async function caseDeleteSessionFlushesPending() {
  console.log('\n[case 3] deleteSession 在退出前最后一次 flush');
  const convId = freshConversation();
  try {
    const session = agentSession.createSession({
      apiKeys: {},
      spaceId: 'space_smoke_persist',
      conversationId: convId
    });

    // 用 updateSession 安排一次 debounced flush，然后立刻 delete
    agentSession.updateSession(session.sessionId, {
      brief: { topic: '快速 brief' },
      pendingToolCallId: 'tc_pending_delete'
    });

    // 不等 debounce，直接 delete
    agentSession.deleteSession(session.sessionId);

    const dbState = conversationStore.getAgentState(convId);
    assert.deepStrictEqual(dbState.brief, { topic: '快速 brief' }, 'delete 时应 flush brief');
    assert.strictEqual(dbState.pendingToolCallId, 'tc_pending_delete', 'delete 时应 flush pendingToolCallId');
    console.log('  ✅ delete 前最后 flush，未丢数据');
  } finally {
    cleanup(convId);
  }
}

async function caseFlushAgentStateImmediate() {
  console.log('\n[case 4] flushAgentState({ immediate: true }) 同步落盘');
  const convId = freshConversation();
  try {
    const session = agentSession.createSession({
      apiKeys: {},
      spaceId: 'space_smoke_persist',
      conversationId: convId
    });

    session.bestPlan = { name: 'immediate-plan' };
    agentSession.flushAgentState(session.sessionId, { immediate: true });

    const dbState = conversationStore.getAgentState(convId);
    assert.deepStrictEqual(dbState.bestPlan, { name: 'immediate-plan' }, 'immediate flush 应同步生效');
    console.log('  ✅ immediate flush 同步生效');

    agentSession.deleteSession(session.sessionId);
  } finally {
    cleanup(convId);
  }
}

async function caseNoFlushWithoutConversationId() {
  console.log('\n[case 5] 无 conversationId 的 session 不触发任何 DB 写');
  const session = agentSession.createSession({
    apiKeys: {},
    spaceId: 'space_smoke_persist'
    // 没传 conversationId
  });
  // 应当无副作用、不抛
  agentSession.updateSession(session.sessionId, { brief: { topic: 'orphan' } });
  agentSession.flushAgentState(session.sessionId, { immediate: true });
  agentSession.pushEvent(session.sessionId, 'clarification', { question: 'x' });
  agentSession.deleteSession(session.sessionId);
  console.log('  ✅ 无 conversationId 路径完全无 DB 副作用');
}

async function caseResumeMessagesCapturedOnlyWhenWaiting() {
  console.log('\n[case 7] resumeMessages 仅在 status=waiting_for_user 时落盘');
  const convId = freshConversation();
  try {
    const session = agentSession.createSession({
      apiKeys: {},
      spaceId: 'space_smoke_persist',
      conversationId: convId
    });

    // running 状态：resumeMessages 不应入库
    session.status = 'running';
    session.messages = [
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '回答' }
    ];
    agentSession.flushAgentState(session.sessionId, { immediate: true });
    let dbState = conversationStore.getAgentState(convId);
    assert.strictEqual(dbState.resumeMessages, null, 'running 时 resumeMessages 应为 null');

    // 进入 waiting_for_user：messages + pendingToolCallId 落盘
    session.status = 'waiting_for_user';
    session.pendingToolCallId = 'tc_resume_test';
    session.messages = [
      { role: 'user', content: '问题' },
      { role: 'assistant', content: null, tool_calls: [{
        id: 'tc_resume_test', type: 'function',
        function: { name: 'ask_user', arguments: '{"question":"x"}' }
      }] }
    ];
    agentSession.flushAgentState(session.sessionId, { immediate: true });
    dbState = conversationStore.getAgentState(convId);
    assert.ok(Array.isArray(dbState.resumeMessages), 'waiting_for_user 时 resumeMessages 应是数组');
    assert.strictEqual(dbState.resumeMessages.length, 2);
    assert.strictEqual(dbState.resumeMessages[1].tool_calls?.[0]?.id, 'tc_resume_test', 'tool_calls 结构应保留');
    console.log('  ✅ waiting_for_user 时捕获 LLM 格式 messages（含 tool_calls）');

    // 回到 running：resumeMessages 应被显式清掉
    session.status = 'running';
    session.pendingToolCallId = null;
    agentSession.flushAgentState(session.sessionId, { immediate: true });
    dbState = conversationStore.getAgentState(convId);
    assert.strictEqual(dbState.resumeMessages, null, 'resume 完成后 resumeMessages 应清掉');
    console.log('  ✅ 状态离开 waiting 后，resumeMessages 自动清掉');

    agentSession.deleteSession(session.sessionId);
  } finally {
    cleanup(convId);
  }
}

async function caseSimulatedReplyResurrect() {
  console.log('\n[case 8] 模拟 /reply resurrect：从 DB 重建 waiting session');
  const convId = freshConversation();
  try {
    // 阶段 1：原 session 建立 waiting 状态
    const original = agentSession.createSession({
      apiKeys: {},
      spaceId: 'space_smoke_persist',
      conversationId: convId
    });
    const origSessionId = original.sessionId;
    original.status = 'waiting_for_user';
    original.pendingToolCallId = 'tc_orig';
    original.messages = [
      { role: 'user', content: '原始问题' },
      { role: 'assistant', content: null, tool_calls: [{
        id: 'tc_orig', type: 'function',
        function: { name: 'ask_user', arguments: '{}' }
      }] }
    ];
    original.brief = { topic: '原始 brief' };
    agentSession.flushAgentState(origSessionId, { immediate: true });

    // 阶段 2：模拟"进程重启"——把 session 从内存里删掉
    agentSession.deleteSession(origSessionId);
    assert.strictEqual(agentSession.getSession(origSessionId), null, '内存里应已无原 session');

    // 阶段 3：从 DB 拿到 agent_state_json，重建 session（模拟 /reply resurrect）
    const dbState = conversationStore.getAgentState(convId);
    assert.strictEqual(dbState.status, 'waiting_for_user');
    assert.strictEqual(dbState.pendingToolCallId, 'tc_orig');
    assert.ok(Array.isArray(dbState.resumeMessages), 'DB 应能取出 resumeMessages');

    const resurrected = agentSession.createSession({
      sessionId: origSessionId,
      apiKeys: {},
      spaceId: dbState.spaceId,
      conversationId: convId
    });
    resurrected.messages = dbState.resumeMessages;
    resurrected.pendingToolCallId = dbState.pendingToolCallId;
    resurrected.status = 'waiting_for_user';
    resurrected.brief = dbState.brief;

    // 验证：resurrected 完全覆盖原 session
    assert.strictEqual(resurrected.sessionId, origSessionId, 'sessionId 应保持一致');
    assert.strictEqual(resurrected.messages.length, 2);
    assert.strictEqual(resurrected.messages[1].tool_calls?.[0]?.id, 'tc_orig', 'tool_calls 链路完整');
    assert.deepStrictEqual(resurrected.brief, { topic: '原始 brief' });
    console.log('  ✅ 复活后 sessionId / messages / pendingToolCallId / brief 全部齐全');

    agentSession.deleteSession(origSessionId);
  } finally {
    cleanup(convId);
  }
}

async function caseAgentEventReplay() {
  console.log('\n[case 9] agent_events 写入 + 内存 backlog 空时回退到 DB 回放');
  const convId = freshConversation();
  try {
    const session = agentSession.createSession({
      apiKeys: {},
      spaceId: 'space_smoke_persist',
      conversationId: convId
    });

    // 推一轮 important 事件（task_intent / tool_call / tool_result）+ 一个 trivial（text_delta）
    agentSession.pushEvent(session.sessionId, 'task_intent', { taskIntent: { mode: 'X' } });
    agentSession.pushEvent(session.sessionId, 'tool_call', { tool: 't1', toolCallId: 'tc_a' });
    agentSession.pushEvent(session.sessionId, 'text_delta', { delta: 'hi' }); // trivial 不入 DB
    agentSession.pushEvent(session.sessionId, 'tool_result', { tool: 't1', success: true });

    // DB 应只有 3 条 important
    const events = conversationStore.getAgentEvents(convId);
    assert.strictEqual(events.length, 3, `应有 3 条 important，实际 ${events.length}`);
    assert.strictEqual(events[0].eventType, 'task_intent');
    assert.strictEqual(events[1].eventType, 'tool_call');
    assert.strictEqual(events[2].eventType, 'tool_result');
    console.log('  ✅ important 事件入库，trivial 事件不入库');

    // 模拟"重启"：清掉内存 backlog，构造新 session 复活
    agentSession.deleteSession(session.sessionId);

    const resurrected = agentSession.createSession({
      sessionId: session.sessionId,
      apiKeys: {},
      spaceId: 'space_smoke_persist',
      conversationId: convId
    });
    assert.strictEqual(resurrected.eventBacklog.length, 0, '复活后内存 backlog 应为空');

    // 模拟 SSE client 连接：用一个最小 mock res
    const written = [];
    const fakeRes = { write(chunk) { written.push(chunk); }, end() {} };
    agentSession.addSseClient(resurrected.sessionId, fakeRes);

    assert.strictEqual(written.length, 3, `回放应写 3 条，实际 ${written.length}`);
    assert.ok(written[0].includes('event: task_intent'), 'first 应为 task_intent');
    assert.ok(written[2].includes('event: tool_result'), 'last 应为 tool_result');
    console.log('  ✅ 内存 backlog 空时从 agent_events 表回放');

    agentSession.deleteSession(resurrected.sessionId);
  } finally {
    cleanup(convId);
  }
}

async function caseWriteStatsExposed() {
  console.log('\n[case 10] writeStats 暴露并随每次写累加');
  const convId = freshConversation();
  try {
    const before = conversationStore.getWriteStats();
    const beforeWrites = before.totalWrites;

    conversationStore.patchAgentState(convId, { brief: { topic: '观测' } });
    conversationStore.appendMessage(convId, {
      id: 'msg_observability',
      role: 'user',
      text: '观测一下'
    });

    const after = conversationStore.getWriteStats();
    assert.ok(after.totalWrites >= beforeWrites + 2, `totalWrites 应 ≥ ${beforeWrites + 2}`);
    assert.strictEqual(typeof after.totalRetries, 'number');
    assert.strictEqual(typeof after.totalFailed, 'number');
    console.log(`  ✅ writeStats 累加：writes=${after.totalWrites - beforeWrites}, retries=${after.totalRetries}, failed=${after.totalFailed}`);
  } finally {
    cleanup(convId);
  }
}

async function casePatchAgentStateMerge() {
  console.log('\n[case 6] patchAgentState 是 merge 而非覆盖');
  const convId = freshConversation();
  try {
    conversationStore.patchAgentState(convId, { brief: { topic: 'A' }, bestScore: 50 });
    conversationStore.patchAgentState(convId, { taskIntent: { mode: 'X' } });

    const dbState = conversationStore.getAgentState(convId);
    assert.deepStrictEqual(dbState.brief, { topic: 'A' }, '后续 patch 不应抹掉之前的 brief');
    assert.strictEqual(dbState.bestScore, 50, '后续 patch 不应抹掉之前的 bestScore');
    assert.deepStrictEqual(dbState.taskIntent, { mode: 'X' }, '新字段应合并');
    console.log('  ✅ patchAgentState 是合并语义');
  } finally {
    cleanup(convId);
  }
}

(async () => {
  try {
    await caseImmediateFlushOnClarification();
    await caseDebouncedFlushOnUpdateSession();
    await caseDeleteSessionFlushesPending();
    await caseFlushAgentStateImmediate();
    await caseNoFlushWithoutConversationId();
    await casePatchAgentStateMerge();
    await caseResumeMessagesCapturedOnlyWhenWaiting();
    await caseSimulatedReplyResurrect();
    await caseAgentEventReplay();
    await caseWriteStatsExposed();
    console.log('\n✅ ALL SESSION PERSISTENCE SMOKE PASSED');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ SMOKE FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
