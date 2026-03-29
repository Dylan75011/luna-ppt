// Agent 基类：封装 LLM 调用、重试、JSON 解析
const { callMinimax, callDeepseekReasoner } = require('../services/llmClients');

const RETRY_LIMIT = 2;
const RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 从文本中提取 JSON
 * 兼容：<think>...</think> 推理标签、markdown 代码块、裸 JSON
 */
function extractJson(text) {
  // 1. 剥离 <think>...</think> 推理过程（MiniMax / DeepSeek-R1 均可能输出）
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. 尝试提取 markdown 代码块
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : text;
  return JSON.parse(jsonStr.trim());
}

class BaseAgent {
  constructor(name, model = 'minimax') {
    this.name = name;
    this.model = model; // 'minimax' | 'deepseek-reasoner'
    this.apiKeys = {};  // 运行时 Key，由 Orchestrator 注入
  }

  /**
   * 调用 LLM，带重试
   * options 会自动注入 runtimeKey
   */
  async callLLM(messages, options = {}) {
    // 根据模型类型注入对应的运行时 Key
    const runtimeKey = this.model === 'deepseek-reasoner'
      ? this.apiKeys.deepseekApiKey
      : this.apiKeys.minimaxApiKey;
    const mergedOptions = {
      ...options,
      runtimeKey,
      minimaxModel: this.apiKeys.minimaxModel || undefined
    };

    let lastError;
    for (let attempt = 0; attempt <= RETRY_LIMIT; attempt++) {
      try {
        if (this.model === 'deepseek-reasoner') {
          return await callDeepseekReasoner(messages, mergedOptions);
        } else {
          return await callMinimax(messages, mergedOptions);
        }
      } catch (err) {
        lastError = err;
        if (attempt < RETRY_LIMIT) {
          console.warn(`[${this.name}] 调用失败 (${attempt + 1}/${RETRY_LIMIT})，${RETRY_DELAY_MS}ms 后重试:`, err.message);
          await sleep(RETRY_DELAY_MS);
        }
      }
    }
    throw new Error(`[${this.name}] LLM 调用失败（已重试 ${RETRY_LIMIT} 次）: ${lastError.message}`);
  }

  /**
   * 调用 LLM 并强制解析 JSON 输出，带重试
   */
  async callLLMJson(messages, options = {}) {
    let lastError;
    for (let attempt = 0; attempt <= RETRY_LIMIT; attempt++) {
      try {
        const text = await this.callLLM(messages, options);
        return extractJson(text);
      } catch (err) {
        lastError = err;
        if (attempt < RETRY_LIMIT) {
          console.warn(`[${this.name}] JSON 解析失败 (${attempt + 1}/${RETRY_LIMIT})，重新请求:`, err.message);
          // 在消息末尾追加提示，要求严格 JSON
          messages = [
            ...messages,
            { role: 'assistant', content: '（上次输出无法解析为 JSON，请重新输出，仅返回合法 JSON，不要包含任何其他文字）' }
          ];
        }
      }
    }
    throw new Error(`[${this.name}] JSON 解析失败（已重试 ${RETRY_LIMIT} 次）: ${lastError.message}`);
  }

  /**
   * 子类实现此方法
   */
  async run(input) {
    throw new Error(`[${this.name}] run() 未实现`);
  }
}

module.exports = BaseAgent;
