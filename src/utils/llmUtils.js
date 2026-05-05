// LLM 调用工具：重试、JSON 解析，供 Agent 和 Skill 共用
const fs = require('fs');
const path = require('path');
const { callMinimax, callDeepseekReasoner, callMinimaxStreamText } = require('../services/llmClients');
const { StructuredOutputValidationError } = require('./structuredOutput');

const RETRY_LIMIT = 2;
const RETRY_DELAY_MS = 2000;
const DEBUG_DIR = path.resolve(process.cwd(), 'data/llm-debug');

// 流式调用的超时兜底——以前的 streaming 分支没有任何超时，
// 一旦上游（如 MiniMax）挂死，整条 skill 链路（propose_concept / run_strategy 等）
// 会永久挂起，brainAgent 的 race 切了控制权但底层永不返回，结果是 background_done 永不触发。
const STREAM_IDLE_MS = 30_000;     // 30s 无 chunk → 视为卡死并 abort
const STREAM_TOTAL_MS = 120_000;   // 120s 总时长上限（连接 + 流式累计）
// 心跳间隔：每 N 秒触发一次 onStatus({ status: 'streaming_heartbeat', ... })，
// 让上层 tool 转成 tool_progress 推回 brainAgent，刷新 idle watchdog。
// 2s：之前是 8s，导致 propose_concept / run_strategy 流式期间用户看到的进度
// 间隔 8s 一次，体感像卡死。前端节流可在客户端做。
const STREAM_HEARTBEAT_MS = 2_000;
// 阻塞调用的等待心跳间隔（更短一点，因为阻塞调用没有 chunk，只能用墙钟节奏推）
const BLOCKING_WAIT_HEARTBEAT_MS = 5_000;

class LLMTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LLMTimeoutError';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label = 'llm', onTimeout = null) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (typeof onTimeout === 'function') {
        try { onTimeout(); } catch {}
      }
      reject(new LLMTimeoutError(`[${label}] 请求超时（>${timeoutMs}ms）`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function stripCodeFences(text = '') {
  const value = String(text || '').trim();
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : value;
}

function findBalancedJsonSlice(text = '') {
  const value = String(text || '');
  const start = value.search(/[\[{]/);
  if (start === -1) return '';

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < value.length; i++) {
    const char = value[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') depth += 1;
    if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return value.slice(start, i + 1).trim();
    }
  }

  return value.slice(start).trim();
}

function sanitizeJsonCandidate(text = '') {
  return String(text || '')
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/^[`]+|[`]+$/g, '')
    .replace(/,\s*([}\]])/g, '$1');
}

function mergeExtraOptions(baseExtra = {}, patchExtra = {}) {
  return { ...(baseExtra || {}), ...(patchExtra || {}) };
}

function summarizeError(error) {
  if (!error) return 'unknown error';
  if (error instanceof StructuredOutputValidationError) {
    return [error.message, ...(error.issues || [])].join('; ');
  }
  return error.message || String(error);
}

function notifyStatus(onStatus, status, payload = {}) {
  if (typeof onStatus !== 'function') return;
  try {
    onStatus({ status, ...payload });
  } catch {}
}

function writeDebugSnapshot(name, payload) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${stamp}-${String(name || 'llm').replace(/[^a-z0-9_-]/gi, '_')}.json`;
    fs.writeFileSync(path.join(DEBUG_DIR, filename), `${JSON.stringify(payload, null, 2)}\n`);
  } catch (error) {
    console.warn(`[${name}] 写入调试快照失败:`, error.message);
  }
}

/**
 * 在 messages 最前面（或合并进首条 system）注入 anti-think 指令，
 * 强制模型不要使用 <think>/<thought> 标签，token 全部留给 JSON。
 * MiniMax 推理模型默认会先 think 再输出，maxTokens 紧时思考会吃光预算，
 * 导致 JSON 截断 → 解析失败 → 重试一轮才加 anti-think → 用户每次至少多等 10-20s。
 */
function prependAntiThink(messages, repairHint = '') {
  const directive = '⚠️ 输出格式硬约束（必读）：\n'
    + '- 只输出**最终的合法 JSON 对象**，**禁止**使用 <think>、<thought>、思考链、铺垫话语\n'
    + '- 不要先 reasoning 再 JSON——直接以 `{` 开头\n'
    + '- 完整结构必须在一次输出里收完，不能截断'
    + (repairHint ? `\n- 字段要求：${repairHint}` : '');
  if (!Array.isArray(messages) || messages.length === 0) {
    return [{ role: 'system', content: directive }, ...(messages || [])];
  }
  const first = messages[0];
  if (first?.role === 'system' && typeof first.content === 'string') {
    // 合并到现有 system message 末尾，避免堆两条 system 信息
    return [
      { ...first, content: `${first.content}\n\n${directive}` },
      ...messages.slice(1)
    ];
  }
  // 没有 system message，前面插一条
  return [{ role: 'system', content: directive }, ...messages];
}

/**
 * 剥离推理模型可能泄漏的 <think> 标签
 * 覆盖三种形态：
 *   1) <think>X</think>正文           → 保留正文
 *   2) X</think>正文（开始 tag 缺失） → 流式截断常见，丢弃 </think> 之前
 *   3) <think>X（结束 tag 缺失）      → 截断/未完成，从 <think> 处直接截掉
 */
function stripThinkTags(text) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const closeIdx = s.search(/<\/think>/i);
  if (closeIdx >= 0) {
    s = s.slice(closeIdx).replace(/<\/think>/i, '');
  }
  const openIdx = s.search(/<think>/i);
  if (openIdx >= 0) {
    s = s.slice(0, openIdx);
  }
  return s.trim();
}

/**
 * 从文本中提取 JSON
 * 兼容：<think>...</think> 推理标签、markdown 代码块、裸 JSON
 */
function extractJson(text) {
  const cleaned = stripThinkTags(text);
  const candidates = [
    cleaned,
    stripCodeFences(cleaned),
    findBalancedJsonSlice(stripCodeFences(cleaned)),
    sanitizeJsonCandidate(stripCodeFences(cleaned)),
    sanitizeJsonCandidate(findBalancedJsonSlice(stripCodeFences(cleaned)))
  ].filter(Boolean);

  let lastError = null;
  for (const candidate of [...new Set(candidates)]) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('无法解析 JSON');
}

/**
 * 判断模型输出是否"全是 think 没有 JSON"——典型症状是输出主体是 <think>...</think>
 * 块，思考被 maxTokens 截断后根本没机会产出 JSON。检测到这种 case 应该走更激进的重试
 * 路径（加 anti-think 提醒，必要时上调 maxTokens）而不是平庸地走 repair。
 */
function isThinkOnlyOutput(text) {
  if (!text) return false;
  const raw = String(text || '').trim();
  if (!raw) return false;
  // 含 <think> 标签，且剥掉 think 后基本没剩内容（也可能因为思考爆了 token 没闭合）
  if (!/<think>/i.test(raw)) return false;
  const stripped = stripThinkTags(raw);
  // 剥完后剩不到 20 字符 / 没有任何 { 或 [ → 视为没产出 JSON
  return stripped.length < 20 || !/[{\[]/.test(stripped);
}

function validateStructuredResult(result, validate) {
  if (!validate) return result;
  return validate(result);
}

/**
 * 调用 LLM，带重试
 *
 * options.streaming = true（仅 minimax）：用流式 API 累积全文本返回，
 * 适合 maxTokens 较大（>3000）的场景，彻底规避整体超时问题。
 */
async function callLLM(messages, options = {}) {
  const { model = 'minimax', runtimeKey, minimaxModel, name = 'llm', timeoutMs, streaming, onStatus, ...rest } = options;

  // ── 流式累积模式（MiniMax 长文本）─────────────────────────────────────
  // 加 idle (30s) + total (120s) 两层超时——之前没有超时，一旦 MiniMax 挂死整条 skill 链
  // 永久挂起，brainAgent 的 race 已经切了控制权但底层永不返回，导致 background_done
  // 永不触发、用户体感"卡住"。超时后抛错让 callLLMJson 走它已有的 fallback 分支。
  //
  // 同时每 8s 通过 onStatus 推 streaming_heartbeat —— 让上层（tool / brainAgent）
  // 即使 LLM 在长段落里没产出 onSection 触发条件，也能感知"还活着"
  if (streaming && model === 'minimax') {
    let lastError;
    const streamRetryLimit = Number.isFinite(rest.streamRetryLimit)
      ? Math.max(0, Math.floor(rest.streamRetryLimit))
      : RETRY_LIMIT;
    const streamIdleMs = Number.isFinite(rest.streamIdleMs) && rest.streamIdleMs > 0
      ? rest.streamIdleMs
      : STREAM_IDLE_MS;
    const streamTotalMs = Number.isFinite(rest.streamTotalMs) && rest.streamTotalMs > 0
      ? rest.streamTotalMs
      : STREAM_TOTAL_MS;
    for (let attempt = 0; attempt <= streamRetryLimit; attempt++) {
      const ac = new AbortController();
      const startedAt = Date.now();
      let lastChunkAt = Date.now();
      let lastHeartbeatAt = Date.now();
      let abortReason = null;
      const watchdog = setInterval(() => {
        if (ac.signal.aborted) return;
        if (Date.now() - startedAt > streamTotalMs) {
          abortReason = 'total_timeout';
          ac.abort('total_timeout');
        } else if (Date.now() - lastChunkAt > streamIdleMs) {
          abortReason = 'idle_timeout';
          ac.abort('idle_timeout');
        }
      }, 1000);
      if (typeof watchdog.unref === 'function') watchdog.unref();

      try {
        let accumulated = '';
        await callMinimaxStreamText(
          messages,
          { runtimeKey, minimaxModel, maxTokens: rest.maxTokens, temperature: rest.temperature, extra: rest.extra, signal: ac.signal },
          (chunk) => {
            lastChunkAt = Date.now();
            accumulated += chunk;
            // 8s 节流的心跳：让上层 tool 把它转成 tool_progress，刷新 brainAgent idle watchdog
            // text 字段额外带出当前累计原文，给上层做 partial JSON 解析（流式预览用）；
            // name 字段透传调用方传入的 name，让上层能按阶段（如 planSkeleton/planSection_2）分流进度文案；
            // 旧消费者仍可只看 chars，向后兼容。
            if (typeof onStatus === 'function' && Date.now() - lastHeartbeatAt >= STREAM_HEARTBEAT_MS) {
              lastHeartbeatAt = Date.now();
              try { onStatus({ status: 'streaming_heartbeat', name, chars: accumulated.length, text: accumulated, attempt: attempt + 1, source: 'callLLM' }); } catch {}
            }
          }
        );
        return accumulated;
      } catch (err) {
        // 区分自我触发的超时 abort 和上游真错误
        if (abortReason || ac.signal.aborted) {
          const detail = abortReason || 'aborted';
          lastError = new LLMTimeoutError(`[${name}] 流式调用 ${detail}（idle ${streamIdleMs}ms / total ${streamTotalMs}ms）`);
        } else {
          lastError = err;
        }
        if (attempt < streamRetryLimit) {
          console.warn(`[${name}] 流式调用失败 (${attempt + 1}/${streamRetryLimit})，${RETRY_DELAY_MS}ms 后重试:`, lastError.message);
          await sleep(RETRY_DELAY_MS);
        }
      } finally {
        clearInterval(watchdog);
      }
    }
    throw new Error(`[${name}] LLM 流式调用失败（已重试 ${streamRetryLimit} 次）: ${lastError.message}`);
  }

  // ── 阻塞式调用（小输出 / DeepSeek）──────────────────────────────────────────
  // 阻塞调用没有 chunk 反馈，开个墙钟心跳：每 5s 推一次 status='blocking_wait_heartbeat'
  // 给上层 tool，让它转成 tool_progress 刷新 brainAgent idle watchdog。
  let lastError;
  for (let attempt = 0; attempt <= RETRY_LIMIT; attempt++) {
    const controller = timeoutMs > 0 ? new AbortController() : null;
    const signal = controller?.signal;
    const blockingHeartbeat = typeof onStatus === 'function'
      ? setInterval(() => {
          try { onStatus({ status: 'blocking_wait_heartbeat', attempt: attempt + 1, source: 'callLLM' }); } catch {}
        }, BLOCKING_WAIT_HEARTBEAT_MS)
      : null;
    if (blockingHeartbeat && typeof blockingHeartbeat.unref === 'function') blockingHeartbeat.unref();
    try {
      if (model === 'deepseek-reasoner') {
        return await withTimeout(
          callDeepseekReasoner(messages, { runtimeKey, signal, ...rest }),
          timeoutMs,
          name,
          () => controller?.abort()
        );
      } else {
        return await withTimeout(
          callMinimax(messages, { runtimeKey, minimaxModel, signal, ...rest }),
          timeoutMs,
          name,
          () => controller?.abort()
        );
      }
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_LIMIT) {
        console.warn(`[${name}] 调用失败 (${attempt + 1}/${RETRY_LIMIT})，${RETRY_DELAY_MS}ms 后重试:`, err.message);
        await sleep(RETRY_DELAY_MS);
      }
    } finally {
      if (blockingHeartbeat) clearInterval(blockingHeartbeat);
    }
  }
  throw new Error(`[${name}] LLM 调用失败（已重试 ${RETRY_LIMIT} 次）: ${lastError.message}`);
}

async function repairJsonOutput(rawText, options = {}) {
  const {
    model = 'minimax',
    runtimeKey,
    minimaxModel,
    temperature = 0,
    maxTokens = 4096,
    timeoutMs,
    repairTimeoutMs,
    extra,
    name = 'llm',
    repairHint = ''
  } = options;
  // repair 经常需要重新生成完整大 JSON（如 conceptProposal 4000 token），
  // 不能用调用方的 timeoutMs（往往 20s）。允许 caller 用 repairTimeoutMs 显式覆盖；
  // 否则按 max(timeoutMs * 3, 60s) 自动放大。
  const effectiveTimeoutMs = Number.isFinite(repairTimeoutMs) && repairTimeoutMs > 0
    ? repairTimeoutMs
    : Math.max((timeoutMs || 0) * 3, 60_000);

  // repair 也用 anti-think 强约束——MiniMax 推理模型偶尔会把 repair 当对话题，
  // 返回"这份 JSON 格式已经合法，无需修复。"这种中文释义而不是修后的 JSON，
  // 导致 repair 自身解析失败。直接禁掉思考链路 + 强制纯 JSON 输出。
  const repairMessages = [
    {
      role: 'system',
      content: '你是 JSON 修复器。你的任务是把用户提供的内容修复成合法 JSON。\n\n'
        + '⚠️ 输出格式硬约束：\n'
        + '- 只输出**修复后的完整 JSON 对象**，**禁止**使用 <think>、<thought>、思考链、铺垫话语、释义、解释\n'
        + '- 不要先 reasoning 再 JSON——直接以 `{` 开头\n'
        + '- 不要写"这份 JSON 已经合法"、"无需修复"这种中文释义——即使内容已经合法，也直接把它原样输出\n'
        + '- 只修格式，不改语义，不补充解释，不输出 markdown 代码块'
    },
    {
      role: 'user',
      content:
        `请把下面内容修复为合法 JSON，直接输出修复后的 JSON 对象。` +
        `${repairHint ? `\n\n结构要求：${repairHint}` : ''}` +
        `\n\n原始内容如下：\n${rawText}`
    }
  ];

  const text = await callLLM(repairMessages, {
    model,
    runtimeKey,
    minimaxModel,
    temperature,
    maxTokens: Math.min(maxTokens, 4096),
    timeoutMs: effectiveTimeoutMs,
    extra: mergeExtraOptions(extra, { response_format: { type: 'json_object' } }),
    name: `${name}:repair`
  });

  return extractJson(text);
}

/**
 * 调用 LLM 并强制解析 JSON 输出，带重试
 * JSON 解析失败时追加提示消息后重新请求
 */
async function callLLMJson(messages, options = {}) {
  const {
    name = 'llm',
    validate,
    repairHint = '',
    debugLabel = name,
    onStatus,
    fallback,
    retryLimit = RETRY_LIMIT,
    antiThink = true,  // 默认开启：JSON 调用从一开始就禁推理标签，省掉"必败首发"
    ...rest
  } = options;
  // 预注入 anti-think 指令到第一条 system 消息（如果有）或最前面：
  // MiniMax 推理模型默认会先输出 <think>...</think> 思考块，遇上 maxTokens=800-1500 这种
  // 紧的预算时，think 块本身就把 token 吃光了，根本来不及输出 JSON。第一次必败 → 重试
  // 才加 anti-think → 用户每次都至少多等 10-20s。
  // 把 anti-think 提前到首发，正常情况一次就过。
  let msgs = antiThink ? prependAntiThink(messages, repairHint) : messages;
  let lastError;
  let lastRawText = '';

  const jsonRetryLimit = Number.isFinite(retryLimit)
    ? Math.max(0, Math.floor(retryLimit))
    : RETRY_LIMIT;

  for (let attempt = 0; attempt <= jsonRetryLimit; attempt++) {
    try {
      notifyStatus(onStatus, 'requesting', { attempt: attempt + 1 });
      const text = await callLLM(msgs, {
        name,
        ...rest,
        onStatus,  // 把 caller 的 onStatus 透传到 callLLM，使 streaming_heartbeat 能冒泡上来
        extra: mergeExtraOptions(rest.extra, { response_format: { type: 'json_object' } })
      });
      lastRawText = String(text || '');
      notifyStatus(onStatus, 'received', { attempt: attempt + 1, rawText: lastRawText });
      const parsed = extractJson(lastRawText);
      notifyStatus(onStatus, 'validating', { attempt: attempt + 1 });
      return validateStructuredResult(parsed, validate);
    } catch (err) {
      lastError = err;
      notifyStatus(onStatus, 'parse_failed', {
        attempt: attempt + 1,
        error: summarizeError(err)
      });
      if (lastRawText) {
        try {
          notifyStatus(onStatus, 'repairing', { attempt: attempt + 1 });
          const repaired = await repairJsonOutput(lastRawText, { ...rest, name, repairHint });
          notifyStatus(onStatus, 'validating', { attempt: attempt + 1, repaired: true });
          return validateStructuredResult(repaired, validate);
        } catch (repairError) {
          lastError = repairError;
          notifyStatus(onStatus, 'repair_failed', {
            attempt: attempt + 1,
            error: summarizeError(repairError)
          });
          writeDebugSnapshot(`${debugLabel}-repair-failed`, {
            attempt: attempt + 1,
            error: summarizeError(repairError),
            rawText: lastRawText,
            repairHint
          });
        }
      }

      if (attempt < jsonRetryLimit) {
        const isThinkOnly = isThinkOnlyOutput(lastRawText);
        console.warn(`[${name}] JSON 解析失败 (${attempt + 1}/${jsonRetryLimit})，重新请求:`, summarizeError(lastError), isThinkOnly ? '【think 块占满 maxTokens，未输出 JSON】' : '');
        notifyStatus(onStatus, 'retrying', {
          attempt: attempt + 2,
          previousAttempt: attempt + 1,
          error: summarizeError(lastError),
          thinkOnly: isThinkOnly
        });
        // think-only：模型把 token 全用在 <think> 块上没产出 JSON。下一轮必须显式禁止
        // 思考链路，否则重试会同样失败。普通解析失败给原来的简短提示就够。
        const retryNudge = isThinkOnly
          ? '上次输出 token 全部用在 <think> 思考过程里，最终没产出 JSON。**这一次完全不要使用 <think>、<thought> 标签，也不要写任何思考过程或铺垫**——直接产出最终的合法 JSON 对象，token 全部留给 JSON 字段。' +
            (repairHint ? `\n结构要求：${repairHint}` : '')
          : '上次输出无法通过结构化校验。请重新输出，并且只返回合法 JSON，不要包含任何额外文字或代码块。' +
            `\n问题摘要：${summarizeError(lastError)}` +
            (repairHint ? `\n结构要求：${repairHint}` : '');
        msgs = [
          ...msgs,
          { role: 'user', content: retryNudge }
        ];
        lastRawText = '';
      }
    }
  }
  if (typeof fallback === 'function') {
    notifyStatus(onStatus, 'fallback_start', { error: summarizeError(lastError) });
    try {
      return fallback({ rawText: lastRawText, error: lastError });
    } catch (fallbackError) {
      lastError = fallbackError;
      notifyStatus(onStatus, 'fallback_failed', { error: summarizeError(fallbackError) });
    }
  }
  writeDebugSnapshot(`${debugLabel}-final-failure`, {
    error: summarizeError(lastError),
    rawText: lastRawText,
    repairHint
  });
  throw new Error(`[${name}] JSON 解析失败（已重试 ${jsonRetryLimit} 次）: ${summarizeError(lastError)}`);
}

module.exports = { callLLM, callLLMJson, extractJson, stripThinkTags, LLMTimeoutError };
