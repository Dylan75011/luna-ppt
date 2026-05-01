// Skill: 生成"活动主体思路与创意方向"提案（3 条差异化方向，正式方案前的用户挑选闸口）
const { callLLMJson } = require('../utils/llmUtils');
const { buildConceptProposalPrompt } = require('../prompts/conceptProposal');

const DIRECTION_LABELS = ['A', 'B', 'C'];

const toStr = (v) => String(v || '').trim();
const toArr = (v) => Array.isArray(v) ? v.map(toStr).filter(Boolean) : [];

function normalizeDirection(raw, fallbackLabel) {
  if (!raw || typeof raw !== 'object') throw new Error('direction must be an object');
  const themeName = toStr(raw.themeName) || toStr(raw.theme) || '待定主题';
  const coreIdea = toStr(raw.coreIdea) || toStr(raw.core_idea);
  const framework = toArr(raw.eventFramework).length ? toArr(raw.eventFramework) : toArr(raw.framework);
  const angles = toArr(raw.creativeAngles).length ? toArr(raw.creativeAngles) : toArr(raw.angles);
  if (!coreIdea || angles.length < 2) {
    throw new Error('direction missing coreIdea or creativeAngles');
  }
  return {
    label: toStr(raw.label) || fallbackLabel,
    codeName: toStr(raw.codeName) || toStr(raw.code_name) || '',
    themeName,
    positioning: toStr(raw.positioning),
    coreIdea,
    eventFramework: framework.slice(0, 4),
    creativeAngles: angles.slice(0, 4),
    toneAndStyle: toStr(raw.toneAndStyle) || toStr(raw.tone),
    upside: toStr(raw.upside),
    risk: toStr(raw.risk),
    bestFor: toStr(raw.bestFor) || toStr(raw.best_for)
  };
}

function normalizeConcept(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('concept proposal must be an object');

  let rawDirections = Array.isArray(raw.directions) ? raw.directions : [];

  // 兼容旧结构：如果模型仍返回单方向（themeName + coreIdea 在顶层），包一层当唯一方向
  if (!rawDirections.length && raw.coreIdea) {
    rawDirections = [raw];
  }

  if (rawDirections.length < 1) {
    throw new Error('concept proposal needs at least 1 direction');
  }

  const directions = rawDirections
    .slice(0, 3)
    .map((d, i) => normalizeDirection(d, DIRECTION_LABELS[i] || String(i + 1)));

  return {
    sharedContext: toStr(raw.sharedContext) || toStr(raw.shared_context),
    differentiationAxis: toStr(raw.differentiationAxis) || toStr(raw.differentiation_axis),
    directions,
    recommendation: toStr(raw.recommendation)
  };
}

function buildFallbackConcept(input) {
  const { userInput = {}, iteration = 1 } = input || {};
  const brand = userInput.brand || '本次活动';
  const goal = userInput.goal || userInput.description || '建立品牌记忆';

  const makeDirection = (label, codeName, themeSuffix, positioning, coreIdea, upside, risk, bestFor, toneExtra) => ({
    label,
    codeName,
    themeName: `${brand}·${themeSuffix}`,
    positioning,
    coreIdea,
    eventFramework: [
      '开场激活：一个强视觉或强互动的开场装置建立第一印象',
      '核心体验：品牌故事主叙事区，分 2-3 个节奏层次展开',
      '互动高潮：关键互动节点承载用户停留与社媒自传播',
      '传播收尾：预留可截图的视觉锚点形成话题收口'
    ],
    creativeAngles: [
      '以一个可识别的主视觉符号贯穿入口、主舞台与传播物料',
      '设置一个关键互动装置承载用户停留与自传播',
      '把品牌故事拆成 3 段叙事节奏避免信息堆砌',
      '为社媒二次传播预留可截图的视觉锚点'
    ],
    toneAndStyle: `${userInput.tone || '克制、有质感'}${toneExtra ? '，' + toneExtra : ''}`,
    upside,
    risk,
    bestFor
  });

  return {
    sharedContext: `核心要解决：围绕"${goal}"让受众在第一时间接住品牌想传达的信息。`,
    differentiationAxis: '稳打安全 / 进攻出圈 / 极致体验密度 —— 三条互相替代的路线',
    directions: [
      makeDirection(
        'A', '稳打', '主线提案',
        '最稳的甲方老板满意路线，风险可控',
        `围绕"${goal}"搭建一条从品牌主张到现场体验的清晰主线，用行业成熟手法确保出稿不翻车。`,
        '方案过审轻松，执行风险低，口碑稳',
        '创新度不足，难冲行业话题',
        '老板风险偏好低、首次合作、时间紧的项目'
      ),
      makeDirection(
        'B', '出圈', '爆点提案',
        '用一个社交媒体钩子冲话题，愿意承担执行风险',
        `把所有资源压在一个可被截图、被二创、被转发的核心装置上，用话题传播代替传统告知。`,
        '有机会冲到行业年度话题，拉高品牌传播量',
        '钩子做不成就会很尴尬，执行精度要求极高',
        '传播预算吃紧但想要爆点、老板愿意承担风险的品牌',
        '锐利、有辨识度'
      ),
      makeDirection(
        'C', '极致', '体验提案',
        '把预算压在现场体验密度，让到场的每一个人记一辈子',
        `放弃广撒网式传播，把资源压到现场——每个环节都让受众被"做到位"，口口相传替代媒介投放。`,
        '现场口碑爆棚、KOL 自然传播，长尾效应强',
        '大众声量不够，传播数据可能不如爆点款',
        '目标受众精准、客户关系重于曝光量的 B 端或高端品牌',
        '沉稳、有深度'
      )
    ],
    recommendation: `当前信息有限，我倾向 A（稳打）作为兜底方向，如果你更看重传播声量，B（出圈）更值得冒险。这是第 ${iteration} 版草案，欢迎给更具体的反馈后迭代。`,
    degraded: true
  };
}

/**
 * @param {{ userInput, researchContext, previousConcept, userFeedback, iteration, onStatus }} input
 * @param {object} apiKeys
 * @returns {Promise<{ sharedContext, differentiationAxis, directions, recommendation, degraded? }>}
 */
async function proposeConcept(input, apiKeys = {}) {
  const iteration = Number(input.iteration) > 0 ? Number(input.iteration) : 1;
  console.log(`[skill:conceptProposal] 生成 3 方向创意骨架（第 ${iteration} 版）...`);
  const { systemPrompt, userPrompt } = buildConceptProposalPrompt({ ...input, iteration });

  const result = await callLLMJson(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    {
      model: 'minimax',
      runtimeKey: apiKeys.minimaxApiKey,
      minimaxModel: apiKeys.minimaxModel,
      // 4000→4500：给"思考溢出"留缓冲。MiniMax 推理模型会先吐 <think> 块，即使
      // prompt 显式禁止仍可能漏出几十到几百 token；4500 token 总额 = 思考缓冲 + 完整
      // 三方向 JSON（每条方向约 800 token，3 条 ~2400）。
      maxTokens: 4500,
      streaming: true,
      streamTotalMs: 45_000,
      streamRetryLimit: 0,
      // retryLimit 0→1：第一次输出可能是纯 <think> 块（被 maxTokens 截断没产 JSON），
      // callLLMJson 检测到 think-only 会用 anti-think 提醒重发——这条提醒只有 retryLimit≥1
      // 才能跑到。失败再走 repair / fallback。
      retryLimit: 1,
      timeoutMs: 20_000,
      // 修 repair 调用经常超时：repair 也是产 4000 token 大 JSON，20s 远不够。给 90s。
      repairTimeoutMs: 90_000,
      name: 'conceptProposal',
      validate: normalizeConcept,
      repairHint: '必须是对象，含 directions (数组 3 条，每条含 label/themeName/coreIdea/eventFramework/creativeAngles/upside/risk/bestFor)、sharedContext、differentiationAxis、recommendation',
      debugLabel: 'conceptProposal',
      onStatus: input.onStatus,
      fallback: ({ error }) => {
        console.warn('[skill:conceptProposal] 启用兜底创意骨架:', error?.message || error);
        return {
          ...buildFallbackConcept({ ...input, iteration }),
          fallbackReason: error?.message || String(error || '')
        };
      }
    }
  );
  const dirCount = (result.directions || []).length;
  console.log(`[skill:conceptProposal] 完成：${dirCount} 条方向`);
  return result;
}

module.exports = { proposeConcept, buildFallbackConcept, normalizeConcept, DIRECTION_LABELS };
