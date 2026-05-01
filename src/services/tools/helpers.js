// 工具执行器公共辅助函数
const { markdownToTiptap } = require('../richText');

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

function createStallWatcher(onStall, intervalMs = 25000) {
  if (typeof onStall !== 'function' || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return { bump() {}, stop() {} };
  }

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      onStall();
      schedule();
    }, intervalMs);
  };

  schedule();
  return {
    bump: schedule,
    stop() {
      clearTimeout(timer);
      timer = null;
    }
  };
}

function emitPlanArtifacts(onEvent, plan = {}, round = 1, review = null) {
  onEvent('artifact', {
    artifactType: 'plan_draft',
    payload: {
      round,
      planTitle: plan.planTitle || '',
      coreStrategy: plan.coreStrategy || '',
      highlights: Array.isArray(plan.highlights) ? plan.highlights.slice(0, 5) : [],
      degraded: !!plan.degraded,
      artifactKey: `plan_draft_r${round}`
    }
  });

  // artifactKey 与 generatePlanDoc 流式阶段保持一致（plan_section_r{round}_{index}），
  // 这样最终 emit 是"刷新"而不是追加；前端按 key 替换流式版本。
  // 只用 round + index：title 在 normalize 阶段可能被 trim，避免 key 不一致。
  (Array.isArray(plan.sections) ? plan.sections : []).forEach((section, index) => {
    onEvent('artifact', {
      artifactType: 'plan_section',
      payload: {
        round,
        index,
        total: plan.sections.length,
        title: section.title || `章节 ${index + 1}`,
        keyPoints: Array.isArray(section.keyPoints) ? section.keyPoints : [],
        content: {
          narrative: section.narrative || ''
        },
        polished: true,
        phase: 'final',
        artifactKey: `plan_section_r${round}_${index}`
      }
    });
  });

  if (review) {
    onEvent('artifact', {
      artifactType: 'review_feedback',
      payload: {
        round,
        score: review.score,
        passed: !!review.passed,
        strengths: Array.isArray(review.strengths) ? review.strengths : [],
        weaknesses: Array.isArray(review.weaknesses) ? review.weaknesses : [],
        specificFeedback: review.specificFeedback || ''
      }
    });
  }
}

function emitDraftDocPreview({ onEvent, plan, userInput, title, progressScale = 0.35, progressFloor = 6 }) {
  const draftDoc = markdownToTiptap(buildPlanDraftMarkdown(plan, userInput));
  const snapshots = buildDocStreamSnapshots(
    draftDoc,
    title || plan?.planTitle || userInput?.topic || `${userInput?.brand || ''}策划方案`
  );
  snapshots.forEach((snapshot, index) => {
    onEvent('doc_section_added', {
      title: snapshot.title,
      sectionTitle: snapshot.sectionTitle || '',
      progress: Math.max(progressFloor, Math.round(snapshot.progress * progressScale)),
      index,
      total: snapshots.length,
      docContent: snapshot.content,
      provisional: true
    });
  });
  return draftDoc;
}

function pickValue(nextValue, fallback = '') {
  const text = String(nextValue || '').trim();
  return text || fallback || '';
}

function getToolDisplay(toolName, args) {
  switch (toolName) {
    case 'generate_image': return `AI生图：${args.intent || args.prompt?.slice(0, 30) || ''}`;
    case 'search_images': return `找图：${args.intent || args.query || ''}`;
    case 'write_todos': return `更新计划（${Array.isArray(args.todos) ? args.todos.length : 0} 项）`;
    case 'update_brief': return '整理任务简报';
    case 'review_uploaded_images': return `查看已上传图片：${(args.prompt || '').slice(0, 24)}`;
    case 'web_search': return `搜索：${args.query || ''}`;
    case 'web_fetch':  return `读取页面：${(args.url || '').replace(/https?:\/\//, '').slice(0, 50)}`;
    case 'propose_concept': return args.user_feedback ? `调整创意方向（根据反馈）` : `梳理活动主体思路`;
    case 'approve_concept': return '确认创意方向';
    case 'run_strategy': return `制定策划方案：${args.brand || ''}`;
    case 'review_strategy': return args.note ? `专家评审（${args.note}）` : '专家评审方案';
    case 'build_ppt':  return args.note ? `生成 PPT（${args.note}）` : '生成 PPT';
    case 'read_workspace_doc':      return `读取文档：${args.doc_id || ''}${args.focus ? `（${args.focus}）` : ''}`;
    case 'save_to_workspace':       return `保存到空间：${(args.title || '').slice(0, 24)}`;
    case 'update_workspace_doc':    return `整体重写文档：${args.doc_id || ''}${args.title ? `→${args.title}` : ''}`;
    case 'patch_workspace_doc_section': {
      const modeMap = { replace: '替换', append: '内追加', prepend: '前置', delete: '删除' };
      const m = modeMap[String(args.mode || 'replace').toLowerCase()] || '编辑';
      return `章节${m}：${args.heading || ''}`;
    }
    case 'find_replace_in_doc': {
      const find = (args.find || '').slice(0, 24);
      const replace = (args.replace || '').slice(0, 24);
      return `查找替换：${find} → ${replace}${args.scope_heading ? `（限定 ${args.scope_heading}）` : ''}`;
    }
    case 'append_workspace_doc':    return `在文档末尾追加：${args.doc_id || ''}`;
    case 'list_workspace_docs':     return '查看空间文档列表';
    case 'search_workspace_docs':   return `搜索空间文档：${args.keyword || ''}`;
    case 'create_workspace_folder': return `新建文件夹：${args.name || ''}`;
    case 'rename_workspace_doc':    return `重命名：${args.doc_id || ''}→${args.new_name || ''}`;
    case 'set_workspace_doc_role':  return `标注文档角色：${args.doc_id || ''}→${args.role || ''}`;
    case 'delete_workspace_doc':    return args.confirmed ? `删除文档：${args.doc_id || ''}` : `请求删除文档：${args.doc_id || ''}（待确认）`;
    case 'analyze_note_images': {
      // brain 现在主要传 note_url（让后端从 noteCache 取 images），fallback 才传 image_urls
      // 入参阶段拿不到 noteCache 的 images 张数，note_url 模式只显示"该笔记"，等执行完用 tool_progress 报实际张数
      const imgs = Array.isArray(args.image_urls) ? args.image_urls.length : 0;
      const target = args.note_url ? '该笔记' : `${imgs} 张`;
      return `视觉分析笔记图片（${target}）：${(args.question || '').slice(0, 24)}`;
    }
    default: return toolName;
  }
}

module.exports = {
  createEmptyTiptapDoc,
  cloneDocNode,
  buildDocStreamSnapshots,
  buildPlanDraftMarkdown,
  createStallWatcher,
  emitPlanArtifacts,
  emitDraftDocPreview,
  pickValue,
  getToolDisplay
};
