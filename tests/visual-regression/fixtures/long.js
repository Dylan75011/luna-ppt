// 长 fixture：覆盖大多数 layout 与 composition 类型，模拟一份完整提案的真实页面分布。
// 不放真实业务文案，但页数、字段密度跟实际产物相近。

module.exports = {
  title: '长 fixture - 完整提案',
  globalStyle: 'dark_tech',
  theme: { primary: '1A1A1A', secondary: '0F172A', brand: 'AURORA', date: '2026-09-20' },
  pages: [
    {
      layout: 'immersive_cover', style: 'dark_tech',
      title: 'AURORA 2026 全球品牌焕新发布会',
      subtitle: 'Reframe the Way We Move',
      brand: 'AURORA', date: '2026-09-20', location: 'Beijing · 798 Art Zone',
    },
    {
      layout: 'toc', style: 'dark_tech', title: '目录',
      items: [
        { title: '品牌叙事' }, { title: '战略亮点' }, { title: '现场体验' },
        { title: '执行节奏' }, { title: '预算分配' }, { title: 'KPI 与效果预期' },
      ],
    },
    {
      layout: 'editorial_quote', style: 'dark_tech', composition: 'annotation-runway',
      title: '品牌叙事',
      regions: [
        { name: 'header', x: 8, y: 12, w: 30, h: 18, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
        { name: 'quote', x: 8, y: 40, w: 38, h: 28, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
        { name: 'facts', x: 58, y: 18, w: 30, h: 44, stack: 'vertical', gap: 12, align: 'stretch', valign: 'start' },
      ],
      textBlocks: [
        { region: 'header', kind: 'eyebrow', text: 'STRATEGY' },
        { region: 'header', kind: 'title', text: '让品牌主张走在产品之前' },
        { region: 'quote', kind: 'quote', text: '不是更快的车，而是让出行回到生活原本的节奏。', clamp: 3 },
        { region: 'facts', kind: 'fact-list', variant: 'side-notes', items: [
          '品牌主张以"节奏"贯穿全场',
          '产品功能让位于场景叙事',
          '舞台、灯光、音乐协同节拍',
        ] },
      ],
      visualIntent: { role: 'manifesto', density: 'airy', composition: 'editorial' },
      imageStrategy: { useBackground: false },
    },
    {
      layout: 'data_cards', style: 'dark_tech', composition: 'highlights-board',
      title: '战略亮点',
      regions: [
        { name: 'header', x: 7, y: 10, w: 34, h: 18, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
        { name: 'facts', x: 7, y: 32, w: 84, h: 42, stack: 'vertical', gap: 16, align: 'stretch', valign: 'start' },
      ],
      textBlocks: [
        { region: 'header', kind: 'eyebrow', text: 'HIGHLIGHTS' },
        { region: 'header', kind: 'title', text: '六大战略亮点' },
        { region: 'facts', kind: 'fact-list', variant: 'floating-tags', items: [
          '主舞台 360 度沉浸投影', '签到即体验的 VIP 路径',
          '科技装置呼应品牌叙事',  '媒体直播 + 短视频联动',
          '现场限定礼盒收集行为',  '现场到云端的留资闭环',
        ] },
      ],
      visualIntent: { role: 'highlights', density: 'medium', composition: 'mosaic' },
      imageStrategy: { useBackground: false },
    },
    {
      layout: 'asymmetrical_story', style: 'dark_tech', composition: 'editorial-left',
      title: '现场体验',
      regions: [
        { name: 'header', x: 7, y: 12, w: 38, h: 22, stack: 'vertical', gap: 12, align: 'start', valign: 'start' },
        { name: 'body',   x: 7, y: 42, w: 36, h: 24, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
        { name: 'facts',  x: 52, y: 14, w: 38, h: 60, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' },
      ],
      textBlocks: [
        { region: 'header', kind: 'eyebrow', text: 'EXPERIENCE' },
        { region: 'header', kind: 'title', text: '一条故事化的观众动线' },
        { region: 'body', kind: 'body', text: '从外场氛围、签到仪式、主舞台叙事到品牌零售，五个环节衔接自然。' },
        { region: 'facts', kind: 'fact-list', variant: 'side-notes', items: [
          '外场：城市艺术装置预热',
          '签到：礼盒与 VIP 路径分流',
          '主舞台：90 分钟节奏叙事',
          '互动：科技装置呼应主张',
          '收尾：限定零售与社群入口',
        ] },
      ],
      visualIntent: { role: 'section', density: 'medium', composition: 'editorial-left' },
      imageStrategy: { useBackground: false },
    },
    {
      layout: 'timeline_flow', style: 'dark_tech', composition: 'schedule-strip',
      title: '执行节奏',
      regions: [
        { name: 'header', x: 7, y: 8, w: 36, h: 14, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
        { name: 'timeline', x: 7, y: 24, w: 86, h: 60, stack: 'vertical', gap: 0, align: 'stretch', valign: 'stretch' },
      ],
      textBlocks: [
        { region: 'header', kind: 'eyebrow', text: 'TIMELINE' },
        { region: 'header', kind: 'title', text: '从筹备到传播的 12 周节奏' },
        { region: 'timeline', kind: 'timeline', variant: 'editorial-steps', items: [
          { date: 'W1-W3', name: '前期筹备', tasks: ['场地与供应商锁定', '主创团队 kickoff'] },
          { date: 'W4-W7', name: '内容制作', tasks: ['脚本与视觉物料定稿', '艺人与媒体邀约'] },
          { date: 'W8-W10', name: '彩排上线', tasks: ['多轮联排', '直播链路压测'] },
          { date: 'W11', name: '正式发布', tasks: ['现场执行', '直播与媒体二轮'] },
          { date: 'W12', name: '复盘传播', tasks: ['数据复盘', '长尾内容投放'] },
        ] },
      ],
      visualIntent: { role: 'timeline', density: 'medium', composition: 'schedule-strip' },
      imageStrategy: { useBackground: false },
    },
    {
      layout: 'data_cards', style: 'dark_tech', composition: 'budget-table',
      title: '预算分配',
      regions: [
        { name: 'header', x: 7, y: 10, w: 30, h: 16, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
        { name: 'left', x: 7, y: 32, w: 26, h: 50, stack: 'vertical', gap: 12, align: 'stretch', valign: 'start' },
        { name: 'right', x: 38, y: 22, w: 50, h: 56, stack: 'vertical', gap: 12, align: 'stretch', valign: 'start', panel: 'soft' },
      ],
      textBlocks: [
        { region: 'header', kind: 'eyebrow', text: 'BUDGET' },
        { region: 'header', kind: 'title', text: '总预算 ¥ 8,000,000' },
        { region: 'left', kind: 'fact-list', variant: 'compact-notes', items: [
          '场地与基建 · 32%', '内容与视觉 · 24%',
          '艺人与嘉宾 · 18%', '执行与人力 · 14%',
        ] },
        { region: 'right', kind: 'stats', variant: 'ledger', items: [
          { value: '¥ 2,560,000', label: '场地与基建', sub: '32%' },
          { value: '¥ 1,920,000', label: '内容与视觉', sub: '24%' },
          { value: '¥ 1,440,000', label: '艺人与嘉宾', sub: '18%' },
          { value: '¥ 1,120,000', label: '执行与人力', sub: '14%' },
        ] },
      ],
      visualIntent: { role: 'metrics', density: 'compact', composition: 'budget-table' },
      imageStrategy: { useBackground: false },
    },
    {
      layout: 'data_cards', style: 'dark_tech', composition: 'kpi-ledger',
      title: '效果目标',
      regions: [
        { name: 'header', x: 7, y: 10, w: 28, h: 15, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
        { name: 'left', x: 7, y: 32, w: 24, h: 44, stack: 'vertical', gap: 12, align: 'stretch', valign: 'start' },
        { name: 'right', x: 38, y: 22, w: 50, h: 54, stack: 'vertical', gap: 18, align: 'stretch', valign: 'start' },
      ],
      textBlocks: [
        { region: 'header', kind: 'eyebrow', text: 'KPI' },
        { region: 'header', kind: 'title', text: '关键 KPI' },
        { region: 'left', kind: 'stats', variant: 'staggered-notes', items: [
          { value: '500+', label: '邀约嘉宾', sub: 'Target' },
          { value: '10M+', label: '直播曝光', sub: 'Target' },
        ] },
        { region: 'right', kind: 'stats', variant: 'ledger', items: [
          { value: '500+', label: '现场嘉宾人数', sub: 'Target' },
          { value: '10M+', label: '直播总曝光', sub: 'Target' },
          { value: '300+', label: '媒体报道篇数', sub: 'Target' },
          { value: '50K+', label: '社群新增用户', sub: 'Target' },
        ] },
      ],
      visualIntent: { role: 'metrics', density: 'compact', composition: 'kpi-ledger' },
      imageStrategy: { useBackground: false },
    },
    {
      layout: 'end_card', style: 'dark_tech',
      title: '让一次发布，被记住一整年',
      subtitle: 'AURORA · 2026-09-20',
      brand: 'AURORA',
    },
  ],
};
