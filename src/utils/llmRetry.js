// LLM 调用错误分类 + 带退避的重试器。
// 目标：把"网络抖一下就 fail"这种 transport 层瞬时错误吃掉，
// 让上层 agent 主循环只看到真正的"用尽重试还失败"。

const { AbortError } = require('./abortx');

// 401/403/quota 这种重试无意义，立刻失败
const FATAL_PATTERNS = [
  /\b401\b|unauthorized/i,
  /\b403\b|forbidden/i,
  /quota.*exceeded|rate.?limit.*exceeded/i,
  /invalid.*api.?key/i
];
// context 太长：不能盲目重试（重试还是太长），但 caller 可以先压缩历史再试
const CONTEXT_LENGTH_PATTERNS = [
  /context.{0,10}length|maximum.{0,10}context/i,
  /too many tokens|max.?(length|tokens)|prompt (?:is )?too long/i,
  /reduce the length|exceeded.*token/i
];
// 网络抖动 / 5xx / 超时 —— 值得重试
const TRANSPORT_PATTERNS = [
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i,
  /fetch failed|network error|connection (?:reset|refused|closed|timeout)/i,
  /\b50\d\b|server error|bad gateway|service unavailable|gateway timeout/i,
  /socket hang up/i,
  /stream (?:closed|ended) (?:abruptly|unexpectedly)/i
];

/**
 * 把 LLM 调用的 err 分类，决定是否值得重试。
 * 返回值：
 *  - 'user_abort'        : 用户主动 stop，不重试，直接抛
 *  - 'fatal'             : 401/403/quota，不重试
 *  - 'retryable_compress': context 长度爆了，retry helper 不重试，brainAgent 自己压缩历史后重试
 *  - 'retryable_protocol': 400 invalid function args 之类，brainAgent 已有专门修复路径，retry helper 不管
 *  - 'retryable_transport': 网络/5xx/idle timeout —— 走退避重试
 *  - 'unknown'           : 没识别的，保守不重试（避免无限循环）
 */
function classifyLlmError(err) {
  if (!err) return 'unknown';

  // 用户 stop 触发的 abort：reason === 'user_stop'
  const reasonStr = String(err?.reason ?? '');
  if (err?.code === 'ABORT' || err?.name === 'AbortError') {
    if (/user_stop/i.test(reasonStr)) return 'user_abort';
    // idle / total budget 的 abort 也走 AbortError 路径，看 reason 是不是 TimeoutError
    if (err?.reason?.code === 'TIMEOUT' || /timeout|idle|budget/i.test(reasonStr)) return 'retryable_transport';
    // 不带具体 reason 的 abort：保守按 transport 处理
    return 'retryable_transport';
  }

  const msg = String(err?.message || err || '');

  if (err?.code === 'TIMEOUT' || /\btimeout\b|llm_stream_idle|llm_total_budget/i.test(msg)) {
    return 'retryable_transport';
  }
  // context 长度先于 fatal 判定（避免 "401" 误命中长字符串里的 "401" 等）
  if (CONTEXT_LENGTH_PATTERNS.some(p => p.test(msg))) return 'retryable_compress';
  if (FATAL_PATTERNS.some(p => p.test(msg))) return 'fatal';
  if (/400.*invalid.*function|invalid.*arguments.*json|\b2013\b/i.test(msg)) return 'retryable_protocol';
  if (TRANSPORT_PATTERNS.some(p => p.test(msg))) return 'retryable_transport';
  return 'unknown';
}

const DEFAULT_BACKOFFS_MS = [500, 2_000, 5_000]; // 3 次重试，总等待 ≤ 7.5s

/**
 * 带退避的 LLM 调用包装。
 *  - fn: () => Promise<T>，每次 attempt 都是一次完整的 LLM 调用（含创建 AbortController / watchdog 等）
 *  - signal: 外部 AbortSignal（如用户 stop）。abort 立刻抛 AbortError，不重试
 *  - onAttempt: ({ attempt, total }) => void
 *  - onRetry:   ({ attempt, error, waitMs }) => void   每次重试前调用，便于推 SSE
 *
 * 抛出策略：
 *  - 'user_abort' / 'fatal' / 'retryable_protocol' / 'unknown' → 立刻抛（让 caller 走对应分支）
 *  - 'retryable_transport' → 退避重试，用尽仍失败则抛最后一次错误
 */
async function retryLlmCall(fn, {
  backoffs = DEFAULT_BACKOFFS_MS,
  signal,
  onAttempt,
  onRetry
} = {}) {
  const total = backoffs.length + 1;
  let lastErr;
  for (let attempt = 0; attempt < total; attempt++) {
    if (signal?.aborted) throw new AbortError(signal.reason || 'aborted');
    try {
      onAttempt?.({ attempt, total });
      return await fn();
    } catch (err) {
      lastErr = err;
      const cls = classifyLlmError(err);
      // 不可重试的（在这一层）：直接抛给 caller，caller 自己决定怎么处理
      // - retryable_protocol: brainAgent 清坏 tool_calls 后重试
      // - retryable_compress: brainAgent 压缩历史后重试
      // - fatal/unknown: 走 L2 软失败兜底
      if (cls !== 'retryable_transport') {
        throw err;
      }
      // 用尽重试次数：抛
      if (attempt === total - 1) throw err;
      // 还有重试机会：退避
      const waitMs = backoffs[attempt];
      console.warn(`[llmRetry] attempt ${attempt + 1}/${total} 失败（${cls}: ${err.message}），${waitMs}ms 后重试`);
      onRetry?.({ attempt, error: err, waitMs });
      // 注意：这里的 setTimeout 不能 unref()——retry 在等待中是 event loop 唯一的 ref，
      // unref 会让进程提前退出、pending promise 永远不 resolve（unit test 卡死）。
      // 生产环境里 HTTP 请求 / SSE 连接等 handle 会 keep alive 进程，这里不 unref 也不影响。
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, waitMs);
        if (signal) {
          const onAbort = () => { clearTimeout(t); reject(new AbortError(signal.reason || 'aborted')); };
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
  }
  throw lastErr;
}

/**
 * 根据 errorClass + err.message 给用户一段具体的"接下来怎么办"建议。
 * 对每种典型故障路径都给出能照做的下一步——避免"调用失败"这种用户看了也不知道该怎么办的死信息。
 *
 * 同时被 brainAgent hard fail 和 routes/agent.js 端点错误使用，保证全链路错误信息一致。
 */
function buildNextActionHint(errorClass, err) {
  const msg = String(err?.message || '').toLowerCase();

  if (errorClass === 'fatal') {
    if (/\b401\b|unauthorized|invalid.*api.?key/.test(msg)) {
      return '上游服务返回 401（API Key 无效）。请打开右上角设置面板检查 MiniMax / DeepSeek 的 Key 是否填对、是否过期。';
    }
    if (/\b403\b|forbidden/.test(msg)) {
      return '上游服务返回 403（权限不足）。请检查这个 API Key 是否被授权使用当前模型，或换一个有权限的 Key。';
    }
    if (/quota|rate.?limit/.test(msg)) {
      return '配额或限速已用尽。请稍等几分钟让限速恢复，或换一个还有额度的账号 / 升级套餐。';
    }
    return '检测到不可恢复错误。请检查 API Key 配置、模型权限和上游服务状态后重试。';
  }
  if (errorClass === 'retryable_compress') {
    return '对话历史已经触发上游 token 上限。系统已尝试自动压缩历史，但仍未成功——建议开新对话重新开始，或把现有方案保存到工作空间后再继续。';
  }
  if (errorClass === 'retryable_protocol') {
    return '工具调用格式被上游拒绝。系统已尝试清理坏的工具历史。建议直接重试上一条消息；如仍失败，新开一段对话避免坏历史扰动。';
  }
  if (errorClass === 'retryable_transport') {
    return '上游网络/服务端临时故障（已重试 3 次都失败）。直接点"重试上一轮"通常能成功；若多次失败，请稍等几分钟。';
  }
  if (errorClass === 'user_abort') {
    return '任务已停止。可以直接重新发送上一条消息，或者换一个具体一点的需求继续。';
  }
  // unknown / 其他
  return '出现未识别的错误。可以直接重试上一轮；如果反复出现，请把这一段对话和报错信息反馈给开发者排查。';
}

module.exports = { classifyLlmError, retryLlmCall, buildNextActionHint, DEFAULT_BACKOFFS_MS };
