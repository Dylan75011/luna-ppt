// PPT生成服务 - 使用pptxgenjs
const PptxGenJS = require('pptxgenjs');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

// 配色方案
const COLORS = {
  HUAWEI_RED: 'FA2F1F',
  DEEP_BLUE: '002D6B',
  DARK_BG: '0D1B2E',
  LIGHT_GRAY: 'F5F5F5',
  TEXT_DARK: '1A1A1A',
  TEXT_GRAY: '666666',
  ACCENT_BLUE: '007ACC',
  WHITE: 'FFFFFF'
};

// 辅助函数：添加矩形
function addRect(slide, left, top, width, height, fillColor, lineColor = null) {
  const shape = slide.addShape('rect', {
    x: left,
    y: top,
    w: width,
    h: height,
    fill: { color: fillColor },
    line: lineColor ? { color: lineColor } : { color: 'none' }
  });
  return shape;
}

// 辅助函数：添加文本框
function addTextBox(slide, left, top, width, height, options) {
  const {
    text = '',
    fontSize = 18,
    bold = false,
    color = COLORS.TEXT_DARK,
    align = 'left',
    italic = false,
    valign = 'top'
  } = options;

  const shape = slide.addText(text, {
    x: left,
    y: top,
    w: width,
    h: height,
    fontSize,
    bold,
    color,
    align,
    italic,
    valign,
    wrap: true
  });
  return shape;
}

// 辅助函数：添加页码
function addPageNumber(slide, num, total, slideW, slideH) {
  addTextBox(slide, slideW - 1.5, slideH - 0.5, 1.2, 0.3, {
    text: `${num}/${total}`,
    fontSize: 10,
    color: COLORS.TEXT_GRAY,
    align: 'right'
  });
}

// 根据模板生成PPT
async function generatePPT(templateData, outputFilename = null) {
  const pptx = new PptxGenJS();
  const slideW = 13.333;  // inches
  const slideH = 7.5;

  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'OpenClaw PPT';
  pptx.title = templateData.title || 'PPT Document';

  const theme = templateData.theme || {};
  const primaryColor = theme.primary || COLORS.HUAWEI_RED;
  const secondaryColor = theme.secondary || COLORS.DEEP_BLUE;

  let currentSlide = null;
  let slideIndex = 0;
  const totalPages = templateData.pages ? templateData.pages.length : 1;

  // 如果没有页面，创建一个空白幻灯片
  if (!templateData.pages || templateData.pages.length === 0) {
    currentSlide = pptx.addSlide();
    addTextBox(currentSlide, slideW / 2 - 2, slideH / 2 - 0.5, 4, 1, {
      text: templateData.title || '空白PPT',
      fontSize: 32,
      bold: true,
      color: secondaryColor,
      align: 'center'
    });
  }

  // 遍历模板页面
  for (const page of (templateData.pages || [])) {
    currentSlide = pptx.addSlide();
    slideIndex++;

    // 根据页面类型渲染
    switch (page.type) {
      case 'cover':
        renderCoverPage(currentSlide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages);
        break;
      case 'toc':
        renderTocPage(currentSlide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages);
        break;
      case 'content':
        renderContentPage(currentSlide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages);
        break;
      case 'two_column':
        renderTwoColumnPage(currentSlide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages);
        break;
      case 'cards':
        renderCardsPage(currentSlide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages);
        break;
      case 'timeline':
        renderTimelinePage(currentSlide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages);
        break;
      case 'end':
        renderEndPage(currentSlide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages);
        break;
      default:
        renderGenericPage(currentSlide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages);
    }
  }

  // 确保输出目录存在
  const outputDir = path.resolve(config.outputDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 生成文件名
  const filename = outputFilename || `ppt_${Date.now()}.pptx`;
  const filepath = path.join(outputDir, filename);

  // 保存文件
  await pptx.writeFile({ fileName: filepath });

  return {
    filename,
    filepath,
    path: `/api/files/download/${filename}`
  };
}

// 渲染封面页
function renderCoverPage(slide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages) {
  // 深色背景
  addRect(slide, 0, 0, slideW, slideH, secondaryColor);
  // 左侧红色装饰条
  addRect(slide, 0, 0, 0.15, slideH, primaryColor);

  // 标题
  addTextBox(slide, 1, 2.0, slideW - 2, 1.2, {
    text: page.mainTitle || page.title || '封面',
    fontSize: 56,
    bold: true,
    color: COLORS.WHITE,
    align: 'center'
  });

  // 副标题
  if (page.subtitle) {
    addTextBox(slide, 1, 3.3, slideW - 2, 0.8, {
      text: page.subtitle,
      fontSize: 28,
      color: COLORS.WHITE,
      align: 'center'
    });
  }

  // 红色分割线
  addRect(slide, slideW / 2 - 2, 4.3, 4, 0.03, primaryColor);

  // 底部信息
  if (page.date || page.location) {
    addTextBox(slide, 1, 4.8, slideW - 2, 0.5, {
      text: [page.date, page.location].filter(Boolean).join('  |  '),
      fontSize: 16,
      color: 'CCCCCC',
      align: 'center'
    });
  }

  // 品牌信息
  if (page.brand) {
    addTextBox(slide, 1, slideH - 1, slideW - 2, 0.5, {
      text: page.brand,
      fontSize: 14,
      color: '999999',
      align: 'center'
    });
  }
}

// 渲染目录页
function renderTocPage(slide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages) {
  // 顶部装饰线
  addRect(slide, 0, 0, slideW, 0.08, primaryColor);

  // 目录标题
  addTextBox(slide, 0.8, 0.5, 5, 0.8, {
    text: '目录',
    fontSize: 36,
    bold: true,
    color: secondaryColor
  });

  // 目录项
  const items = page.items || [];
  const leftItems = items.slice(0, Math.ceil(items.length / 2));
  const rightItems = items.slice(Math.ceil(items.length / 2));

  leftItems.forEach((item, i) => {
    const y = 1.6 + i * 1.0;
    const num = String(i + 1).padStart(2, '0');
    addTextBox(slide, 1.2, y, 0.8, 0.6, {
      text: num,
      fontSize: 24,
      bold: true,
      color: primaryColor
    });
    addTextBox(slide, 2.1, y + 0.1, 4, 0.5, {
      text: item.title || item,
      fontSize: 18,
      color: COLORS.TEXT_DARK
    });
  });

  rightItems.forEach((item, i) => {
    const y = 1.6 + i * 1.0;
    const num = String(i + 1 + leftItems.length).padStart(2, '0');
    addTextBox(slide, 7.0, y, 0.8, 0.6, {
      text: num,
      fontSize: 24,
      bold: true,
      color: primaryColor
    });
    addTextBox(slide, 7.9, y + 0.1, 4, 0.5, {
      text: item.title || item,
      fontSize: 18,
      color: COLORS.TEXT_DARK
    });
  });

  addPageNumber(slide, slideIndex, totalPages, slideW, slideH);
}

// 渲染内容页
function renderContentPage(slide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages) {
  addRect(slide, 0, 0, slideW, 0.08, primaryColor);

  // 页面标题
  const title = page.sectionNum ? `${page.sectionNum}  ${page.title}` : page.title;
  addTextBox(slide, 0.8, 0.4, 10, 0.7, {
    text: title,
    fontSize: 28,
    bold: true,
    color: secondaryColor
  });

  // 内容区域
  if (page.sections) {
    let y = 1.3;
    page.sections.forEach(section => {
      // 卡片背景
      addRect(slide, 0.6, y, 5.8, 2.2, COLORS.WHITE);
      // 卡片标题
      addTextBox(slide, 0.9, y + 0.15, 5.3, 0.5, {
        text: section.title,
        fontSize: 18,
        bold: true,
        color: primaryColor
      });
      // 卡片内容
      const content = section.content || [];
      const text = content.map(c => `• ${c}`).join('\n');
      addTextBox(slide, 0.9, y + 0.7, 5.3, 1.8, {
        text,
        fontSize: 13,
        color: COLORS.TEXT_DARK,
        valign: 'top'
      });
      y += 2.5;
    });
  }

  // KPI展示
  if (page.kpis) {
    page.kpis.forEach((kpi, i) => {
      const x = 1.0 + i * 2.8;
      addRect(slide, x, 5.2, 2.5, 1.3, secondaryColor);
      addTextBox(slide, x, 5.35, 2.5, 0.7, {
        text: kpi.value,
        fontSize: 28,
        bold: true,
        color: COLORS.WHITE,
        align: 'center'
      });
      addTextBox(slide, x, 6.0, 2.5, 0.4, {
        text: kpi.label,
        fontSize: 12,
        color: 'CCCCCC',
        align: 'center'
      });
    });
  }

  addPageNumber(slide, slideIndex, totalPages, slideW, slideH);
}

// 渲染双栏页
function renderTwoColumnPage(slide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages) {
  addRect(slide, 0, 0, slideW, 0.08, primaryColor);

  const title = page.sectionNum ? `${page.sectionNum}  ${page.title}` : page.title;
  addTextBox(slide, 0.8, 0.4, 10, 0.7, {
    text: title,
    fontSize: 28,
    bold: true,
    color: secondaryColor
  });

  const columns = page.columns || [];
  const colWidth = (slideW - 1.6) / (columns.length || 2);

  columns.forEach((col, i) => {
    const x = 0.6 + i * colWidth;
    addRect(slide, x, 1.2, colWidth - 0.2, 5.8, COLORS.WHITE);

    // 栏标题背景
    addRect(slide, x, 1.2, colWidth - 0.2, 0.6, secondaryColor);
    addTextBox(slide, x, 1.3, colWidth - 0.2, 0.5, {
      text: col.title,
      fontSize: 16,
      bold: true,
      color: COLORS.WHITE,
      align: 'center'
    });

    // 内容
    const items = col.items || [];
    items.forEach((item, j) => {
      const y = 2.0 + j * 0.5;
      addTextBox(slide, x + 0.2, y, colWidth - 0.5, 0.5, {
        text: `• ${item}`,
        fontSize: 13,
        color: COLORS.TEXT_DARK
      });
    });
  });

  addPageNumber(slide, slideIndex, totalPages, slideW, slideH);
}

// 渲染卡片页
function renderCardsPage(slide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages) {
  addRect(slide, 0, 0, slideW, 0.08, primaryColor);

  const title = page.sectionNum ? `${page.sectionNum}  ${page.title}` : page.title;
  addTextBox(slide, 0.8, 0.4, 10, 0.7, {
    text: title,
    fontSize: 28,
    bold: true,
    color: secondaryColor
  });

  const cards = page.cards || [];
  const cardW = (slideW - 1.6) / Math.min(cards.length, 3) - 0.3;
  const cardH = 4.5;

  cards.forEach((card, i) => {
    const cols = Math.min(cards.length, 3);
    const totalCardW = (slideW - 1.6);
    const eachCardW = totalCardW / cols;
    const x = 0.6 + i * eachCardW;
    const y = 1.2;

    // 卡片背景
    addRect(slide, x, y, eachCardW - 0.2, cardH, COLORS.WHITE);

    // 顶部色块
    addRect(slide, x, y, eachCardW - 0.2, 1.0, secondaryColor);

    // 标题
    addTextBox(slide, x, y + 0.15, eachCardW - 0.2, 0.6, {
      text: card.title,
      fontSize: 18,
      bold: true,
      color: COLORS.WHITE,
      align: 'center'
    });

    // 标签
    if (card.tag) {
      addTextBox(slide, x, y + 0.6, eachCardW - 0.2, 0.4, {
        text: card.tag,
        fontSize: 12,
        color: 'CCCCCC',
        align: 'center'
      });
    }

    // 描述
    if (card.description) {
      addTextBox(slide, x + 0.2, y + 1.2, eachCardW - 0.5, 0.5, {
        text: card.description,
        fontSize: 14,
        color: COLORS.TEXT_GRAY,
        align: 'center'
      });
    }

    // 价格
    if (card.price) {
      addTextBox(slide, x, y + 1.8, eachCardW - 0.2, 0.5, {
        text: card.price,
        fontSize: 16,
        bold: true,
        color: primaryColor,
        align: 'center'
      });
    }

    // 特性列表
    const features = card.features || [];
    features.forEach((feat, j) => {
      const yFeat = y + 2.4 + j * 0.45;
      // 小红点
      addRect(slide, x + 0.3, yFeat + 0.08, 0.08, 0.3, primaryColor);
      addTextBox(slide, x + 0.5, yFeat, eachCardW - 0.8, 0.45, {
        text: feat,
        fontSize: 12,
        color: COLORS.TEXT_DARK
      });
    });
  });

  addPageNumber(slide, slideIndex, totalPages, slideW, slideH);
}

// 渲染时间线页
function renderTimelinePage(slide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages) {
  addRect(slide, 0, 0, slideW, 0.08, primaryColor);

  const title = page.sectionNum ? `${page.sectionNum}  ${page.title}` : page.title;
  addTextBox(slide, 0.8, 0.4, 10, 0.7, {
    text: title,
    fontSize: 28,
    bold: true,
    color: secondaryColor
  });

  const phases = page.phases || [];
  const phaseW = (slideW - 0.8) / Math.min(phases.length, 5);

  phases.forEach((phase, i) => {
    const x = 0.4 + i * phaseW;

    // 月份标签
    addRect(slide, x, 1.2, phaseW - 0.1, 0.55, secondaryColor);
    addTextBox(slide, x, 1.28, phaseW - 0.1, 0.45, {
      text: phase.month,
      fontSize: 14,
      bold: true,
      color: COLORS.WHITE,
      align: 'center'
    });

    // 阶段名称
    addRect(slide, x, 1.75, phaseW - 0.1, 0.4, primaryColor);
    addTextBox(slide, x, 1.8, phaseW - 0.1, 0.35, {
      text: phase.name,
      fontSize: 12,
      bold: true,
      color: COLORS.WHITE,
      align: 'center'
    });

    // 任务列表
    addRect(slide, x, 2.15, phaseW - 0.1, 4.5, COLORS.LIGHT_GRAY);
    const tasks = phase.tasks || [];
    tasks.forEach((task, j) => {
      addTextBox(slide, x + 0.1, 2.35 + j * 0.8, phaseW - 0.3, 0.7, {
        text: `• ${task}`,
        fontSize: 11,
        color: COLORS.TEXT_DARK,
        valign: 'top'
      });
    });
  });

  addPageNumber(slide, slideIndex, totalPages, slideW, slideH);
}

// 渲染结束页
function renderEndPage(slide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages) {
  addRect(slide, 0, 0, slideW, 0.08, primaryColor);

  // 大标题
  addTextBox(slide, 1, slideH / 2 - 1.5, slideW - 2, 1, {
    text: page.mainText || '感谢观看',
    fontSize: 48,
    bold: true,
    color: secondaryColor,
    align: 'center'
  });

  // 英文
  if (page.subText) {
    addTextBox(slide, 1, slideH / 2 - 0.3, slideW - 2, 0.5, {
      text: page.subText,
      fontSize: 18,
      color: COLORS.TEXT_GRAY,
      align: 'center'
    });
  }

  // 品牌
  if (page.brand) {
    addTextBox(slide, 1, slideH / 2 + 0.5, slideW - 2, 0.5, {
      text: page.brand,
      fontSize: 14,
      color: '999999',
      align: 'center'
    });
  }
}

// 通用页面渲染
function renderGenericPage(slide, page, primaryColor, secondaryColor, slideW, slideH, slideIndex, totalPages) {
  addRect(slide, 0, 0, slideW, 0.08, primaryColor);

  const title = page.sectionNum ? `${page.sectionNum}  ${page.title}` : page.title;
  addTextBox(slide, 0.8, 0.4, 10, 0.7, {
    text: title,
    fontSize: 28,
    bold: true,
    color: secondaryColor
  });

  // 通用内容
  if (page.content) {
    const lines = Array.isArray(page.content) ? page.content : [page.content];
    lines.forEach((line, i) => {
      addTextBox(slide, 0.8, 1.5 + i * 0.6, slideW - 1.6, 0.6, {
        text: `• ${line}`,
        fontSize: 16,
        color: COLORS.TEXT_DARK
      });
    });
  }

  addPageNumber(slide, slideIndex, totalPages, slideW, slideH);
}

module.exports = {
  generatePPT,
  COLORS
};
