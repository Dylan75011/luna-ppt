// PPT Builder Agent 提示词

/**
 * 第一步：生成页面大纲（轻量 JSON，速度快）
 * 输出：{ title, theme: { primary, secondary }, pages: [{ type, hint }] }
 */
function buildOutlinePrompt(plan, userInput) {
  const { brand, productCategory, eventType, topic, brandColor } = userInput;
  const primaryColor = (brandColor || '1A1A1A').replace('#', '');

  const systemPrompt = `你是一位专业的PPT内容设计师。
根据活动策划方案，输出PPT页面大纲（仅包含页面类型和标题提示），不要输出具体内容。
page.type 只能是以下7种之一：cover / toc / content / two_column / cards / timeline / end
输出必须是合法的JSON格式，不要包含任何其他文字。`;

  const planSummary = plan?.executiveSummary || plan?.overview || JSON.stringify(plan).slice(0, 800);

  const userPrompt = `品牌：${brand}，活动：${topic}，类别：${productCategory}

策划摘要：${planSummary}

请输出12-16页的PPT大纲，JSON格式如下：
{
  "title": "${brand} ${topic} 策划方案",
  "theme": {
    "primary": "${primaryColor}",
    "secondary": "根据品牌调性推导一个深色互补色（6位十六进制，不含#）"
  },
  "pages": [
    { "type": "cover",   "hint": "封面 - ${brand} ${topic}" },
    { "type": "toc",     "hint": "目录" },
    { "type": "content", "hint": "活动背景与目标" },
    { "type": "content", "hint": "核心策略" },
    { "type": "two_column", "hint": "竞品对比 / 优势分析" },
    { "type": "cards",   "hint": "活动亮点" },
    { "type": "timeline","hint": "执行时间线" },
    { "type": "content", "hint": "预算规划" },
    { "type": "end",     "hint": "结束页" }
  ]
}
规则：第一页必须是 cover，最后一页必须是 end，第二页必须是 toc。`;

  return { systemPrompt, userPrompt };
}

/**
 * 第二步：逐页生成完整内容
 * pageSpec: { type, hint }，index: 当前页序号，total: 总页数
 */
function buildPagePrompt(pageSpec, index, total, plan, userInput, theme) {
  const { brand, topic } = userInput;
  const primaryColor = (theme?.primary || '1A1A1A').replace('#', '');

  const systemPrompt = `你是一位专业的PPT内容设计师，正在为"${brand} ${topic}"逐页生成PPT内容。
当前正在生成第 ${index + 1}/${total} 页。
输出必须是合法的JSON格式，仅返回该页的JSON对象，不要包含数组或其他包裹结构。`;

  const planText = JSON.stringify(plan).slice(0, 2000);

  // 根据页面类型给出对应的 JSON 结构示例
  const schemas = {
    cover: `{
  "type": "cover",
  "mainTitle": "${brand}",
  "subtitle": "${topic}",
  "date": "活动日期（如：2026年Q3）",
  "location": "活动地点",
  "brand": "${brand}"
}`,
    toc: `{
  "type": "toc",
  "items": [
    {"title": "章节名1"},
    {"title": "章节名2"},
    {"title": "章节名3"},
    {"title": "章节名4"},
    {"title": "章节名5"}
  ]
}`,
    content: `{
  "type": "content",
  "title": "章节标题",
  "sectionNum": "01",
  "sections": [
    { "title": "小标题", "content": ["要点1", "要点2", "要点3"] }
  ],
  "kpis": [
    {"value": "数值", "label": "指标名"}
  ]
}`,
    two_column: `{
  "type": "two_column",
  "title": "对比标题",
  "columns": [
    {"title": "左栏标题", "items": ["内容1", "内容2", "内容3"]},
    {"title": "右栏标题", "items": ["内容1", "内容2", "内容3"]}
  ]
}`,
    cards: `{
  "type": "cards",
  "title": "卡片标题",
  "cards": [
    {"title": "亮点1", "tag": "标签", "description": "描述", "features": ["特点1", "特点2"]},
    {"title": "亮点2", "tag": "标签", "description": "描述", "features": ["特点1", "特点2"]},
    {"title": "亮点3", "tag": "标签", "description": "描述", "features": ["特点1", "特点2"]}
  ]
}`,
    timeline: `{
  "type": "timeline",
  "title": "执行时间线",
  "phases": [
    {"month": "时间节点", "name": "阶段名称", "tasks": ["任务1", "任务2", "任务3"]},
    {"month": "时间节点", "name": "阶段名称", "tasks": ["任务1", "任务2", "任务3"]},
    {"month": "时间节点", "name": "阶段名称", "tasks": ["任务1", "任务2", "任务3"]},
    {"month": "时间节点", "name": "阶段名称", "tasks": ["任务1", "任务2"]}
  ]
}`,
    end: `{
  "type": "end",
  "mainText": "感谢观看",
  "subText": "Thank You",
  "brand": "${brand}"
}`,
  };

  const schema = schemas[pageSpec.type] || schemas.content;

  const userPrompt = `请根据以下策划方案，生成第 ${index + 1}/${total} 页的PPT内容。

页面主题提示：${pageSpec.hint}
页面类型：${pageSpec.type}
品牌主色：#${primaryColor}

策划方案（节选）：
${planText}

请严格按照以下JSON结构输出，内容要真实来自策划方案，要精炼：
${schema}

重要：仅返回该页JSON对象，不要有任何其他文字。`;

  return { systemPrompt, userPrompt };
}

function buildPptBuilderPrompt(plan, userInput) {
  const { brand, productCategory, eventType, topic, brandColor } = userInput;
  const primaryColor = (brandColor || '1A1A1A').replace('#', '');

  const systemPrompt = `你是一位专业的PPT内容设计师，擅长将活动策划方案转化为结构清晰、视觉逻辑合理的PPT内容。
你需要将策划方案转换为特定的JSON格式，供PPT生成引擎使用。

page.type 只能是以下7种之一：cover / toc / content / two_column / cards / timeline / end
输出必须是合法的JSON格式，不要包含任何其他文字。`;

  const planText = JSON.stringify(plan, null, 2);

  const userPrompt = `请将以下活动策划方案转换为PPT JSON数据。

品牌：${brand}
产品类别：${productCategory}
活动类型：${eventType}
主题：${topic}
品牌主色：#${primaryColor}

## 策划方案
${planText}

请输出以下JSON格式（12-16页左右）：
{
  "title": "${brand} ${topic} 策划方案",
  "theme": {
    "primary": "${primaryColor}",
    "secondary": "根据品牌调性推导一个深色互补色，6位十六进制"
  },
  "pages": [
    {
      "type": "cover",
      "mainTitle": "${brand}",
      "subtitle": "${topic} 策划方案",
      "date": "活动日期或年月",
      "location": "活动地点（如已知）",
      "brand": "${brand}"
    },
    {
      "type": "toc",
      "items": [
        {"title": "章节名1"},
        {"title": "章节名2"}
      ]
    },
    {
      "type": "content",
      "title": "章节标题",
      "sectionNum": "01",
      "sections": [
        {
          "title": "小标题",
          "content": ["要点1", "要点2", "要点3"]
        }
      ],
      "kpis": [
        {"value": "数值", "label": "指标"}
      ]
    },
    {
      "type": "two_column",
      "title": "对比分析",
      "columns": [
        {"title": "左栏标题", "items": ["内容1", "内容2"]},
        {"title": "右栏标题", "items": ["内容1", "内容2"]}
      ]
    },
    {
      "type": "cards",
      "title": "活动亮点",
      "cards": [
        {
          "title": "亮点名称",
          "tag": "标签（可选）",
          "description": "简短描述",
          "features": ["特点1", "特点2"]
        }
      ]
    },
    {
      "type": "timeline",
      "title": "执行时间线",
      "phases": [
        {
          "month": "时间节点",
          "name": "阶段名称",
          "tasks": ["任务1", "任务2", "任务3"]
        }
      ]
    },
    {
      "type": "end",
      "mainText": "感谢观看",
      "subText": "Thank You",
      "brand": "${brand}"
    }
  ]
}

重要规则：
1. 内容要真实来自策划方案，不要编造
2. 每页内容不要过多，要精炼
3. cards 类型建议 3 张卡片
4. timeline 类型建议 4-5 个阶段
5. kpis 建议 3-4 个指标
6. 第一页必须是 cover，最后一页必须是 end，第二页必须是 toc`;

  return { systemPrompt, userPrompt };
}

module.exports = { buildPptBuilderPrompt, buildOutlinePrompt, buildPagePrompt };
