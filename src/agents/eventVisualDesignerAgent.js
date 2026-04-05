const BaseAgent = require('./baseAgent');

function dedupeStrings(values = []) {
  return [...new Map((Array.isArray(values) ? values : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .map(value => [value.toLowerCase(), value])).values()];
}

function inferSceneType(page = {}, index = 0, total = 0) {
  const role = String(page?.visualIntent?.role || page?.layout || page?.type || '').toLowerCase();
  const title = `${page?.title || ''} ${page?.content?.title || ''} ${page?.pageTitle || ''}`.toLowerCase();

  if (index === 0 || role === 'cover') return 'main_stage';
  if (role === 'toc') return 'data';
  if (role === 'metrics' || /数据|预算|kpi|metric/.test(title)) return 'data';
  if (role === 'timeline' || /timeline|流程|phase|schedule/.test(title)) return 'timeline';
  if (total > 1 && index === total - 1) return 'finale';
  if (/签到|checkin|welcome|arrival/.test(title)) return 'checkin';
  if (/舞台|stage|launch|发布/.test(title)) return 'main_stage';
  if (/展区|体验|体验区|demo|zone|booth/.test(title)) return 'exhibition_zone';
  if (/互动|装置|installation|engage|play/.test(title)) return 'interaction_installation';
  if (role === 'manifesto' || role === 'section') return 'brand_space';
  return 'atmosphere';
}

function fallbackAssetPlan(page = {}, index = 0, total = 0) {
  const sceneType = inferSceneType(page, index, total);
  const role = String(page?.visualIntent?.role || page?.layout || '').toLowerCase();
  const layout = String(page?.layout || page?.type || '').toLowerCase();
  if (role === 'toc' || role === 'timeline' || role === 'metrics' || sceneType === 'data' || sceneType === 'timeline') {
    return {
      assetType: 'none',
      priority: 'low',
      reason: '这一页以结构或数据信息为主，不需要额外生图。',
      sceneType,
      insertMode: 'background'
    };
  }
  const isPriorityScene = (
    index === 0 ||
    role === 'cover' ||
    role === 'section' ||
    role === 'manifesto' ||
    layout === 'image_statement' ||
    /main_stage|checkin|exhibition_zone|interaction_installation|brand_space|finale/.test(sceneType)
  );

  return {
    assetType: isPriorityScene ? 'generated_scene' : (layout === 'toc' ? 'none' : 'searched_background'),
    priority: index === 0 ? 'high' : (isPriorityScene ? 'medium' : 'low'),
    reason: isPriorityScene ? '这一页需要用更具说服力的空间氛围图来承接方案想象。' : '这一页以信息表达为主，不需要额外生图。',
    sceneType,
    insertMode: (layout === 'image_statement' || index === 0) ? 'full_page' : 'background'
  };
}

class EventVisualDesignerAgent extends BaseAgent {
  constructor(apiKeys = {}) {
    super('EventVisualDesignerAgent', 'minimax', apiKeys);
  }

  buildFallback(plan = {}, pptOutline = {}) {
    const visualTheme = plan?.visualTheme || {};
    const visualExecutionHints = plan?.visualExecutionHints || {};
    const pages = Array.isArray(pptOutline?.pages) ? pptOutline.pages : [];
    const palette = visualTheme?.colorMood || 'graphite black, silver light, cyan glow';
    const style = visualTheme?.style || 'premium futuristic launch space';
    const negativePrompt = dedupeStrings([
      ...(visualExecutionHints?.avoidElements || []),
      'watermark',
      'blurry text',
      'deformed crowd',
      'logo clutter',
      'cheap trade show booth'
    ]).join(', ');

    return {
      globalStyleGuide: {
        visualStyle: style,
        lighting: 'cinematic spotlight, volumetric haze, layered contrast',
        palette,
        cameraLanguage: 'wide-angle architectural hero shot, eye-level, spatial depth',
        negativePrompt
      },
      pages: pages.map((page, index) => {
        const assetPlan = fallbackAssetPlan(page, index, pages.length);
        const sceneLabel = assetPlan.sceneType.replace(/_/g, ' ');
        const focus = dedupeStrings([
          ...(visualExecutionHints?.mustRenderScenes || []).slice(0, 3),
          ...(visualExecutionHints?.spatialKeywords || []).slice(0, 3),
          ...(visualTheme?.imageKeywords || []).slice(0, 3)
        ]).slice(0, 4);
        const prompt = [
          `A ${style} ${sceneLabel} for a branded event presentation`,
          'cinematic event rendering, architectural composition, premium materials',
          `palette of ${palette}`,
          `focus on ${focus.join(', ') || 'lighting, stage layers, reflective materials'}`,
          'ultra detailed, realistic spatial depth, no text'
        ].join(', ');

        return {
          pageIndex: index,
          pageTitle: page?.content?.title || page?.title || `Page ${index + 1}`,
          generateImage: assetPlan.assetType === 'generated_scene',
          assetType: assetPlan.assetType,
          priority: assetPlan.priority,
          sceneType: assetPlan.sceneType,
          insertMode: assetPlan.insertMode,
          shotIntent: assetPlan.reason,
          mustHave: focus,
          avoid: visualExecutionHints?.avoidElements || [],
          prompt,
          fallbackQuery: `${sceneLabel} ${((visualTheme?.imageKeywords || []).slice(0, 2)).join(' ')}`.trim(),
          reason: assetPlan.reason
        };
      })
    };
  }

  async run({ plan, pptOutline, userInput, attachments = [] }) {
    const pages = Array.isArray(pptOutline?.pages) ? pptOutline.pages : [];
    if (!pages.length) return this.buildFallback(plan, pptOutline);

    const visualTheme = plan?.visualTheme || {};
    const visualExecutionHints = plan?.visualExecutionHints || {};
    const attachmentHints = attachments
      .map(item => item?.analysis || item?.name || '')
      .filter(Boolean)
      .slice(0, 4)
      .join('\n');

    const pageSummary = pages.slice(0, 16).map((page, index) => ({
      pageIndex: index,
      layout: page?.layout || page?.type || '',
      title: page?.content?.title || page?.title || `Page ${index + 1}`,
      role: page?.visualIntent?.role || '',
      imageStrategy: page?.imageStrategy || {}
    }));

    const messages = [
      {
        role: 'system',
        content: `你是一位活动图设计师，负责把活动策划方案里的空间想象、舞台氛围和现场体验，翻译成可直接用于生成效果图的页级视觉脚本。

你要做的不是普通配图，而是判断哪些页面值得出效果图，以及每页应该生出什么样的现场场景。

原则：
1. 封面、章节开场、主舞台、重点体验区、互动装置页优先考虑生图。
2. KPI、预算、时间线、目录页通常不生图，除非确实需要轻氛围背景。
3. prompt 必须偏“空间、灯光、材质、装置、构图”，不要写成平面海报。
4. 尽量避免强依赖人物脸部特写，优先做建筑空间和活动现场氛围图。
5. 输出必须是合法 JSON。`
      },
      {
        role: 'user',
        content: `品牌：${userInput?.brand || ''}
活动类型：${userInput?.eventType || ''}
主题：${userInput?.topic || ''}

视觉风格：
${JSON.stringify(visualTheme, null, 2)}

现场执行视觉线索：
${JSON.stringify(visualExecutionHints, null, 2)}

页面结构：
${JSON.stringify(pageSummary, null, 2)}

用户上传参考图线索：
${attachmentHints || '无'}

请输出 JSON：
{
  "globalStyleGuide": {
    "visualStyle": "整体效果图风格",
    "lighting": "灯光语言",
    "palette": "颜色与材质倾向",
    "cameraLanguage": "镜头语言",
    "negativePrompt": "统一负向约束"
  },
  "pages": [
    {
      "pageIndex": 0,
      "pageTitle": "页面标题",
      "generateImage": true,
      "assetType": "generated_scene | searched_background | none",
      "priority": "high | medium | low",
      "sceneType": "main_stage | checkin | exhibition_zone | interaction_installation | finale | brand_space | atmosphere | timeline | data",
      "insertMode": "background | panel | full_page",
      "shotIntent": "这一页想让用户看到什么现场画面",
      "mustHave": ["图里应该出现或强调的关键元素"],
      "avoid": ["这一页要避免的元素"],
      "prompt": "英文生图 prompt，80词以内",
      "fallbackQuery": "英文回退搜图词",
      "reason": "为什么这页这样处理"
    }
  ]
}`
      }
    ];

    try {
      const result = await this.callLLMJson(messages, { maxTokens: 2200, temperature: 0.45 });
      if (!Array.isArray(result?.pages) || !result.pages.length) throw new Error('missing visual pages');
      return result;
    } catch (err) {
      console.warn('[EventVisualDesignerAgent] 视觉设计失败，回退启发式结果:', err.message);
      return this.buildFallback(plan, pptOutline);
    }
  }
}

module.exports = EventVisualDesignerAgent;
