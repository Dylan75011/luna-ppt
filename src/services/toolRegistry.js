// Brain Agent 工具注册表：定义 + 执行器
const { search: webSearch } = require('./webSearch');
const { fetchPage } = require('./webFetch');
const { analyzeAgentImages } = require('./visionMcp');
const PptBuilderAgent = require('../agents/pptBuilderAgent');
const ImageAgent = require('../agents/imageAgent');
const EventVisualDesignerAgent = require('../agents/eventVisualDesignerAgent');
const { strategize, critique, writeDoc } = require('../skills');
const { generatePPT } = require('./pptGenerator');
const { renderToHtml } = require('./previewRenderer');
const config = require('../config');
const wm = require('./workspaceManager');
const { htmlToTiptap, markdownToTiptap } = require('./richText');
const { toOutputUrl } = require('./outputPaths');

function createEmptyTiptapDoc() {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

function cloneDocNode(node) {
  return JSON.parse(JSON.stringify(node));
}

function buildDocStreamSnapshots(tiptapDoc, fallbackTitle = '策划方案') {
  const blocks = Array.isArray(tiptapDoc?.content) ? tiptapDoc.content : [];
  if (!blocks.length) {
    return [{ title: fallbackTitle, content: createEmptyTiptapDoc(), progress: 100 }];
  }

  const titleBlock = blocks.find(block => block?.type === 'heading' && Number(block?.attrs?.level) === 1);
  const extractText = (node) => {
    if (!node) return '';
    if (typeof node.text === 'string') return node.text;
    if (Array.isArray(node.content)) return node.content.map(extractText).join('');
    return '';
  };
  const resolvedTitle = extractText(titleBlock) || fallbackTitle;
  const snapshots = [];
  const progressiveBlocks = [];
  const totalBlocks = blocks.length;

  for (let i = 0; i < totalBlocks; i += 1) {
    progressiveBlocks.push(cloneDocNode(blocks[i]));
    const block = blocks[i];
    const isSectionBoundary = i === totalBlocks - 1
      || (block?.type === 'heading' && Number(block?.attrs?.level) === 2)
      || ((blocks[i + 1]?.type === 'heading') && Number(blocks[i + 1]?.attrs?.level) === 2);
    if (!isSectionBoundary) continue;
    snapshots.push({
      title: resolvedTitle,
      sectionTitle: block?.type === 'heading' ? extractText(block) : '',
      progress: Math.round(((i + 1) / totalBlocks) * 100),
      content: {
        type: 'doc',
        content: progressiveBlocks.map(cloneDocNode)
      }
    });
  }

  if (!snapshots.length) {
    snapshots.push({
      title: resolvedTitle,
      progress: 100,
      content: { type: 'doc', content: blocks.map(cloneDocNode) }
    });
  }

  return snapshots;
}

function buildPlanDraftMarkdown(plan = {}, userInput = {}) {
  const title = plan.planTitle || userInput.topic || `${userInput.brand || ''}策划方案`;
  const lines = [`# ${title}`];

  if (plan.coreStrategy) {
    lines.push('', '## 核心判断', '', plan.coreStrategy);
  }

  if (Array.isArray(plan.highlights) && plan.highlights.length) {
    lines.push('', '## 方案亮点', '', ...plan.highlights.map(item => `- ${item}`));
  }

  if (Array.isArray(plan.sections) && plan.sections.length) {
    plan.sections.forEach((section) => {
      lines.push('', `## ${section.title || '方案章节'}`);
      if (section.narrative) lines.push('', section.narrative);
      if (Array.isArray(section.keyPoints) && section.keyPoints.length) {
        lines.push('', ...section.keyPoints.map(item => `- ${item}`));
      }
    });
  }

  if (Array.isArray(plan.timeline?.phases) && plan.timeline.phases.length) {
    lines.push('', '## 执行节奏', '', ...plan.timeline.phases.map(phase => `- ${phase.phase || '阶段'}：${phase.milestone || phase.duration || ''}`));
  }

  if (Array.isArray(plan.kpis) && plan.kpis.length) {
    lines.push('', '## KPI 目标', '', ...plan.kpis.map(item => `- ${item.metric || '指标'}：${item.target || ''}`));
  }

  if (plan?.visualExecutionHints?.sceneTone) {
    lines.push('', '## 现场效果设计建议', '', `整体现场气质：${plan.visualExecutionHints.sceneTone}`);
  }

  if (Array.isArray(plan?.visualExecutionHints?.mustRenderScenes) && plan.visualExecutionHints.mustRenderScenes.length) {
    lines.push('', '### 建议提前出效果图的重点场景', '', ...plan.visualExecutionHints.mustRenderScenes.map(item => `- ${item}`));
  }

  if (Array.isArray(plan?.visualExecutionHints?.onsiteDesignSuggestions) && plan.visualExecutionHints.onsiteDesignSuggestions.length) {
    lines.push('', '### 分场景设计建议');
    plan.visualExecutionHints.onsiteDesignSuggestions.forEach((item) => {
      lines.push('', `#### ${item.scene || '重点场景'}`);
      if (item.goal) lines.push('', `目标：${item.goal}`);
      if (item.designSuggestion) lines.push('', item.designSuggestion);
      if (Array.isArray(item.visualFocus) && item.visualFocus.length) {
        lines.push('', ...item.visualFocus.map(point => `- ${point}`));
      }
    });
  }

  return lines.join('\n').trim();
}

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
      name: 'review_uploaded_images',
      description: '重新查看本次对话里用户上传过的图片，并按当前问题提取关键信息、风格线索或识别图中内容。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '这次希望重点看什么，比如“识别品牌和产品”、“总结视觉风格”、“看海报里的关键信息”' },
          image_ids: {
            type: 'array',
            description: '可选。指定要查看的图片 ID；不传则默认查看最近上传的全部图片',
            items: { type: 'string' }
          }
        },
        required: ['prompt']
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
          research_context: { type: 'string', description: '对本次搜索内容的补充摘要（可选）。系统会自动整合所有 web_search 的原始结果，无需重复罗列，只需写搜索中未体现的额外判断或背景即可' }
        },
        required: ['brand', 'event_description', 'goal']
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
      name: 'read_workspace_doc',
      description: '读取当前工作空间中某份文档的完整内容。适合继承历史策划方案、参考过去案例、了解品牌背景信息。文档 ID 可从系统提示词的文档列表中获取。',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: '文档 ID，格式如 doc_abc123' },
          focus: { type: 'string', description: '可选：本次读取重点关注的方向，例如"品牌调性"、"活动亮点"、"预算规模"' }
        },
        required: ['doc_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_to_workspace',
      description: '把当前生成的内容（策划文档、分析报告、创意提案等）保存为工作空间中的一份新文档。PPT 会在生成后自动保存，无需手动调用。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '文档标题' },
          content: { type: 'string', description: '文档内容（markdown 格式）' }
        },
        required: ['title', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_workspace_doc',
      description: '更新工作空间中已有文档的内容。适合在已有策划文档基础上追加新内容、修改方向或补充细节，而不是创建新文档。',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: '要更新的文档 ID' },
          content: { type: 'string', description: '新的完整文档内容（会完全替换原内容）' },
          title: { type: 'string', description: '可选：同时修改文档标题' }
        },
        required: ['doc_id', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: '暂停当前任务，向用户提出一个问题并等待回答。只在以下情况使用：(1) 缺少品牌/项目名称这类无法假设的信息；(2) 用户需要在两个截然不同的方向中做选择；(3) 需要用户确认策划文档才能进入下一步。禁止在可以合理假设的情况下使用（如受众、预算、风格等）。每次只问一个问题，用自然口语而非表单语气。',
      parameters: {
        type: 'object',
        properties: {
          header: {
            type: 'string',
            description: '可选。给这次提问一个很短的标题，适合显示在输入框上方的选择面板里，例如“确认品牌”“选择方向”“下一步”。'
          },
          question: {
            type: 'string',
            description: '要问的问题，用自然对话语气。如果你有合理猜测，可先说出猜测再让用户确认，比"直接提问"更自然。'
          },
          type: {
            type: 'string',
            enum: ['missing_info', 'ambiguous', 'confirmation', 'suggestion'],
            description: 'missing_info=缺少无法假设的核心信息；ambiguous=两个方向都合理，需用户选择；confirmation=需要用户明确同意才能执行高代价操作；suggestion=提供选项让用户选择偏好'
          },
          options: {
            type: 'array',
            description: '可选。给用户提供 2-4 个可直接选择的回复项。不要包含“其他”，用户始终可以直接输入自己的话。',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: '用户看到的选项标题，1-12 个字为宜' },
                value: { type: 'string', description: '用户点击后实际回传给模型的回复文本' },
                description: { type: 'string', description: '可选。用于解释这个选项意味着什么或会如何继续。' }
              },
              required: ['label', 'value']
            }
          }
        },
        required: ['question', 'type']
      }
    }
  }
];

// ── 工具执行器 ────────────────────────────────────────────────────

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
    case 'review_uploaded_images':
      return execReviewUploadedImages(args, session, onEvent);
    case 'web_search':
      return execWebSearch(args, session, onEvent);
    case 'web_fetch':
      return execWebFetch(args, session, onEvent);
    case 'run_strategy':
      return execRunStrategy(args, session, onEvent);
    case 'build_ppt':
      return execBuildPpt(args, session, onEvent);
    case 'read_workspace_doc':
      return execReadWorkspaceDoc(args, session, onEvent);
    case 'save_to_workspace':
      return execSaveToWorkspace(args, session, onEvent);
    case 'update_workspace_doc':
      return execUpdateWorkspaceDoc(args, session, onEvent);
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

async function execReviewUploadedImages(args, session, onEvent) {
  const allAttachments = Array.isArray(session.attachments) ? session.attachments : [];
  if (!allAttachments.length) {
    return {
      success: false,
      error: '当前会话还没有可供查看的用户图片'
    };
  }

  const requestedIds = Array.isArray(args.image_ids)
    ? args.image_ids.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const selectedAttachments = requestedIds.length
    ? allAttachments.filter((item) => requestedIds.includes(item.id))
    : allAttachments.slice(-4);

  if (!selectedAttachments.length) {
    return {
      success: false,
      error: '没有匹配到指定的图片 ID'
    };
  }

  onEvent('tool_progress', { message: `正在重新查看 ${selectedAttachments.length} 张图片...` });
  const analyses = await analyzeAgentImages(selectedAttachments, {
    minimaxApiKey: session.apiKeys.minimaxApiKey,
    userText: String(args.prompt || '').trim()
  });

  const summary = analyses.map((item, index) => {
    if (item.analysis) {
      return `[图片${index + 1}] ${item.name}\n${item.analysis}`;
    }
    return `[图片${index + 1}] ${item.name}\n分析失败：${item.error || '未知错误'}`;
  }).join('\n\n');

  return {
    success: true,
    count: analyses.length,
    summary,
    images: analyses.map((item) => ({
      id: item.id,
      name: item.name,
      url: item.url,
      analysis: item.analysis || '',
      error: item.error || ''
    }))
  };
}

async function execWebSearch(args, session, onEvent) {
  const searchResult = await webSearch(args.query, {
    minimaxApiKey: session.apiKeys.minimaxApiKey,
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

  // 累积到 researchStore，供 run_strategy 强制引用，不依赖 Brain 的记忆
  if (!Array.isArray(session.researchStore)) session.researchStore = [];
  session.researchStore.push({
    query: args.query,
    timestamp: Date.now(),
    results: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
    source: searchResult.source
  });

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

  // 从 researchStore 重建完整搜索记录（保证所有搜索都被纳入，不依赖 Brain 的记忆）
  const RESEARCH_CONTEXT_MAX_CHARS = 8000;
  const store = Array.isArray(session.researchStore) ? session.researchStore : [];
  let storedContext = '';
  if (store.length > 0) {
    // 从最新的搜索往前累积，超出上限时截止（保留最近的搜索）
    const parts = [];
    let totalChars = 0;
    for (let i = store.length - 1; i >= 0; i--) {
      const entry = store[i];
      const block = `【搜索${i + 1}】${entry.query}\n` +
        entry.results.map((r, j) => `  [${j + 1}] ${r.title}\n  ${r.snippet}`).join('\n');
      if (totalChars + block.length > RESEARCH_CONTEXT_MAX_CHARS) break;
      parts.unshift(block);
      totalChars += block.length;
    }
    storedContext = parts.join('\n\n');
  }

  // Brain 传来的 research_context 作为补充摘要，与 storedContext 合并
  const finalResearchContext = [storedContext, args.research_context]
    .filter(s => s && s.trim() && s.trim() !== '（暂无搜索数据）')
    .join('\n\n---\n\n') || '（暂无搜索数据）';

  // 构建 researchResults（把完整 context 包装成标准格式）
  const researchResults = [{
    taskId: 'brain-research',
    focus: '综合研究',
    summary: finalResearchContext,
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

  const maxRounds = config.criticMaxRounds;
  let bestPlan = null;
  let bestScore = 0;
  let previousFeedback = null;

  for (let round = 1; round <= maxRounds; round++) {
    onEvent('tool_progress', { message: `第 ${round} 轮：制定策划方案...` });

    const plan = await strategize({ orchestratorOutput, researchResults, round, previousFeedback, userInput }, session.apiKeys);

    onEvent('tool_progress', { message: `第 ${round} 轮：专家评审中（DeepSeek-R1）...` });

    const review = await critique({ plan, round, userInput }, session.apiKeys);

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
  onEvent('artifact', {
    artifactType: 'plan_draft',
    payload: {
      round: maxRounds,
      planTitle: bestPlan?.planTitle || '',
      coreStrategy: bestPlan?.coreStrategy || '',
      highlights: bestPlan?.highlights || [],
      visualExecutionHints: bestPlan?.visualExecutionHints || {},
      sections: (bestPlan?.sections || []).map(s => ({
        title: s.title,
        keyPoints: s.keyPoints || []
      }))
    }
  });

  const provisionalDoc = markdownToTiptap(buildPlanDraftMarkdown(bestPlan, userInput));
  const provisionalSnapshots = buildDocStreamSnapshots(
    provisionalDoc,
    bestPlan?.planTitle || userInput.topic || `${userInput.brand} 策划方案`
  );
  provisionalSnapshots.forEach((snapshot, index) => {
    onEvent('doc_section_added', {
      title: snapshot.title,
      sectionTitle: snapshot.sectionTitle || '',
      progress: Math.max(8, Math.round(snapshot.progress * 0.55)),
      index,
      total: provisionalSnapshots.length,
      docContent: snapshot.content,
      provisional: true
    });
  });

  const { markdown, html } = await writeDoc({ plan: bestPlan, userInput, reviewFeedback: previousFeedback }, session.apiKeys);
  const tiptapDoc = htmlToTiptap(html);
  session.docMarkdown = markdown;
  session.docHtml = html;
  session.docJson = tiptapDoc;
  const docSnapshots = buildDocStreamSnapshots(
    tiptapDoc,
    bestPlan?.planTitle || userInput.topic || `${userInput.brand} 策划方案`
  );
  docSnapshots.forEach((snapshot, index) => {
    onEvent('doc_section_added', {
      title: snapshot.title,
      sectionTitle: snapshot.sectionTitle || '',
      progress: Math.min(98, 55 + Math.round(snapshot.progress * 0.43)),
      index,
      total: docSnapshots.length,
      docContent: snapshot.content,
      provisional: false
    });
  });
  onEvent('doc_ready', {
    docHtml: html,
    docContent: tiptapDoc,
    title: bestPlan?.planTitle || userInput.topic || `${userInput.brand} 策划方案`,
    score: bestScore
  });

  // 自动保存策划文档到工作空间（放在任务文件夹中）
  if (session.spaceId && html) {
    try {
      const planTitle = bestPlan?.planTitle || `${userInput.brand || ''}策划方案`;
      // 生成任务文件夹名：取活动标题前20字符，去掉特殊符号
      const rawFolderName = (bestPlan?.planTitle || userInput.topic || userInput.brand || '策划任务')
        .replace(/[\/\\:*?"<>|]/g, '').slice(0, 20).trim();
      const folder = wm.ensureTaskFolder(session.spaceId, rawFolderName);
      session.taskFolderId = folder.id;   // 供 build_ppt 复用
      const node = wm.createNode({ parentId: folder.id, name: '策划方案', type: 'document', docType: 'document' });
      wm.saveContent(node.id, tiptapDoc, 'tiptap-json');
      try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}
      onEvent('workspace_updated', { spaceId: session.spaceId, folderId: folder.id, folderName: rawFolderName, docId: node.id, docName: '策划方案', docType: 'document' });
    } catch (e) {
      console.warn('[run_strategy] 自动保存策划文档失败:', e.message);
    }
  }

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

  const pptBuilderAgent = new PptBuilderAgent(apiKeys);
  const imageAgent      = new ImageAgent(apiKeys);
  const visualDesignerAgent = new EventVisualDesignerAgent(apiKeys);

  const imageMap = {};
  let imageCandidates = {};

  try {
    onEvent('tool_progress', { message: '正在生成 PPT 大纲...' });

    const pptData = await pptBuilderAgent.run({
      plan: bestPlan,
      userInput,
      docContent: args.note || session.docHtml || '',
      imageMap,
      onOutlineReady: async (outline, total) => {
        onEvent('tool_progress', { message: '正在根据方案设计活动现场效果图建议...' });
        const visualPlan = await visualDesignerAgent.run({
          plan: bestPlan,
          pptOutline: outline,
          userInput,
          attachments: Array.isArray(session?.attachments) ? session.attachments : []
        }).catch(err => {
          console.warn('[build_ppt] 活动图设计失败:', err.message);
          return null;
        });

        if (visualPlan?.pages?.length) {
          outline.pages = (outline.pages || []).map((page, index) => ({
            ...page,
            visualAssetPlan: visualPlan.pages.find(item => item.pageIndex === index) || page.visualAssetPlan || null
          }));
        }

        onEvent('tool_progress', { message: '正在结合策划内容与页面结构匹配背景图...' });
        imageCandidates = await imageAgent.run({ plan: bestPlan, userInput, pptOutline: outline, visualPlan })
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
    const result = await generatePPT(pptData, filename, { runId: session.spaceId || `tool_${Date.now()}` });
    const downloadUrl = result.path;
    const previewSlides = renderToHtml(pptData);

    // 自动保存 PPT 到工作空间（优先放在与策划方案相同的任务文件夹）
    if (session.spaceId) {
      try {
        const brand = session.brief?.brand || session.userInput?.brand || 'PPT';
        const pptName = `${brand} PPT.pptx`;
        const targetParent = session.taskFolderId || session.spaceId;
        const savedNode = wm.savePptToSpace({
          spaceId: session.spaceId,
          parentId: targetParent,
          name: pptName,
          pptData,
          downloadUrl,
          previewSlides
        });

        const seenImagePaths = new Set();
        const candidateImages = [
          ...(Array.isArray(imageCandidates?.pages) ? imageCandidates.pages : []),
          ...(['cover', 'content', 'end']
            .flatMap((category) => Array.isArray(imageCandidates?.[category]) ? imageCandidates[category].slice(0, 1) : []))
        ];

        candidateImages.forEach((item, index) => {
          const localPath = String(item?.localPath || '').trim();
          if (!localPath || seenImagePaths.has(localPath)) return;
          seenImagePaths.add(localPath);
          const pageNo = Number.isInteger(item?.pageIndex) ? item.pageIndex + 1 : null;
          const baseLabel = item?.pageTitle || item?.role || item?.originQuery || `配图 ${index + 1}`;
          const imageName = pageNo
            ? `${brand} 配图 ${String(pageNo).padStart(2, '0')}.jpg`
            : `${brand} ${String(baseLabel).slice(0, 24) || `配图 ${index + 1}`}.jpg`;
          wm.saveAssetToSpace({
            spaceId: session.spaceId,
            parentId: targetParent,
            name: imageName,
            docType: 'image',
            filePath: localPath,
            previewUrl: toOutputUrl(localPath),
            meta: {
              sourcePageTitle: item?.pageTitle || '',
              role: item?.role || '',
              caption: item?.originQuery || item?.query || '',
              pageIndex: Number.isInteger(item?.pageIndex) ? item.pageIndex : null,
              sceneType: item?.sceneType || '',
              assetType: item?.assetType || '',
              insertMode: item?.insertMode || ''
            }
          });
        });

        try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}
        onEvent('workspace_updated', { spaceId: session.spaceId, folderId: session.taskFolderId || null, docId: savedNode.id, docName: pptName, docType: 'ppt' });
      } catch (e) {
        console.warn('[build_ppt] 自动保存 PPT 失败:', e.message);
      }
    }

    onEvent('done', { filename: result.filename, downloadUrl, previewSlides, previewData: pptData });

    return { success: true, downloadUrl, pageCount: pptData?.pages?.length || 0 };
  } catch (err) {
    throw new Error(`PPT 生成失败：${err.message}`);
  }
}

async function execReadWorkspaceDoc(args, session, onEvent) {
  const docId = String(args.doc_id || '').trim();
  if (!docId) return { success: false, error: '请指定 doc_id' };

  try {
    const data = wm.getContent(docId);
    const rawContent = data.content;

    // 提取纯文本（兼容 tiptap-json / legacy-html / markdown）
    let text = '';
    if (typeof rawContent === 'string') {
      text = rawContent
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    } else if (rawContent && typeof rawContent === 'object') {
      const extract = (node) => {
        if (!node) return '';
        if (typeof node.text === 'string') return node.text;
        if (Array.isArray(node.content)) return node.content.map(extract).join(' ');
        return '';
      };
      text = extract(rawContent).replace(/\s+/g, ' ').trim();
    }

    const MAX_CHARS = 8000;
    const truncated = text.length > MAX_CHARS;
    const displayText = truncated ? text.slice(0, MAX_CHARS) + '\n...[内容较长，已截断至前段]' : text;

    onEvent('tool_progress', { message: `已读取文档：${data.name || docId}` });

    return {
      success: true,
      doc_id: docId,
      name: data.name || '',
      docType: data.docType || 'document',
      updatedAt: data.updatedAt || '',
      focus: args.focus || '',
      content: displayText || '（文档内容为空）'
    };
  } catch (e) {
    return { success: false, error: `读取失败：${e.message}` };
  }
}

async function execUpdateWorkspaceDoc(args, session, onEvent) {
  const docId = String(args.doc_id || '').trim();
  const content = String(args.content || '').trim();
  if (!docId) return { success: false, error: '请指定 doc_id' };
  if (!content) return { success: false, error: '内容不能为空' };

  try {
    // 检查文档存在且属于当前空间
    const data = wm.getContent(docId);
    wm.saveContent(docId, markdownToTiptap(content), 'tiptap-json');

    // 如果需要重命名
    if (args.title && String(args.title).trim() && String(args.title).trim() !== data.name) {
      wm.renameNode(docId, String(args.title).trim());
    }

    // 刷新空间上下文
    try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}

    const displayName = args.title || data.name || docId;
    onEvent('tool_progress', { message: `已更新文档：${displayName}` });
    onEvent('workspace_updated', { spaceId: session.spaceId, docId, docName: displayName, docType: 'document', action: 'update' });

    return { success: true, doc_id: docId, name: displayName };
  } catch (e) {
    return { success: false, error: `更新失败：${e.message}` };
  }
}

async function execSaveToWorkspace(args, session, onEvent) {
  if (!session.spaceId) return { success: false, error: '当前没有选中工作空间，无法保存' };

  const title = String(args.title || '').trim() || `AI生成文档_${new Date().toLocaleDateString('zh-CN')}`;
  const content = String(args.content || '').trim();
  if (!content) return { success: false, error: '内容不能为空' };

  try {
    const node = wm.createNode({ parentId: session.spaceId, name: title, type: 'document', docType: 'document' });
    wm.saveContent(node.id, markdownToTiptap(content), 'tiptap-json');
    // 刷新空间上下文
    try { session.spaceContext = wm.getSpaceContext(session.spaceId); } catch {}
    onEvent('tool_progress', { message: `已保存到工作空间：${title}` });
    onEvent('workspace_updated', { spaceId: session.spaceId, docId: node.id, docName: title, docType: 'document' });

    return { success: true, doc_id: node.id, name: title };
  } catch (e) {
    return { success: false, error: `保存失败：${e.message}` };
  }
}

// ── 工具展示名称 ──────────────────────────────────────────────────

function getToolDisplay(toolName, args) {
  switch (toolName) {
    case 'write_todos': return `更新计划（${Array.isArray(args.todos) ? args.todos.length : 0} 项）`;
    case 'update_brief': return '整理任务简报';
    case 'review_uploaded_images': return `查看已上传图片：${(args.prompt || '').slice(0, 24)}`;
    case 'web_search': return `搜索：${args.query || ''}`;
    case 'web_fetch':  return `读取页面：${(args.url || '').replace(/https?:\/\//, '').slice(0, 50)}`;
    case 'run_strategy': return `制定策划方案：${args.brand || ''}`;
    case 'build_ppt':  return args.note ? `生成 PPT（${args.note}）` : '生成 PPT';
    case 'read_workspace_doc':    return `读取文档：${args.doc_id || ''}${args.focus ? `（${args.focus}）` : ''}`;
    case 'save_to_workspace':     return `保存到空间：${(args.title || '').slice(0, 24)}`;
    case 'update_workspace_doc':  return `更新文档：${args.doc_id || ''}${args.title ? `→${args.title}` : ''}`;
    default: return toolName;
  }
}

function pickValue(nextValue, fallback = '') {
  const text = String(nextValue || '').trim();
  return text || fallback || '';
}

module.exports = { TOOL_DEFINITIONS, executeTool, getToolDisplay };
