// LLM 客户端统一管理
// 支持两种方式提供 Key：运行时传入（优先）或 .env 配置（兜底）
const OpenAI = require('openai');
const config = require('../config');

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
  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
    ...(options.extra || {})
  });
  return response.choices[0].message.content;
}

/**
 * 调用 DeepSeek-R1（仅 Critic Agent，按量付费）
 * @param {string[]} messages
 * @param {object}  options  - { temperature, maxTokens, extra, runtimeKey }
 */
async function callDeepseekReasoner(messages, options = {}) {
  const client = createDeepseekClient(options.runtimeKey);
  const response = await client.chat.completions.create({
    model: config.deepseekReasonerModel,
    messages,
    temperature: options.temperature ?? 0.6,
    max_tokens: options.maxTokens ?? 8192,
    ...(options.extra || {})
  });
  return response.choices[0].message.content;
}

module.exports = { callMinimax, callDeepseekReasoner };
