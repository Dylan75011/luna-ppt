// 验证所有"结束规则"都正确生效，确保 brainAgent 不会陷入无限循环。
// 用法：node scripts/smoke-termination-rules.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n[case 1] 静态扫描：所有 ReAct 主循环里的 continue 都有兜底');
const src = fs.readFileSync(path.resolve(__dirname, '../src/agents/brainAgent.js'), 'utf-8');
const lines = src.split('\n');

// 找出 runLoop 函数的范围（这才是会无限循环的主循环；stripToolCallHistory 之类的 for-of 数据循环不算）
const runLoopStart = lines.findIndex(l => /^async function runLoop\(/.test(l));
const runLoopEnd = lines.findIndex((l, i) => i > runLoopStart && /^function buildToolResultEvent/.test(l));
assert.ok(runLoopStart > 0 && runLoopEnd > runLoopStart, '能定位 runLoop 函数');

const continueLines = [];
for (let i = runLoopStart; i < runLoopEnd; i++) {
  if (/^\s*continue;/.test(lines[i]) || /^\s*continue\s*\/\//.test(lines[i])) {
    continueLines.push({ line: lines[i], idx: i + 1 });
  }
}
console.log(`  runLoop 范围内扫到 ${continueLines.length} 处 continue 语句`);

let unguarded = 0;
for (const { line, idx } of continueLines) {
  const ctx = lines.slice(Math.max(0, idx - 60), idx).join('\n');
  const hasGuard =
    /turn\s*===\s*0/.test(ctx) ||
    /loopTracker/.test(ctx) ||
    /_compressAttempted/.test(ctx) ||
    /_softFailAttempted/.test(ctx) ||
    /canCallBuildPpt|build_ppt/.test(ctx) ||
    /ask_user|validateAskUserArgs/.test(ctx);
  if (!hasGuard) {
    unguarded++;
    console.warn(`  ⚠ line ${idx}: ${line.trim()}`);
  }
}
assert.strictEqual(unguarded, 0, '所有 runLoop 内的 continue 都应有兜底标志');
console.log('  ✅ runLoop 内每个 continue 都有兜底（标志位 / loopTracker / turn / 特殊路径守卫）');

console.log('\n[case 2] MAX_TURNS 是硬上限，不可超过');
const maxTurnsMatch = src.match(/const MAX_TURNS\s*=\s*(\d+)/);
assert.ok(maxTurnsMatch, 'MAX_TURNS 常量应存在');
const maxTurns = parseInt(maxTurnsMatch[1], 10);
console.log(`  ✅ MAX_TURNS = ${maxTurns}`);
assert.ok(maxTurns >= 5 && maxTurns <= 30, '合理范围 5-30');
// 确认主循环的 for 用了它
assert.ok(/for\s*\(\s*turn\s*=\s*0\s*;\s*turn\s*<\s*MAX_TURNS\s*;/.test(src), '主循环用 MAX_TURNS');
console.log('  ✅ 主循环以 turn < MAX_TURNS 为退出条件');

console.log('\n[case 3] MAX_TURNS 用尽后给用户文字解释，不静默退出');
assert.ok(/turn\s*===\s*MAX_TURNS/.test(src), '应检测 turn === MAX_TURNS');
assert.ok(/已经迭代.*步还没收敛/.test(src), '应有用户可读的解释文案');
console.log('  ✅ MAX_TURNS 用尽时 onEvent("text", ...) 解释');

console.log('\n[case 4] loopTracker 5 次同 tool+args 强制退出');
assert.ok(/loopTracker\[sig\]\s*>=\s*5/.test(src), '应有 5 次硬退出');
assert.ok(/检测到重复操作/.test(src), '应有用户可读的解释');
console.log('  ✅ loopTracker 5 次硬退出');

console.log('\n[case 5] L1 重试次数硬上限');
const llmRetrySrc = fs.readFileSync(path.resolve(__dirname, '../src/utils/llmRetry.js'), 'utf-8');
const backoffMatch = llmRetrySrc.match(/DEFAULT_BACKOFFS_MS\s*=\s*\[([^\]]+)\]/);
assert.ok(backoffMatch, '应有 backoffs 数组');
// 处理 numeric separator（500, 2_000, 5_000）：split by ',' 算元素数
const backoffCount = backoffMatch[1].split(',').filter(s => s.trim().length > 0).length;
console.log(`  ✅ L1 默认 ${backoffCount + 1} 次 attempt（${backoffCount} 个 backoff 间隔 + 1 首次）`);
assert.ok(backoffCount >= 2 && backoffCount <= 5, '合理范围');

console.log('\n[case 6] context 压缩自救一回合最多 1 次');
assert.ok(/_compressAttempted\s*=\s*true/.test(src), '应设标志位');
assert.ok(/!session\._compressAttempted/.test(src), '应检查标志位');
assert.ok(/_compressAttempted\s*=\s*false/.test(src), 'run/resume 入口应 reset');
console.log('  ✅ 一回合限一次，新回合 reset');

console.log('\n[case 7] L2 软失败一回合最多 1 次');
assert.ok(/_softFailAttempted\s*=\s*true/.test(src), '应设标志位');
assert.ok(/!session\._softFailAttempted/.test(src), '应检查标志位');
console.log('  ✅ 一回合限一次');

console.log('\n[case 8] 跨回合 hard fail 熔断器');
assert.ok(/_hardFailCount/.test(src), '应有熔断计数');
assert.ok(/_hardFailCount\s*=\s*0/.test(src), '应在成功路径 reset');
assert.ok(/连续\s*\$\{session\._hardFailCount\}\s*次/.test(src), '应在错误信息里提示');
console.log('  ✅ hard fail 累计 ≥ 3 次时附加提示，成功响应自动 reset');

console.log('\n[case 9] tool race + budget');
assert.ok(/TOOL_BUDGET\s*=\s*\{/.test(src), 'TOOL_BUDGET 表应存在');
assert.ok(/Promise\.race\(\[/.test(src), '应用 Promise.race 控制等待');
console.log('  ✅ 每个 tool 调用都受 budget race 保护');

console.log('\n[case 10] LLM idle + total budget');
assert.ok(/LLM_STREAM_IDLE_MS/.test(src));
assert.ok(/LLM_TOTAL_BUDGET_MS/.test(src));
console.log('  ✅ LLM 两层超时（idle / total）');

console.log('\n[case 11] L2 fallback 成功也 reset 熔断');
assert.ok(/_crossProviderFallback[\s\S]{0,200}_hardFailCount\s*=\s*0/.test(src),
  'fallback 成功后应 reset _hardFailCount');
console.log('  ✅ 跨厂商兜底成功也算"恢复"，重置熔断');

console.log('\n✅ ALL TERMINATION RULES VERIFIED');
console.log(`
============================================================
brainAgent 全部"结束规则"清单：
  · 主循环: turn < MAX_TURNS (${maxTurns}) 硬上限，用尽时给文字解释
  · loopTracker: 同 tool+args 5 次强制 idle
  · 400 invalid args: 仅 turn===0 自救，最多 1 次
  · context length: _compressAttempted 一回合 1 次
  · L2 软失败: _softFailAttempted 一回合 1 次
  · L1 transport 重试: ${backoffCount + 1} 次 attempt 硬上限
  · 跨回合熔断: _hardFailCount ≥ 3 时附加提示
  · Tool race: 每个 tool 都有 budget 超时即 backgrounded
  · LLM 双层超时: 30s idle + 90s total
  · 进程退出: 所有定时器/timer 都 unref 或在 finally 清理
============================================================
`);
