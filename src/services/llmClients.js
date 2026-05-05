// LLM 客户端统一管理
// 支持两种方式提供 Key：运行时传入（优先）或 .env 配置（兜底）
const OpenAI = require('openai');
const config = require('../config');

function shouldRetryWithoutJsonObject(err, request = {}) {
  if (!request.response_format || request.response_format.type !== 'json_object') return false;
  const message = String(err?.message || '').toLowerCase();
  return (
    message.includes('response_format') ||
    message.includes('json_object') ||
    message.includes('unsupported') ||
    message.includes('unknown parameter') ||
    message.includes('invalid parameter')
  );
}

async function createChatCompletion(client, request, { signal } = {}) {
  const opts = signal ? { signal } : undefined;
  try {
    return await client.chat.completions.create(request, opts);
  } catch (error) {
    if (shouldRetryWithoutJsonObject(error, request)) {
      const fallbackRequest = { ...request };
      delete fallbackRequest.response_format;
      return client.chat.completions.create(fallbackRequest, opts);
    }
    throw error;
  }
}

/**
 * 创建 MiniMax 客户端（每次按需创建，支持运行时 Key 覆盖）
 */
function createMinimaxClient(runtimeKey) {
  const apiKey = runtimeKey || config.minimaxApiKey;
  if (!apiKey) throw new Error('MINIMAX_API_KEY 未配置，请在设置面板中填写');
  return new OpenAI({ apiKey, baseURL: config.minimaxBaseUrl });
}

/**
 * 创建 DeepSeek 客户端（每次按需创建，支持运行时 Key 覆盖）
 */
function createDeepseekClient(runtimeKey) {
  const apiKey = runtimeKey || config.deepseekApiKey;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 未配置，请在设置面板中填写');
  return new OpenAI({ apiKey, baseURL: config.deepseekBaseUrl });
}

/**
 * 调用 MiniMax（主力模型，订阅制）
 * @param {string[]} messages
 * @param {object}  options  - { temperature, maxTokens, extra, runtimeKey }
 */
async function callMinimax(messages, options = {}) {
  const client = createMinimaxClient(options.runtimeKey);
  const model = options.minimaxModel || config.minimaxModel;
  const response = await createChatCompletion(client, {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
    ...(options.extra || {})
  }, { signal: options.signal });
  return response.choices[0].message.content;
}

/**
 * 调用 DeepSeek 推理模型（仅 Critic Agent，按量付费）
 * V4 起 thinking 模式由参数显式开启，否则即使用 v4-pro 也只跑 non-thinking。
 * thinking 模式会忽略 temperature，但保留参数以兼容老 reasoner alias。
 * @param {string[]} messages
 * @param {object}  options  - { temperature, maxTokens, extra, runtimeKey }
 */
async function callDeepseekReasoner(messages, options = {}) {
  const client = createDeepseekClient(options.runtimeKey);
  const response = await createChatCompletion(client, {
    model: config.deepseekReasonerModel,
    messages,
    temperature: options.temperature ?? 0.6,
    max_tokens: options.maxTokens ?? 8192,
    thinking: { type: 'enabled' },
    ...(options.extra || {})
  }, { signal: options.signal });
  return response.choices[0].message.content;
}

/**
 * 调用 MiniMax，支持 function calling（工具调用）
 * 返回 choice 对象：{ message: { role, content, tool_calls }, finish_reason }
 */
async function callMinimaxWithTools(messages, tools, options = {}) {
  const client = createMinimaxClient(options.runtimeKey);
  const model = options.minimaxModel || config.minimaxModel;
  const response = await client.chat.completions.create({
    model,
    messages,
    tools,
    tool_choice: options.tool_choice || 'auto',
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
    ...(options.extra || {})
  });
  return response.choices[0]; // { message, finish_reason }
}

/**
 * 调用 MiniMax，支持 function calling + 流式输出
 * @param {Array}    messages
 * @param {Array}    tools
 * @param {object}   options  - { runtimeKey, minimaxModel, temperature, maxTokens, tool_choice, extra }
 * @param {Function} onChunk  - ({ type: 'text_delta', delta: string }) => void
 * @returns {{ message: { role, content, tool_calls }, finish_reason }}
 */
async function callMinimaxWithToolsStream(messages, tools, options = {}, onChunk = () => {}) {
  const client = createMinimaxClient(options.runtimeKey);
  const model = options.minimaxModel || config.minimaxModel;
  const requestOpts = options.signal ? { signal: options.signal } : undefined;

  const stream = await client.chat.completions.create({
    model,
    messages,
    tools,
    tool_choice: options.tool_choice || 'auto',
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
    stream: true,
    ...(options.extra || {})
  }, requestOpts);

  let fullContent = '';
  const toolCallsMap = {};
  let finishReason = null;

  for await (const chunk of stream) {
    if (options.signal?.aborted) break;
    const choice = chunk.choices[0];
    if (!choice) {
      // 空 chunk（保活/分片间隔）也算 heartbeat，让外层 watchdog 知道连接还活
      onChunk({ type: 'heartbeat' });
      continue;
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;

    const delta = choice.delta;

    // 文字内容：实时回调
    if (delta?.content) {
      fullContent += delta.content;
      onChunk({ type: 'text_delta', delta: delta.content });
    } else if (delta?.tool_calls) {
      // 工具调用 delta 也要触发 onChunk —— 否则 brainAgent 的 idle watchdog
      // 在模型只生成 tool_call 时永远更新不到 lastChunkAt，可能误触发 abort；
      // 反过来，模型若卡在 tool_call 慢吐 delta，watchdog 也能感知"还在动"
      onChunk({ type: 'tool_call_delta' });
    } else {
      // delta 完全为空（仅 finish_reason 等）
      onChunk({ type: 'heartbeat' });
    }

    // 工具调用：按 index 累积（流式下分片到达）
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallsMap[idx]) {
          toolCallsMap[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        }
        if (tc.id) toolCallsMap[idx].id = tc.id;
        if (tc.function?.name)      toolCallsMap[idx].function.name      += tc.function.name;
        if (tc.function?.arguments) toolCallsMap[idx].function.arguments += tc.function.arguments;
      }
    }
  }

  const toolCallsMapValues = Object.values(toolCallsMap);
  // 兜底解析 MiniMax 在文本里直接吐 XML 工具调用（<minimax:tool_call><invoke name="X">
  // <parameter name="Y">Z</parameter></invoke></minimax:tool_call>）的 case。
  // 这种情况 delta.tool_calls 永远不会触发，OpenAI 风格的 function-calling API 用不上，
  // brain 看到的就是一段文本——前端 UI 显示成 "小米汽车 2026 新车发布 计划\n5" 这种伪
  // 工具卡片。这里把 XML 块从 content 里提出来转成正常 tool_calls 给 brain 主循环执行。
  const xmlExtracted = extractMinimaxXmlToolCalls(fullContent);
  if (xmlExtracted.toolCalls.length) {
    fullContent = xmlExtracted.cleanContent;
    for (const tc of xmlExtracted.toolCalls) toolCallsMapValues.push(tc);
    console.warn(`[callMinimaxWithToolsStream] 从文本中救回 ${xmlExtracted.toolCalls.length} 个 minimax XML tool_call`);
  }

  const toolCalls = toolCallsMapValues.length > 0 ? toolCallsMapValues : undefined;

  return {
    message: { role: 'assistant', content: fullContent || null, tool_calls: toolCalls },
    finish_reason: finishReason
  };
}

/**
 * 从 LLM 的文本输出里解析 MiniMax 原生的 XML 风格 tool_call 块。
 *
 * MiniMax 推理模型偶尔（尤其在长 conversation history 下）会绕过 OpenAI tools API，
 * 直接在 content 里写 `<minimax:tool_call>` XML：
 *
 *   <minimax:tool_call>
 *     <invoke name="web_search">
 *       <parameter name="query">小米汽车 2026 计划</parameter>
 *       <parameter name="max_results">5</parameter>
 *     </invoke>
 *   </minimax:tool_call>
 *
 * 用宽容正则提取 invoke 块，转换成标准 { id, type:'function', function:{name, arguments} }。
 * arguments 必须是 JSON 字符串（OpenAI spec），按 parameter 类型推断 number/boolean。
 */
function extractMinimaxXmlToolCalls(content = '') {
  if (!content || typeof content !== 'string') {
    return { cleanContent: content || '', toolCalls: [] };
  }
  // 不要求 <minimax:tool_call> 包裹（模型有时只吐 <invoke>），直接抓所有 invoke 块
  const invokeRe = /<invoke\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/invoke>/gi;
  const paramRe = /<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;
  const toolCalls = [];
  let cleanContent = content;
  let match;
  let counter = 0;
  while ((match = invokeRe.exec(content)) !== null) {
    const fnName = String(match[1] || '').trim();
    const inner = match[2] || '';
    if (!fnName) continue;
    const args = {};
    let pmatch;
    paramRe.lastIndex = 0;
    while ((pmatch = paramRe.exec(inner)) !== null) {
      const key = String(pmatch[1] || '').trim();
      const rawVal = String(pmatch[2] || '').trim();
      if (!key) continue;
      // 类型推断：纯整数 → number，true/false → boolean，否则 string
      let val;
      if (/^-?\d+$/.test(rawVal)) val = parseInt(rawVal, 10);
      else if (/^-?\d+\.\d+$/.test(rawVal)) val = parseFloat(rawVal);
      else if (rawVal === 'true' || rawVal === 'false') val = rawVal === 'true';
      else val = rawVal;
      args[key] = val;
    }
    toolCalls.push({
      id: `recovered_minimax_xml_${Date.now()}_${counter++}`,
      type: 'function',
      function: { name: fnName, arguments: JSON.stringify(args) }
    });
  }
  if (toolCalls.length) {
    // 把 invoke 块和外层 minimax:tool_call 包装一起从 content 里删干净
    cleanContent = content
      .replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/gi, '')
      .replace(invokeRe, '')
      .replace(/<minimax:tool_call>|<\/minimax:tool_call>/gi, '')
      .trim();
  }
  return { cleanContent, toolCalls };
}

/**
 * 纯文本流式输出（无工具调用）
 * @param {Array}    messages
 * @param {object}   options  - { runtimeKey, minimaxModel, temperature, maxTokens, signal, extra }
 * @param {Function} onChunk  - (delta: string) => void，每个文本片段调用一次
 * @returns {Promise<string>} 完整文本
 */
async function callMinimaxStreamText(messages, options = {}, onChunk = () => {}) {
  const client = createMinimaxClient(options.runtimeKey);
  const model = options.minimaxModel || config.minimaxModel;
  const requestOpts = options.signal ? { signal: options.signal } : undefined;
  const stream = await client.chat.completions.create({
    model,
    messages,
    stream: true,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
    ...(options.extra || {})
  }, requestOpts);
  let fullContent = '';
  for await (const chunk of stream) {
    if (options.signal?.aborted) break;
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      fullContent += delta;
      onChunk(delta);
    }
  }
  return fullContent;
}

/**
 * deepseek-chat 流式文本输出，无 tool calling。
 * 用于 brainAgent L2 软失败兜底——独立 provider 独立故障模式，
 * 当 minimax 网络/服务不稳时给用户一段交代。
 *
 * @param {Array}    messages
 * @param {object}   options  - { runtimeKey, deepseekChatModel, temperature, maxTokens, signal }
 * @param {Function} onChunk  - (delta: string) => void
 */
async function callDeepseekChatText(messages, options = {}, onChunk = () => {}) {
  const client = createDeepseekClient(options.runtimeKey);
  const model = options.deepseekChatModel || config.deepseekChatModel;
  const requestOpts = options.signal ? { signal: options.signal } : undefined;
  const stream = await client.chat.completions.create({
    model,
    messages,
    stream: true,
    temperature: options.temperature ?? 0.5,
    max_tokens: options.maxTokens ?? 1500,
    thinking: { type: 'disabled' }
  }, requestOpts);
  let fullContent = '';
  for await (const chunk of stream) {
    if (options.signal?.aborted) break;
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      fullContent += delta;
      onChunk(delta);
    }
  }
  return fullContent;
}

module.exports = {
  callMinimax,
  callDeepseekReasoner,
  callMinimaxWithTools,
  callMinimaxWithToolsStream,
  callMinimaxStreamText,
  callDeepseekChatText
};
