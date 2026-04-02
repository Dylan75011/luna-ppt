// Brain Agent 工具注册表：定义 + 执行器
const { search: webSearch } = require('./webSearch');
const { fetchPage } = require('./webFetch');
const StrategyAgent = require('../agents/strategyAgent');
const CriticAgent = require('../agents/criticAgent');
const PptBuilderAgent = require('../agents/pptBuilderAgent');
const ImageAgent = require('../agents/imageAgent');
const DocWriterAgent = require('../agents/docWriterAgent');
const { generatePPT } = require('./pptGenerator');
const { renderToHtml } = require('./previewRenderer');
const config = require('../config');

// ── OpenAI function calling 工具定义 ────────────────────────────

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'write_todos',
      description: '写入或更新当前任务计划。用于复杂任务，把待办拆成 3-6 个步骤，并持续更新状态。',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '待办内容，简洁具体' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                  description: '待办状态'
                }
              },
              required: ['content', 'status']
            }
          }
        },
        required: ['todos']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_brief',
      description: '更新当前任务简报，把已确认或保守假设的关键信息结构化保存，便于后续策划和展示。',
      parameters: {
        type: 'object',
        properties: {
          brand: { type: 'string' },
          productCategory: { type: 'string' },
          eventType: { type: 'string', enum: ['product_launch', 'auto_show', 'exhibition', 'meeting', 'simple', ''] },
          topic: { type: 'string' },
          goal: { type: 'string' },
          audience: { type: 'string' },
          scale: { type: 'string' },
          budget: { type: 'string' },
          style: { type: 'string' },
          tone: { type: 'string' },
          requirements: { type: 'string' },
          assumptions: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索网页，获取行业动态、竞品案例、创意形式、市场数据等信息',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，中文英文均可' },
          max_results: { type: 'number', description: '最多返回条数，默认5' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: '读取指定网页的完整内容，适合深度了解某篇报道、案例或行业文章',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要读取的网页 URL' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_strategy',
      description: '基于已收集的研究信息，制定完整的活动策划方案。系统会自动进行多轮评审优化，返回最终方案摘要。',
      parameters: {
        type: 'object',
        properties: {
          brand: { type: 'string', description: '品牌或项目名称' },
          event_description: { type: 'string', description: '活动描述（类型、规模、主题等）' },
          goal: { type: 'string', description: '活动核心目标' },
          audience: { type: 'string', description: '目标受众' },
          budget: { type: 'string', description: '预算（如"500万"）' },
          tone: { type: 'string', description: '风格调性（如"科技感、高端、年轻"）' },
          requirements: { type: 'string', description: '特殊要求或限制条件' },
          research_context: { type: 'string', description: '本次已搜索到的所有行业信息、竞品案例和创意参考的摘要' }
        },
        required: ['brand', 'event_description', 'goal', 'research_context']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'build_ppt',
      description: '根据已制定的策划方案生成 PPT 文件，包含自动配图搜索。只在用户明确同意生成 PPT 后调用。',
      parameters: {
        type: 'object',
        properties: {
          note: { type: 'string', description: '给 PPT 生成的额外说明或调整要求（可选）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: '向用户提问，获取缺失的关键信息。只在信息确实不足以继续工作时调用，不要过度提问。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '向用户提出的问题，要简洁明确' },
          type: {
            type: 'string',
            enum: ['missing_info', 'ambiguous', 'confirmation', 'suggestion'],
            description: 'missing_info=缺少必要信息，ambiguous=需求模糊，confirmation=需要用户确认，suggestion=建议用户考虑'
          }
        },
        required: ['question', 'type']
      }
    }
  }
];

// ── 工具执行器 ────────────────────────────────────────────────────

function injectKeys(agent, apiKeys) {
  agent.apiKeys = apiKeys || {};
  return agent;
}

/**
 * 执行具体工具
 * @param {string} toolName
 * @param {object} args
 * @param {object} session  - agentSession 对象
 * @param {Function} onEvent - (eventType, data) 推送 SSE 事件
 */
async function executeTool(toolName, args, session, onEvent) {
  switch (toolName) {
    case 'write_todos':
      return execWriteTodos(args, session, onEvent);
    case 'update_brief':
      return execUpdateBrief(args, session, onEvent);
    case 'web_search':
      return execWebSearch(args, session, onEvent);
    case 'web_fetch':
      return execWebFetch(args, session, onEvent);
    case 'run_strategy':
      return execRunStrategy(args, session, onEvent);
    case 'build_ppt':
      return execBuildPpt(args, session, onEvent);
    default:
      throw new Error(`未知工具：${toolName}`);
  }
}

async function execWriteTodos(args, session, onEvent) {
  const todos = Array.isArray(args.todos)
    ? args.todos
      .map((item) => ({
        content: String(item?.content || '').trim(),
        status: ['pending', 'in_progress', 'completed'].includes(item?.status) ? item.status : 'pending'
      }))
      .filter((item) => item.content)
      .slice(0, 8)
    : [];

  session.planItems = todos;
  onEvent('plan_update', { items: todos });

  return {
    success: true,
    count: todos.length
  };
}

async function execUpdateBrief(args, session, onEvent) {
  const previous = session.brief || {};
  const nextBrief = {
    brand: pickValue(args.brand, previous.brand),
    productCategory: pickValue(args.productCategory, previous.productCategory),
    eventType: pickValue(args.eventType, previous.eventType),
    topic: pickValue(args.topic, previous.topic),
    goal: pickValue(args.goal, previous.goal),
    audience: pickValue(args.audience, previous.audience),
    scale: pickValue(args.scale, previous.scale),
    budget: pickValue(args.budget, previous.budget),
    style: pickValue(args.style, previous.style),
    tone: pickValue(args.tone, previous.tone),
    requirements: pickValue(args.requirements, previous.requirements),
    assumptions: Array.isArray(args.assumptions)
      ? args.assumptions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5)
      : (previous.assumptions || [])
  };

  session.brief = nextBrief;
  onEvent('brief_update', { brief: nextBrief });
  onEvent('artifact', {
    artifactType: 'task_brief',
    payload: {
      brand: nextBrief.brand,
      topic: nextBrief.topic,
      parsedGoal: nextBrief.goal || nextBrief.requirements || '',
      keyThemes: [nextBrief.eventType, nextBrief.scale, nextBrief.budget].filter(Boolean),
      assumptions: nextBrief.assumptions || []
    }
  });

  return {
    success: true,
    brief: nextBrief
  };
}

async function execWebSearch(args, session, onEvent) {
  const searchResult = await webSearch(args.query, {
    tavilyApiKey: session.apiKeys.tavilyApiKey,
    maxResults: args.max_results || 8
  });

  if (!searchResult.results.length) {
    if (searchResult.warning) {
      onEvent('tool_progress', { message: searchResult.warning });
    }
    return { found: false, results: [], warning: searchResult.warning };
  }

  const results = searchResult.results;
  const summary = results.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.snippet}`
  ).join('\n\n');

  onEvent('tool_progress', { message: `找到 ${results.length} 条结果（${searchResult.source}）` });
  onEvent('artifact', {
    artifactType: 'research_result',
    payload: {
      focus: args.query,
      summary: results.slice(0, 3).map(r => r.title).join('；'),
      keyFindings: results.slice(0, 3).map(r => r.snippet).filter(Boolean)
    }
  });

  return {
    found: true,
    count: results.length,
    summary,
    results: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
    source: searchResult.source
  };
}

async function execWebFetch(args, session, onEvent) {
  const content = await fetchPage(args.url, {
    jinaApiKey: session.apiKeys.jinaApiKey,
    timeoutMs: 12000,
    maxLength: 3000
  });

  if (!content) return { success: false, content: '' };

  onEvent('tool_progress', { message: '页面内容已读取' });
  return { success: true, content };
}

async function execRunStrategy(args, session, onEvent) {
  // 构建结构化 userInput
  const userInput = {
    brand: args.brand || '（未指定）',
    description: args.event_description || args.goal || '',
    goal: args.goal || '',
    audience: args.audience || '目标受众',
    budget: args.budget || '',
    tone: args.tone || '',
    requirements: args.requirements || '',
    brandColor: '1A1A1A',
    timeline: '',
    spaceId: session.spaceId || ''
  };

  // 构建 orchestratorOutput（简化版，供 StrategyAgent 使用）
  const orchestratorOutput = {
    parsedGoal: args.goal || args.event_description,
    keyThemes: [],
    searchTasks: [],
    pptStructureHint: ''
  };

  // 构建 researchResults（把 research_context 包装成标准格式）
  const researchResults = [{
    taskId: 'brain-research',
    focus: '综合研究',
    summary: args.research_context || '（暂无搜索数据）',
    keyFindings: [],
    inspirations: []
  }];

  session.userInput = userInput;
  session.brief = {
    ...(session.brief || {}),
    brand: userInput.brand,
    productCategory: session.brief?.productCategory || '',
    eventType: session.brief?.eventType || '',
    topic: session.brief?.topic || '',
    goal: userInput.goal,
    audience: userInput.audience,
    scale: session.brief?.scale || '',
    budget: userInput.budget,
    style: session.brief?.style || '',
    tone: userInput.tone,
    requirements: userInput.requirements,
    assumptions: session.brief?.assumptions || []
  };
  onEvent('brief_update', { brief: session.brief });

  const strategyAgent = injectKeys(new StrategyAgent(), session.apiKeys);
  const criticAgent   = injectKeys(new CriticAgent(), session.apiKeys);
  const docWriterAgent = injectKeys(new DocWriterAgent(), session.apiKeys);

  const maxRounds = config.criticMaxRounds;
  let bestPlan = null;
  let bestScore = 0;
  let previousFeedback = null;

  for (let round = 1; round <= maxRounds; round++) {
    onEvent('tool_progress', { message: `第 ${round} 轮：制定策划方案...` });

    const plan = await strategyAgent.run({
      orchestratorOutput,
      researchResults,
      round,
      previousFeedback,
      userInput
    });

    onEvent('tool_progress', { message: `第 ${round} 轮：专家评审中（DeepSeek-R1）...` });

    const review = await criticAgent.run({ plan, round, userInput });

    onEvent('tool_progress', {
      message: `第 ${round} 轮评审完成，得分 ${review.score}${review.passed ? ' ✓' : ' — 继续优化'}`
    });

    if (review.score > bestScore) {
      bestScore = review.score;
      bestPlan = plan;
    }

    if (review.passed) break;
    previousFeedback = review;
  }

  // 存入 session 供 build_ppt 使用
  session.bestPlan = bestPlan;
  session.bestScore = bestScore;

  onEvent('tool_progress', { message: '正在整理策划文档...' });
  const { markdown, html } = await docWriterAgent.run({
    plan: bestPlan,
    userInput,
    reviewFeedback: previousFeedback
  });
  session.docMarkdown = markdown;
  session.docHtml = html;
  onEvent('doc_ready', {
    docHtml: html,
    title: bestPlan?.planTitle || userInput.topic || `${userInput.brand} 策划方案`,
    score: bestScore
  });

  // 推送策划方案 artifact 供右侧预览
  onEvent('artifact', {
    artifactType: 'plan_draft',
    payload: {
      round: maxRounds,
      planTitle: bestPlan?.planTitle || '',
      coreStrategy: bestPlan?.coreStrategy || '',
      highlights: bestPlan?.highlights || [],
      sections: (bestPlan?.sections || []).map(s => ({
        title: s.title,
        keyPoints: s.keyPoints || []
      }))
    }
  });

  // 返回摘要给 brain（不返回完整 plan，节省 token）
  return {
    success: true,
    score: bestScore,
    planTitle: bestPlan?.planTitle || '',
    coreStrategy: bestPlan?.coreStrategy || '',
    highlights: (bestPlan?.highlights || []).slice(0, 3),
    sectionCount: (bestPlan?.sections || []).length,
    visualTheme: bestPlan?.visualTheme?.style || '',
    hasDocument: !!html
  };
}

async function execBuildPpt(args, session, onEvent) {
  const { bestPlan, userInput, apiKeys } = session;

  if (!bestPlan) {
    return { success: false, error: '还没有策划方案，请先调用 run_strategy' };
  }

  const pptBuilderAgent = injectKeys(new PptBuilderAgent(), apiKeys);
  const imageAgent      = injectKeys(new ImageAgent(), apiKeys);

  const imageMap = {};

  try {
    onEvent('tool_progress', { message: '正在生成 PPT 大纲...' });

    const pptData = await pptBuilderAgent.run({
      plan: bestPlan,
      userInput,
      docContent: args.note || session.docHtml || '',
      imageMap,
      onOutlineReady: async (outline, total) => {
        onEvent('tool_progress', { message: '正在结合策划内容与页面结构匹配背景图...' });
        const imageCandidates = await imageAgent.run({ plan: bestPlan, userInput, pptOutline: outline })
          .catch(err => {
            console.warn('[build_ppt] 配图搜索失败:', err.message);
            return {};
          });
        for (const category of ['cover', 'content', 'end']) {
          const list = imageCandidates?.[category];
          if (list && list.length > 0 && list[0].localPath) {
            imageMap[category] = list[0].localPath;
          }
        }
        imageMap.pages = Object.fromEntries(
          (imageCandidates?.pages || [])
            .filter(item => item?.localPath && Number.isInteger(item.pageIndex))
            .map(item => [item.pageIndex, item])
        );
        onEvent('artifact', {
          artifactType: 'ppt_outline',
          payload: { title: outline.title, total, pages: outline.pages || [] }
        });
      },
      onPageReady: (page, index, total, theme) => {
        const html = renderToHtml({ pages: [page], theme })[0];
        onEvent('slide_added', { html, index, total });
      }
    });

    const filename = `ppt_${Date.now()}.pptx`;
    await generatePPT(pptData, filename);
    const downloadUrl = `/api/files/download/${filename}`;
    const previewSlides = renderToHtml(pptData);

    onEvent('done', { filename, downloadUrl, previewSlides, previewData: pptData });

    return { success: true, downloadUrl, pageCount: pptData?.pages?.length || 0 };
  } catch (err) {
    throw new Error(`PPT 生成失败：${err.message}`);
  }
}

// ── 工具展示名称 ──────────────────────────────────────────────────

function getToolDisplay(toolName, args) {
  switch (toolName) {
    case 'write_todos': return `更新计划（${Array.isArray(args.todos) ? args.todos.length : 0} 项）`;
    case 'update_brief': return '整理任务简报';
    case 'web_search': return `搜索：${args.query || ''}`;
    case 'web_fetch':  return `读取页面：${(args.url || '').replace(/https?:\/\//, '').slice(0, 50)}`;
    case 'run_strategy': return `制定策划方案：${args.brand || ''}`;
    case 'build_ppt':  return args.note ? `生成 PPT（${args.note}）` : '生成 PPT';
    default: return toolName;
  }
}

function pickValue(nextValue, fallback = '') {
  const text = String(nextValue || '').trim();
  return text || fallback || '';
}

module.exports = { TOOL_DEFINITIONS, executeTool, getToolDisplay };
