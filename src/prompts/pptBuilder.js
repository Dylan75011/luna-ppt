// PPT Builder Agent 提示词
// AI 优先生成结构化版式，再回退到 layout 名称

const LAYOUT_HINTS = `
可选 layout:
- immersive_cover: 全屏沉浸式封面，大标题居中或偏左，背景图全覆盖
- bento_grid: 不规则网格布局，适合展示多个亮点/特性，Apple Control Center 风格
- split_content: 左右分栏对比，适合竞品分析/优劣势对比
- timeline_flow: 时间线/流程图，适合执行计划
- minimal_text: 大量留白简约文字，适合核心策略/愿景
- data_cards: 数据指标卡片，适合 KPI/预算展示
- image_statement: 大图主导的宣言页，适合品牌气质、场景想象、章节开场
- editorial_quote: 左侧大标题/引言，右侧事实或短句，适合观点页和转场页
- asymmetrical_story: 非对称叙事布局，适合阐述故事线、体验旅程、创意亮点
- toc: 目录页，左侧色块+右侧列表
- end_card: 结束页，简洁大气`;

const STYLE_HINTS = `
可选 style:
- dark_tech: 深色科技风（深黑底 + 蓝色光效 + 金色点缀），适合高端科技发布会
- light_minimal: 浅色简约（白底 + 深灰文字 + 彩色点缀），适合商务简洁风
- warm_premium: 暖色高端（米白底 + 棕色系），适合轻奢/国潮风格`;

const COMPOSITION_HINTS = `
优先输出结构化版式字段，而不是只给 layout 名称。

每页尽量包含：
- composition: 可以是预设名，也可以是你自定义的对象；如果内容复杂，优先直接写自定义 regions，而不是套预设名
- regions: 信息区数组，每个区写 x / y / w / h / stack / gap / align / valign
- imagePlacement: 图片参与方式，例如 {"mode":"background","emphasis":"hero"} 或 {"mode":"panel","x":60,"y":10,"w":28,"h":72}
- textBlocks: 文本块数组，每个块标明归属 region 和 kind

textBlocks.kind 可用：
- eyebrow
- title
- subtitle
- body
- quote
- fact-list
- numbered-list
- stats

严格要求：
- 不要复用同一套区域比例到多页
- regions 要根据文案长度和图片安全区动态调整
- 如果一页只有 2-3 个重点，就用更开阔的留白，而不是补出多余框
- 如果一页内容较多，优先提炼文案，再做分栏，不要堆满整页

目标不是“像模板”，而是让 AI 真正决定每页的版式结构。`;

function buildPptBuilderPrompt(plan, userInput) {
  const { brand, description, tone, brandColor } = userInput;
  const primaryColor = (brandColor || '1A1A1A').replace('#', '');
  const tasteDirectives = `
Taste 设计规则（必须落实到每页）：
1. 不要做“通用咨询模板”或“3等分卡片横排”的 AI 常见版式。
2. 封面、章节开场、结尾必须有明显节奏变化，不能所有页都长得像内容页。
3. 默认使用左对齐或非对称构图，不要频繁居中堆字。
4. 一页只保留一个视觉重心：大图、宣言标题、数据、时间线四者不要混杂。
5. 色彩保持单一体系，避免紫色 AI 光效。优先深石墨、暖中性色、深蓝灰，搭配一个控制过的强调色。
6. 文案必须来源于策划方案，但表达可提炼得更像高端发布会或展览叙事。
7. 每页都要写清 imageStrategy：是否需要背景图、搜索方向、文字避让区域、遮罩强度。
8. 每页都尽量补充 visualAssetPlan：这一页更适合用现场效果图、搜图背景，还是纯版式。
9. 页面布局要形成“张弛关系”：信息页之间插入 statement / editorial / image-led 页面，避免连续同构。
10. 优先生成能落地的专业版式，不要为炫技牺牲信息密度与可读性。
11. 文案允许提炼、缩写、重写，但必须忠于原策划方案，不要扩写空话。`;

  const systemPrompt = `你是一位顶级PPT设计师，擅长将活动策划方案转化为视觉冲击力强、风格独特的PPT。
你需要为每一页选择最合适的设计：优先输出结构化版式(composition / regions / imagePlacement / textBlocks)，其次才是布局(layout) + 风格(style) + 内容。

${LAYOUT_HINTS}
${STYLE_HINTS}
${COMPOSITION_HINTS}
${tasteDirectives}

输出必须是合法的JSON格式，不要包含任何其他文字。`;

  const planText = JSON.stringify(plan, null, 2);

  const userPrompt = `请将以下活动策划方案转换为PPT JSON数据。

品牌：${brand}
需求描述：${description}
品牌调性：${tone || '未明确，由你根据品牌和活动类型推断'}
品牌主色：#${primaryColor}

## 策划方案
${planText}

请输出以下JSON格式（12-16页左右）：
{
  "globalStyle": "dark_tech",
  "title": "${plan?.planTitle || brand + ' ' + description}",
  "theme": {
    "primary": "${primaryColor}",
    "secondary": "根据品牌调性推导互补色",
    "brand": "${brand}"
  },
  "pages": [
    {
      "layout": "immersive_cover",
      "style": "dark_tech",
      "composition": "hero-asymmetric",
      "regions": [
        {"name": "header", "x": 7, "y": 14, "w": 50, "h": 38, "stack": "vertical", "gap": 18, "align": "start", "valign": "start"},
        {"name": "body", "x": 7, "y": 62, "w": 34, "h": 16, "stack": "vertical", "gap": 12, "align": "start", "valign": "end"}
      ],
      "imagePlacement": {
        "mode": "background",
        "emphasis": "hero"
      },
      "textBlocks": [
        {"region": "header", "kind": "eyebrow", "text": "${brand}"},
        {"region": "header", "kind": "title", "text": "大标题（品牌名或活动主题）"},
        {"region": "header", "kind": "subtitle", "text": "副标题或 slogan"},
        {"region": "body", "kind": "body", "text": "一句更像高端发布会前言的短句"}
      ],
      "visualIntent": {
        "role": "cover",
        "mood": "一句话描述情绪气质",
        "density": "airy",
        "composition": "left-weighted",
        "reason": "为什么适合做封面"
      },
      "visualAssetPlan": {
        "assetType": "generated_scene",
        "priority": "high",
        "reason": "封面需要更强的场景想象和发布会氛围",
        "sceneType": "main_stage",
        "insertMode": "full_page"
      },
      "imageStrategy": {
        "useBackground": true,
        "query": "英文搜图词，和品牌气质相关",
        "treatment": "full-bleed-dark",
        "overlay": 0.58,
        "focalPoint": "right-center",
        "textPlacement": "left"
      },
      "content": {
        "title": "大标题（品牌名或活动主题）",
        "subtitle": "副标题或 slogan",
        "date": "2026年",
        "location": "全球发布盛典",
        "brand": "${brand}"
      }
    },
    {
      "layout": "toc",
      "style": "dark_tech",
      "composition": "split-editorial",
      "regions": [
        {"name": "header", "x": 8, "y": 16, "w": 18, "h": 50, "stack": "vertical", "gap": 12, "align": "start", "valign": "center"},
        {"name": "facts", "x": 34, "y": 16, "w": 56, "h": 54, "stack": "vertical", "gap": 10, "align": "stretch", "valign": "center"}
      ],
      "imagePlacement": {
        "mode": "background",
        "emphasis": "none"
      },
      "textBlocks": [
        {"region": "header", "kind": "eyebrow", "text": "CONTENTS"},
        {"region": "header", "kind": "title", "text": "目录"},
        {"region": "facts", "kind": "fact-list", "items": ["战略定位", "受众洞察", "核心亮点", "执行计划", "传播策略"]}
      ],
      "visualIntent": {
        "role": "toc",
        "mood": "冷静、利落",
        "density": "medium",
        "composition": "sidebar",
        "reason": "目录页不抢戏，只负责建立结构"
      },
      "visualAssetPlan": {
        "assetType": "none",
        "priority": "low",
        "reason": "目录页以结构信息为主，不需要生图",
        "sceneType": "data",
        "insertMode": "background"
      },
      "imageStrategy": {
        "useBackground": false,
        "query": "",
        "treatment": "none",
        "overlay": 0,
        "focalPoint": "center",
        "textPlacement": "right"
      },
      "content": {
        "items": [
          {"title": "战略定位"},
          {"title": "受众洞察"},
          {"title": "核心亮点"},
          {"title": "执行计划"},
          {"title": "传播策略"}
        ]
      }
    },
    {
      "layout": "asymmetrical_story",
      "style": "dark_tech",
      "visualIntent": {
        "role": "section_opener",
        "mood": "高级、明确、有前进感",
        "density": "airy",
        "composition": "asymmetric",
        "reason": "用来打断模板感，建立章节节奏"
      },
      "imageStrategy": {
        "useBackground": true,
        "query": "英文搜图词，呼应这一章主题",
        "treatment": "split-atmosphere",
        "overlay": 0.5,
        "focalPoint": "right",
        "textPlacement": "left"
      },
      "content": {
        "eyebrow": "SECTION 01",
        "title": "章节开场标题",
        "story": "一句有态度的策略引导语",
        "points": ["支撑点1", "支撑点2", "支撑点3"]
      }
    },
    {
      "layout": "bento_grid",
      "style": "dark_tech",
      "visualIntent": {
        "role": "highlights",
        "mood": "有力度，但不拥挤",
        "density": "medium",
        "composition": "mosaic",
        "reason": "适合承载多个亮点，但必须避免普通三卡模板"
      },
      "imageStrategy": {
        "useBackground": true,
        "query": "英文搜图词，偏抽象氛围图",
        "treatment": "ambient-texture",
        "overlay": 0.72,
        "focalPoint": "center",
        "textPlacement": "left"
      },
      "content": {
        "title": "活动亮点",
        "cards": [
          {"title": "亮点1", "tag": "标签", "description": "描述", "metrics": [{"value": "30%", "label": "提升"}]},
          {"title": "亮点2", "tag": "标签", "description": "描述", "metrics": [{"value": "5倍", "label": "效率"}]},
          {"title": "亮点3", "tag": "标签", "description": "描述", "metrics": [{"value": "100万+", "label": "曝光"}]}
        ]
      }
    },
    {
      "layout": "split_content",
      "style": "dark_tech",
      "visualIntent": {
        "role": "comparison",
        "mood": "理性、锋利",
        "density": "medium",
        "composition": "split",
        "reason": "对比页需要清晰结构，而非装饰"
      },
      "imageStrategy": {
        "useBackground": true,
        "query": "英文搜图词，偏理性建筑/光影/结构感",
        "treatment": "dark-paneled",
        "overlay": 0.84,
        "focalPoint": "center",
        "textPlacement": "split"
      },
      "content": {
        "title": "竞品对比",
        "leftTitle": "行业现状",
        "leftItems": ["现状1", "现状2", "现状3"],
        "rightTitle": "我们的优势",
        "rightItems": ["优势1", "优势2", "优势3"]
      }
    },
    {
      "layout": "editorial_quote",
      "style": "dark_tech",
      "visualIntent": {
        "role": "manifesto",
        "mood": "克制但有压迫感",
        "density": "airy",
        "composition": "editorial",
        "reason": "关键策略页要像宣言，而不是说明书"
      },
      "imageStrategy": {
        "useBackground": true,
        "query": "英文搜图词，偏意境氛围与材质光影",
        "treatment": "editorial-fade",
        "overlay": 0.64,
        "focalPoint": "right-center",
        "textPlacement": "left"
      },
      "content": {
        "title": "核心策略",
        "subtitle": "一句话概括核心命题",
        "quote": "最想传达的核心观点",
        "facts": ["支撑事实 1", "支撑事实 2", "支撑事实 3"]
      }
    },
    {
      "layout": "timeline_flow",
      "style": "dark_tech",
      "visualIntent": {
        "role": "timeline",
        "mood": "推进感明确",
        "density": "medium",
        "composition": "flow",
        "reason": "执行计划必须清楚、节奏分明"
      },
      "imageStrategy": {
        "useBackground": true,
        "query": "英文搜图词，偏速度感、路径感、结构光",
        "treatment": "dim-atmosphere",
        "overlay": 0.82,
        "focalPoint": "center",
        "textPlacement": "center"
      },
      "content": {
        "title": "执行时间线",
        "phases": [
          {"date": "T-30", "name": "筹备期", "tasks": ["任务1", "任务2"]},
          {"date": "T-7", "name": "冲刺期", "tasks": ["任务1", "任务2"]},
          {"date": "T-1", "name": "发布会", "tasks": ["任务1", "任务2"]},
          {"date": "T+7", "name": "传播期", "tasks": ["任务1", "任务2"]}
        ]
      }
    },
    {
      "layout": "data_cards",
      "style": "dark_tech",
      "visualIntent": {
        "role": "metrics",
        "mood": "精确、有说服力",
        "density": "compact",
        "composition": "stat-grid",
        "reason": "数据页要像战报，而不是销售海报"
      },
      "imageStrategy": {
        "useBackground": true,
        "query": "英文搜图词，偏微观纹理或低干扰科技背景",
        "treatment": "subtle-grid",
        "overlay": 0.88,
        "focalPoint": "center",
        "textPlacement": "center"
      },
      "content": {
        "title": "预期效果",
        "metrics": [
          {"value": "5000万+", "label": "传播覆盖", "sub": "人群"},
          {"value": "200+", "label": "媒体报道", "sub": "家"},
          {"value": "90%", "label": "满意度", "sub": ""},
          {"value": "1亿+", "label": "话题阅读", "sub": ""}
        ]
      }
    },
    {
      "layout": "end_card",
      "style": "dark_tech",
      "visualIntent": {
        "role": "ending",
        "mood": "收束、留白、余韵",
        "density": "airy",
        "composition": "centered-minimal",
        "reason": "结尾页要有情绪收口，不能只是写 thank you"
      },
      "imageStrategy": {
        "useBackground": true,
        "query": "英文搜图词，偏远景、地平线、夜色、抽象收束感",
        "treatment": "quiet-finale",
        "overlay": 0.62,
        "focalPoint": "center",
        "textPlacement": "center"
      },
      "content": {
        "title": "感谢观看",
        "subtitle": "Thank You",
        "brand": "${brand}"
      }
    }
  ]
}

重要规则：
1. 内容要真实来自策划方案，不要编造
2. globalStyle 是全局风格约束，但页面结构必须形成节奏变化，不能连续 3 页使用同一个 composition
3. 优先输出 composition / regions / imagePlacement / textBlocks。layout 只是兜底，不要把设计思考压缩成模板名
4. imageStrategy.query 必须是可以直接用于搜图的英文短语，和该页内容相关，但偏氛围、材质、空间、光影，不要直白描述具体会议场景
5. visualAssetPlan 要明确回答：这页是否值得提前做活动现场效果图建议
6. 如果某页信息很多，先提炼，不要把所有要点都塞进去；一页最多一个主要观点
7. dark_tech 风格的 bg 用深色，content 背景图会叠加半透明遮罩
8. 第一页必须是 immersive_cover，最后一页必须是 end_card，第二页必须是 toc`;

  return { systemPrompt, userPrompt };
}

function buildOutlinePrompt(plan, userInput) {
  return buildPptBuilderPrompt(plan, userInput);
}

function buildPagePrompt(pageSpec, index, total, plan, userInput, theme) {
  return buildPptBuilderPrompt(plan, userInput);
}

function buildImageAwareRefinementPrompt({ plan, userInput, pages, imageAnalyses }) {
  const systemPrompt = `你是一位 image-aware 的高级版式设计师。
你的任务不是重新写一套PPT，而是根据“已选中的真实背景图”对每一页进行二次微调，让版式真正贴合图片。

规则：
1. 保持页数和顺序不变。
2. 只修改这些字段：layout、style、composition、regions、imagePlacement、textBlocks、visualIntent、imageStrategy、content。
3. 如果图片不适合做背景，必须把 imageStrategy.useBackground 改成 false。
4. 优先根据图片的 darker side / recommended overlay / text placement 来决定文字位置和遮罩。
5. 不要为了变化而变化。只在图片确实支持时切换 layout。
6. 避免连续使用同一种布局；但比起“变化”，更重要的是图文关系自然。
7. 输出必须是合法 JSON。`;

  const userPrompt = `请基于以下策划背景和图片分析，对页面做二次设计。

品牌：${userInput.brand}
需求：${userInput.description}
调性：${userInput.tone || ''}
方案标题：${plan?.planTitle || ''}
核心策略：${plan?.coreStrategy || ''}

当前页面：
${JSON.stringify(pages, null, 2)}

对应图片分析：
${JSON.stringify(imageAnalyses, null, 2)}

请输出：
{
  "pages": [
    {
      "layout": "保留或改成更合适的布局",
      "style": "dark_tech",
      "composition": "更合适的结构化版式",
      "regions": [],
      "imagePlacement": {},
      "textBlocks": [],
      "visualIntent": {},
      "imageStrategy": {},
      "content": {}
    }
  ]
}`;

  return { systemPrompt, userPrompt };
}

module.exports = { buildPptBuilderPrompt, buildOutlinePrompt, buildPagePrompt, buildImageAwareRefinementPrompt };
