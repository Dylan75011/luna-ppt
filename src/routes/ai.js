// AI生成API
const express = require('express');
const router = express.Router();
const aiAssistant = require('../services/aiAssistant');
const { callMinimax } = require('../services/llmClients');
const workspaceManager = require('../services/workspaceManager');
const platformMemory = require('../services/platformMemory');
const { buildChatHistory, compactText, compactList } = require('../services/contextEngineering');

// ── 过滤掉模型的思考过程，只保留最终回复 ──────────────────────────
function cleanReply(text) {
  if (!text) return '';
  // 去掉 <think>...</think> 标签
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const badPrefixes = [
    /^用户(说|发送|提到|问|输入)/,
    /^用户要求我/,
    /^请基于以下/,
    /^已知信息/,
    /^已确认信息/,
    /^你已经知道/,
    /^你还需要确认/,
    /^还缺/,
    /^要求[:：]?$/,
    /^根据(我的|角色|指示|系统)/,
    /^我应该/,
    /^这是一个简单/,
    /^品牌[:：]/,
    /^活动类型[:：]/,
    /^规模[:：]/,
    /^预算[:：]/,
    /^风格[:：]/
  ];

  // 只从开头连续删除独白行，遇到正常回复就停止
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (badPrefixes.some(p => p.test(lines[i]))) {
      start = i + 1;
    } else {
      break;
    }
  }

  const result = lines.slice(start).join('\n').trim();
  return result || text.trim();
}

function parseJsonReply(text) {
  if (!text) throw new Error('模型返回为空');

  const cleaned = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[ \t]*json/gi, '```')
    .replace(/```[ \t]*javascript/gi, '```')
    .replace(/```[ \t]*js/gi, '```')
    .trim();

  const candidates = [];
  const pushCandidate = (value) => {
    const next = String(value || '').trim();
    if (next && !candidates.includes(next)) candidates.push(next);
  };

  pushCandidate(cleaned);

  const fenceMatches = cleaned.match(/```[\s\S]*?```/g) || [];
  fenceMatches.forEach((block) => {
    pushCandidate(block.replace(/^```[^\n]*\n?/, '').replace(/```$/, ''));
  });

  const objectMatches = cleaned.match(/\{[\s\S]*\}/g) || [];
  objectMatches.forEach(pushCandidate);

  for (const candidate of candidates) {
    const jsonMatch = candidate.match(/\{[\s\S]*\}/);
    const payload = (jsonMatch?.[0] || candidate).trim();
    try {
      return JSON.parse(payload);
    } catch {}
  }

  throw new Error(`JSON_PARSE_FAILED: ${cleaned.slice(0, 180)}`);
}

async function repairStructuredJson(raw, schemaHint, apiKeys = {}) {
  const systemPrompt = `你是 JSON 修复器。
- 你会收到一段本该是 JSON 的模型输出，但它可能混入解释、markdown、代码块或格式错误
- 你的任务是把它整理成严格合法的 JSON
- 只输出 JSON 本体，不要解释，不要代码块`;

  const repaired = await callMinimax([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `请把这段内容修复成符合下列结构的合法 JSON。\n结构提示：${schemaHint}\n\n原始内容：\n${raw}` }
  ], {
    runtimeKey: apiKeys.minimaxApiKey,
    minimaxModel: apiKeys.minimaxModel,
    temperature: 0.1,
    maxTokens: 500
  });

  try {
    return parseJsonReply(repaired);
  } catch (err) {
    throw new Error(`JSON_REPAIR_FAILED: ${err.message}`);
  }
}

function sendAiError(res, status, code, error, extra = {}) {
  return res.status(status).json({
    success: false,
    code,
    error,
    ...extra
  });
}

function classifyAiError(err) {
  const message = err?.message || '未知错误';
  if (/MINIMAX_API_KEY 未配置/i.test(message)) {
    return { status: 400, code: 'MINIMAX_KEY_MISSING', error: message };
  }
  if (/401|login fail|Authorization|API secret key/i.test(message)) {
    return { status: 401, code: 'MINIMAX_AUTH_FAILED', error: message };
  }
  if (/Failed to fetch|NetworkError|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(message)) {
    return { status: 502, code: 'UPSTREAM_NETWORK_ERROR', error: message };
  }
  return { status: 500, code: 'AI_ROUTE_FAILED', error: message };
}

function hasPromptLeakage(text) {
  if (!text) return true;
  const leakedPatterns = [
    /已知信息/,
    /已确认信息/,
    /用户要求我/,
    /客户只说了/,
    /客户原话/,
    /关键信息/,
    /我需要像真实顾问一样/,
    /作为顾问/,
    /我可以[:：]/,
    /不要[:：]/,
    /先直接问关键问题/,
    /或者先给一个工作假设/,
    /^\d+\./m,
    /^-\s/m,
    /请基于以下/,
    /你已经知道/,
    /你还需要确认/,
    /要求[:：]?/,
    /客户原话[:：]?.*你已/
  ];
  return leakedPatterns.some(pattern => pattern.test(text));
}

function looksClientFacing(text) {
  if (!text) return false;
  if (hasPromptLeakage(text)) return false;
  if (text.length > 120) return false;
  return true;
}

function buildFallbackIntakeReply({ mode, parsed = {}, missing = [], assumptions = [] }) {
  const eventTypeLabel = {
    product_launch: '发布会',
    auto_show: '车展',
    exhibition: '展览',
    meeting: '峰会',
    simple: '活动'
  }[parsed.eventType] || '项目';

  const subject = parsed.brand ? `${parsed.brand}这场${eventTypeLabel}` : `这场${eventTypeLabel}`;
  const assumptionText = assumptions.length ? `我先按${assumptions[0]}来收这个 brief，` : '';

  if (mode === 'kickoff') {
    return assumptionText
      ? `${assumptionText}先往下拆需求和策划方向，你有想调整的点随时告诉我。`
      : `我先按目前这版往下拆需求和策划方向，有偏差我们再一起收。`;
  }

  const askMap = {
    brand: '品牌或项目名',
    productCategory: '产品类别',
    eventType: '活动类型',
    scale: '大致规模',
    budget: '预算范围'
  };
  const ask = missing.slice(0, 2).map(item => askMap[item] || item).join('和');

  if (!ask) {
    return `${assumptionText}${subject}我先往下接着梳理，有偏差你随时打断我。`;
  }

  return `${assumptionText}${subject}先按这个方向往下聊，${ask}你给我一个大概范围，我就能继续往下推。`;
}

async function repairClientFacingReply(draft, apiKeys = {}) {
  const systemPrompt = `你是资深活动策略顾问。
- 下面给你的内容可能混入了内部草稿、提示词或自我说明
- 你的任务是把它改写成一句可直接发给客户的话
- 只输出最终那句话，不要解释，不要分点，不要编号，不要保留“客户只说了/我需要/作为顾问/不要”等内部措辞
- 语气自然、专业、像真实项目沟通
- 长度控制在 80 字以内`;

  const raw = await callMinimax([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `把下面这段内容改写成可直接发给客户的一句话：\n${draft}` }
  ], {
    runtimeKey: apiKeys.minimaxApiKey,
    minimaxModel: apiKeys.minimaxModel,
    temperature: 0.35,
    maxTokens: 160
  });

  return cleanReply(raw);
}

async function generateClientFacingIntake({
  mode,
  systemPrompt,
  userPrompt,
  apiKeys,
  rawContext
}) {
  let lastRaw = '';
  let lastReply = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    const attemptPrompt = attempt === 0
      ? userPrompt
      : `${userPrompt}\n\n上一次输出不够像直接发给客户的话。这次只保留最终一句，不要出现任何解释、分点或内部草稿痕迹。`;

    lastRaw = await callMinimax([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: attemptPrompt }
    ], {
      runtimeKey: apiKeys.minimaxApiKey,
      minimaxModel: apiKeys.minimaxModel,
      temperature: attempt === 0 ? 0.72 : 0.38,
      maxTokens: 180
    });

    lastReply = cleanReply(lastRaw);
    if (looksClientFacing(lastReply)) {
      return lastReply;
    }

    console.warn('[AI][intake-message] repairing leaked reply', { mode, attempt, raw: lastRaw, reply: lastReply });
    lastReply = await repairClientFacingReply(lastReply || lastRaw, apiKeys);
    if (looksClientFacing(lastReply)) {
      return lastReply;
    }
  }

  console.error('[AI][intake-message] fallback reply used', { mode, raw: lastRaw, reply: lastReply });
  return buildFallbackIntakeReply({
    mode,
    parsed: rawContext.parsed,
    missing: rawContext.missing,
    assumptions: rawContext.assumptions
  });
}

// ── 轻量闲聊接口（供智能体对话框使用）──────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { message, history = [], apiKeys = {} } = req.body;
    if (!message) return res.status(400).json({ success: false, error: '消息不能为空' });

    const systemPrompt = `你是 OpenClaw 活动策划助手。直接用中文回复用户，不要描述自己在想什么。
- 问候语：自然友好地打招呼，简短介绍你能策划发布会/车展/展览/峰会并生成 PPT
- 活动需求：引导用户说明品牌、活动类型、预算
- 其他问题：礼貌说明你专注于活动策划
- 回复控制在 80 字以内，不加多余格式`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...buildChatHistory(history),
      { role: 'user', content: compactText(message, 160) }
    ];

    const raw = await callMinimax(messages, {
      runtimeKey: apiKeys.minimaxApiKey,
      minimaxModel: apiKeys.minimaxModel,
      temperature: 0.8,
      maxTokens: 256
    });

    res.json({ success: true, reply: cleanReply(raw) });
  } catch (err) {
    const meta = classifyAiError(err);
    sendAiError(res, meta.status, meta.code, meta.error);
  }
});

// ── 需求确认/启动话术生成（规则判断，AI表述）──────────────────────
router.post('/intake-message', async (req, res) => {
  try {
    const { mode, parsed = {}, missing = [], round = 1, maxRounds = 3, apiKeys = {} } = req.body;
    if (!mode) return sendAiError(res, 400, 'MODE_REQUIRED', '缺少 mode');
    console.log('[AI][intake-message] request', {
      mode,
      hasRuntimeKey: !!apiKeys.minimaxApiKey,
      minimaxModel: apiKeys.minimaxModel || 'default',
      parsed: {
        brand: parsed.brand || '',
        eventType: parsed.eventType || '',
        scale: parsed.scale || '',
        budget: parsed.budget || ''
      },
      missing
    });

    const latestUserInput = String(parsed.requirements || '')
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean)
      .at(-1) || '';

    const systemPrompt = `你是资深活动策略顾问，正在和客户确认活动 brief。
- 你最终发给客户的，只能是一句到两句可直接发送的话，不要解释自己在做什么
- 语气要像成熟顾问在对项目：专业、自然、松弛，不要像客服、表单机器人或系统提示
- 绝对不要复述输入材料，不要出现“已知信息”“还缺”“要求”“用户要求我”“请基于以下上下文”等字样
- 不要描述模型、系统、字段、规则，也不要出现编号、项目符号、JSON
- 不要使用“我先这样理解”“我这边先理解为”“我先按…理解”这类悬空、像机器独白的说法
- 你的回复方式不要固定成同一套模板，要根据客户语气自然调整
- 如果信息不够，优先像真实顾问一样接住上下文；你可以追问，也可以先给一个保守判断再请客户确认，不必每次都按同一个问法
- 如果客户已经表达“你来定”“你判断”“先按你经验来”，可以减少追问，直接提出一个合理工作假设
- 如果信息足够，就自然确认理解，并说明接下来会开始拆解需求和策划方向
- 绝对不要擅自补充客户没说过的产品系列、型号、主题名、 campaign 名；如果客户只说“华为发布会”，就只能说“华为这场发布会”或“这个发布会方向”，不能替他写成 nova、Mate、Pura 等具体系列
- 尽量像真实项目沟通，少一点说明感，多一点在接 brief 的感觉
- 更自然的表达接近：“先按这个方向往下聊”“我先按新品发布的方向收这个 brief”“这个方向可以，我继续往下推”
- 总长度控制在 90 字以内`;

    const eventTypeLabel = {
      product_launch: '新品发布会',
      auto_show: '车展',
      exhibition: '展览',
      meeting: '峰会',
      simple: '活动策划'
    }[parsed.eventType] || '';

    const knownBits = [
      parsed.brand ? `品牌是${parsed.brand}` : '',
      eventTypeLabel ? `方向先按${eventTypeLabel}` : '',
      parsed.scale ? `规模先按${parsed.scale}` : '',
      parsed.budget ? `预算先按${parsed.budget}` : '',
      parsed.style ? `风格偏${parsed.style}` : ''
    ].filter(Boolean).join('，');

    const missingLabels = missing
      .map(field => ({
        brand: '品牌',
        productCategory: '产品类别',
        eventType: '活动类型',
        scale: '规模',
        budget: '预算'
      }[field] || field))
      .join('、');

    const assumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions.filter(Boolean) : [];
    const assumptionText = assumptions.length ? `当前可以先按这些工作假设推进：${assumptions.join('；')}。` : '';

    const roundHint = mode === 'clarify'
      ? `当前是第 ${round} 轮确认，理想上 2 轮内收口，最晚不要超过 ${maxRounds} 轮。`
      : '';

    const userPrompt = mode === 'clarify'
      ? `客户刚发来一个活动需求，你现在要回一句自然的话。
客户原话：${latestUserInput || '未提供'}。
你已把握到的方向：${knownBits || '方向还比较模糊'}。
这次最需要补确认的是：${missingLabels || '无'}。
${assumptionText}
${roundHint}
请直接输出发给客户的话：
不用固定套话，可以自由组织表达；
如果客户明显在给你判断空间，可以直接提一个工作假设，再补一句确认；
如果已经是较后轮次，优先帮助对话收口，不要再展开新的问题树；
如果合适，可以顺手给一个很短的补充示例，但不要模板味太重；
不要复述上面的材料。`
      : `客户的基本信息已经够启动了。
客户原话：${latestUserInput || '未提供'}。
你已确认的方向：${knownBits || '活动需求已明确'}。
${assumptionText}
请直接输出发给客户的话：
自然确认你的理解，并顺势告诉客户接下来会开始拆解需求和策划方向；
如果有工作假设，可以自然带进去，不要刻意强调“这是模板”；
语气稳一点，像成熟顾问，不要兴奋，不要复述上面的材料。`;

    const reply = await generateClientFacingIntake({
      mode,
      systemPrompt,
      userPrompt,
      apiKeys,
      rawContext: { parsed, missing, assumptions }
    });

    console.log('[AI][intake-message] success', { mode, reply });
    res.json({ success: true, reply });
  } catch (err) {
    console.error('[AI][intake-message] failed', {
      mode: req.body?.mode || 'unknown',
      error: err.message,
      stack: err.stack
    });
    const meta = classifyAiError(err);
    sendAiError(res, meta.status, meta.code, meta.error);
  }
});

router.post('/parse-task', async (req, res) => {
  try {
    const { text = '', draft = {}, round = 0, apiKeys = {} } = req.body;
    if (!text.trim()) {
      return sendAiError(res, 400, 'TEXT_REQUIRED', '消息不能为空');
    }

    const latestUserInput = text.trim();
    const previousDraft = {
      brand: draft.brand || '',
      productCategory: draft.productCategory || '',
      eventType: draft.eventType || '',
      topic: draft.topic || '',
      scale: draft.scale || '',
      budget: draft.budget || '',
      style: draft.style || '',
      requirements: draft.requirements || ''
    };

    console.log('[AI][parse-task] request', {
      hasRuntimeKey: !!apiKeys.minimaxApiKey,
      minimaxModel: apiKeys.minimaxModel || 'default',
      latestUserInput,
      hasDraft: !!Object.values(previousDraft).find(Boolean),
      round
    });

    const systemPrompt = `你是活动策划助手的需求解析器。你的任务是把客户的话解析成结构化 brief。
- 只输出 JSON，对象格式必须可直接被 JSON.parse 解析
- 不能编造客户没说过的品牌、产品系列、型号、主题名、预算、规模、风格
- 允许做保守归类：比如“发布会”可归为 product_launch，“车展”可归为 auto_show，但不要把“华为发布会”擅自补成 nova、Mate、Pura
- 如果客户是在补充上一轮信息，要结合已有 draft 合并结果
- 只有当明确像活动策划需求或在继续补充活动 brief 时，taskIntent 才能为 true
- 若信息不足，请把缺失项列到 missing；关键字段是 brand、productCategory、eventType、scale、budget
- 如果客户明确把判断权交给你，比如“你定吧”“你判断”“先按你经验来”，可以为仍缺的字段给出保守、可执行的工作假设
- 这种情况下，把你代为设定的内容写入 parsed，同时在 assumptions 数组里简短说明；不要为了维持缺口而机械追问
- 追问轮次理想上不超过 2 轮，最多不超过 3 轮
- 当 round >= 2 时，优先收口：尽量基于上下文和保守假设补齐字段，减少继续追问
- 当 round >= 3 时，只要还能形成合理、可执行的活动 brief，就不要再追问，把 decisionMode 设为 proceed
- style 不是必填，topic 尽量用中性说法
- eventType 只能是 product_launch、auto_show、exhibition、meeting、simple 之一，拿不准就留空字符串
- missing 只能从 brand、productCategory、eventType、scale、budget 中选
- 不要输出解释，不要加 markdown 代码块

输出 JSON 结构：
{
  "taskIntent": true,
  "decisionMode": "clarify",
  "confidence": 0.0,
  "parsed": {
    "brand": "",
    "productCategory": "",
    "eventType": "",
    "topic": "",
    "scale": "",
    "budget": "",
    "style": "",
    "requirements": ""
  },
  "assumptions": [],
  "missing": []
}`;

    const userPrompt = `请解析这次客户输入。
当前已追问轮次：${round}。
上一轮 draft：
${JSON.stringify(previousDraft, null, 2)}

这次客户原话：
${latestUserInput}`;

    const schemaHint = `{
  "taskIntent": true,
  "decisionMode": "clarify",
  "confidence": 0.0,
  "parsed": {
    "brand": "",
    "productCategory": "",
    "eventType": "",
    "topic": "",
    "scale": "",
    "budget": "",
    "style": "",
    "requirements": ""
  },
  "assumptions": [],
  "missing": []
}`;

    let parsedResult;
    let lastRaw = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const attemptPrompt = attempt === 0
        ? userPrompt
        : `${userPrompt}\n\n上一次输出不是严格合法的 JSON。这次只输出 JSON 本体，不要带任何解释。`;

      lastRaw = await callMinimax([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: attemptPrompt }
      ], {
        runtimeKey: apiKeys.minimaxApiKey,
        minimaxModel: apiKeys.minimaxModel,
        temperature: 0.1,
        maxTokens: 500
      });

      try {
        parsedResult = parseJsonReply(lastRaw);
        break;
      } catch (err) {
        console.warn('[AI][parse-task] invalid json, trying repair', { attempt, raw: lastRaw, error: err.message });
        try {
          parsedResult = await repairStructuredJson(lastRaw, schemaHint, apiKeys);
          break;
        } catch (repairErr) {
          console.warn('[AI][parse-task] repair failed', { attempt, error: repairErr.message });
        }
      }
    }

    if (!parsedResult) {
      console.error('[AI][parse-task] invalid json after retries', { raw: lastRaw });
      return sendAiError(res, 502, 'PARSE_RESULT_UNSTABLE', '需求解析结果不稳定');
    }

    const allowedMissing = ['brand', 'productCategory', 'eventType', 'scale', 'budget'];
    const parsed = {
      brand: String(parsedResult?.parsed?.brand || previousDraft.brand || '').trim(),
      productCategory: String(parsedResult?.parsed?.productCategory || previousDraft.productCategory || '').trim(),
      eventType: ['product_launch', 'auto_show', 'exhibition', 'meeting', 'simple'].includes(parsedResult?.parsed?.eventType)
        ? parsedResult.parsed.eventType
        : (previousDraft.eventType || ''),
      topic: String(parsedResult?.parsed?.topic || previousDraft.topic || '').trim(),
      scale: String(parsedResult?.parsed?.scale || previousDraft.scale || '').trim(),
      budget: String(parsedResult?.parsed?.budget || previousDraft.budget || '').trim(),
      style: String(parsedResult?.parsed?.style || previousDraft.style || '').trim(),
      requirements: previousDraft.requirements
        ? `${previousDraft.requirements}\n${latestUserInput}`
        : latestUserInput
    };

    const assumptions = Array.isArray(parsedResult?.assumptions)
      ? parsedResult.assumptions
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 3)
      : [];

    const missing = Array.isArray(parsedResult?.missing)
      ? [...new Set(parsedResult.missing.filter(item => allowedMissing.includes(item)))]
      : [];

    const response = {
      success: true,
      taskIntent: !!parsedResult?.taskIntent,
      decisionMode: ['clarify', 'proceed', 'chat'].includes(parsedResult?.decisionMode)
        ? parsedResult.decisionMode
        : ((missing.length === 0 && !!parsed.brand && !!parsed.productCategory && !!parsed.eventType && !!parsed.scale && !!parsed.budget) ? 'proceed' : 'clarify'),
      confidence: Number(parsedResult?.confidence || 0),
      parsed,
      assumptions,
      missing,
      ready: missing.length === 0 && !!parsed.brand && !!parsed.productCategory && !!parsed.eventType && !!parsed.scale && !!parsed.budget
    };

    console.log('[AI][parse-task] success', {
      taskIntent: response.taskIntent,
      confidence: response.confidence,
      parsed: {
        brand: response.parsed.brand,
        productCategory: response.parsed.productCategory,
        eventType: response.parsed.eventType,
        scale: response.parsed.scale,
        budget: response.parsed.budget
      },
      missing: response.missing
    });

    res.json(response);
  } catch (err) {
    console.error('[AI][parse-task] failed', { error: err.message, stack: err.stack });
    const meta = classifyAiError(err);
    sendAiError(res, meta.status, meta.code, meta.error);
  }
});

// 搜索增强
router.post('/search', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: '请提供搜索关键词'
      });
    }

    const result = await aiAssistant.searchWithTavily(query);

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 生成PPT大纲
router.post('/generate-outline', async (req, res) => {
  try {
    const { topic, templateType } = req.body;

    if (!topic) {
      return res.status(400).json({
        success: false,
        error: '请提供PPT主题'
      });
    }

    const outline = await aiAssistant.generateOutline(topic, templateType || 'simple');

    res.json({
      success: true,
      data: outline
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 智能填充内容
router.post('/fill-content', async (req, res) => {
  try {
    const { pageType, context } = req.body;

    if (!pageType) {
      return res.status(400).json({
        success: false,
        error: '请提供页面类型'
      });
    }

    const content = await aiAssistant.fillPageContent(pageType, context || {});

    res.json({
      success: true,
      data: content
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 一键生成完整PPT
router.post('/generate-full', async (req, res) => {
  try {
    const { topic, templateType } = req.body;

    if (!topic) {
      return res.status(400).json({
        success: false,
        error: '请提供PPT主题'
      });
    }

    const pptData = await aiAssistant.generateFullPPT(topic, templateType || 'simple');

    res.json({
      success: true,
      data: pptData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/space-context-summary', async (req, res) => {
  try {
    const { spaceId, apiKeys = {} } = req.body || {};
    const memory = platformMemory.getMemoryForPrompt();
    const hasSpace = !!spaceId;
    const context = hasSpace ? workspaceManager.getSpaceContext(spaceId) : {
      space: { id: '', name: '' },
      index: { text: '', indexData: { recentTasks: [] } },
      documents: [],
      combinedText: ''
    };
    const docs = (context.documents || []).filter(doc => doc.systemType !== 'space_index');
    const indexText = String(context.index?.text || '').trim();
    const recentTasks = context.index?.indexData?.recentTasks || [];
    const memorySummary = String(memory.summary || '').trim();
    const compactRecentTasks = recentTasks
      .slice(0, 3)
      .map((item, index) => `${index + 1}. ${compactText(item.title || '未命名任务', 24)}｜${compactText(item.summary || '暂无摘要', 40)}`);
    const compactMemoryPrinciples = compactList(memory.principles || [], 4, 24);
    const compactMemoryPatterns = compactList(memory.patterns || [], 4, 24);
    const compactMemoryPitfalls = compactList(memory.pitfalls || [], 4, 24);
    if (!docs.length && !indexText && !recentTasks.length && !memorySummary) {
      return res.json({
        success: true,
        hasContext: false,
        summary: '',
        userConclusion: '',
        docs: [],
        ignoreReason: '这个空间里还没有形成可参考的索引或文档内容。'
      });
    }

    const systemPrompt = `你是资深活动策略顾问，正在正式策划前快速回顾项目空间里的已有内容，并结合平台长期沉淀的方法论做判断。
- 你会先看到这个空间的 README/索引，再看到平台 memory，最后才是空间里的文档摘要
- 你的第一任务不是“强行提取上下文”，而是判断这些内容到底有没有实际参考价值
- 如果 README 很空、文档明显是测试/示例/占位内容、或者和当前任务没有实质关联，就把 usable 设为 false
- 只有在内容真的能帮助理解项目背景、已有方向、已有资产时，才把它纳入后续策划上下文
- 平台 memory 代表平台长期积累的方法论，它应该帮助你更专业地判断什么信息值得带入，而不是被当成项目事实复述给用户
- 给客户看的结论要自然，不要说得像系统步骤
- 不要输出 markdown、编号、JSON 以外的解释`;

    const userPrompt = `空间名称：${context.space.name || '（当前未选择空间）'}
索引 README：
${hasSpace ? (indexText || '（README 里暂无有效内容）') : '（当前未选择空间）'}

索引中的最近任务：
${hasSpace ? (compactRecentTasks.join('\n') || '（暂无）') : '（当前未选择空间）'}

平台 Memory：
摘要：${compactText(memorySummary, 100) || '（暂无）'}
原则：${compactMemoryPrinciples.join('、') || '（暂无）'}
模式：${compactMemoryPatterns.join('、') || '（暂无）'}
误区：${compactMemoryPitfalls.join('、') || '（暂无）'}

已有文档数：${docs.length}
文档摘要（仅供补充判断）：
${hasSpace ? context.combinedText : '（当前未选择空间）'}

请输出 JSON：
{
  "usable": true,
  "summary": "给系统用的空间上下文摘要，120-180字",
  "keyPoints": ["要点1", "要点2", "要点3"],
  "userConclusion": "给客户看的1-2句自然话术，如果 usable=false，就自然说明空间里暂时没有能直接影响这次判断的有效内容；如果 usable=true，再说明你会带着这些上下文继续推进",
  "ignoreReason": "如果 usable=false，用一句话说明为什么这批内容暂时不值得带入方案",
  "relatedDocs": ["最相关的文档名1", "最相关的文档名2"]
}`;

    const raw = await callMinimax([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], {
      runtimeKey: apiKeys.minimaxApiKey,
      minimaxModel: apiKeys.minimaxModel,
      temperature: 0.35,
      maxTokens: 500
    });

    let parsed;
    try {
      parsed = parseJsonReply(raw);
    } catch {
      parsed = await repairStructuredJson(raw, `{
  "usable": false,
  "summary": "",
  "keyPoints": [],
  "userConclusion": "",
  "ignoreReason": "",
  "relatedDocs": []
}`, apiKeys);
    }

    const usable = !!parsed.usable && (String(parsed.summary || '').trim() || []).length !== 0;
    const relatedDocSet = new Set(Array.isArray(parsed.relatedDocs) ? parsed.relatedDocs : []);
    const relevantDocs = docs.filter(doc => relatedDocSet.size === 0 || relatedDocSet.has(doc.name));

    res.json({
      success: true,
      hasContext: usable,
      summary: usable ? String(parsed.summary || '').trim() : '',
      keyPoints: usable && Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      userConclusion: cleanReply(parsed.userConclusion || ''),
      ignoreReason: String(parsed.ignoreReason || '').trim(),
      memory: {
        summary: memory.summary || '',
        principles: memory.principles || [],
        patterns: memory.patterns || [],
        pitfalls: memory.pitfalls || []
      },
      docs: relevantDocs.slice(0, 6).map(doc => ({
        id: doc.id,
        name: doc.name,
        docType: doc.docType,
        updatedAt: doc.updatedAt
      })),
      relatedDocs: Array.isArray(parsed.relatedDocs) ? parsed.relatedDocs : []
    });
  } catch (err) {
    const meta = classifyAiError(err);
    sendAiError(res, meta.status, meta.code, meta.error);
  }
});

module.exports = router;
