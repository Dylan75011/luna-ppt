// 短 fixture：4 页（封面 / 目录 / 1 个章节内容 / 结尾）。
// 用于验证最常见的渲染路径：immersive_cover / toc / asymmetrical_story / end_card。

module.exports = {
  title: '短 fixture - 简洁发布会',
  globalStyle: 'dark_tech',
  theme: { primary: '1A1A1A', secondary: '0F172A', brand: 'NOVA', date: '2026-06-15' },
  pages: [
    {
      layout: 'immersive_cover',
      style: 'dark_tech',
      title: 'NOVA 2026 春季新品发布',
      subtitle: 'A New Chapter in Smart Mobility',
      brand: 'NOVA',
      date: '2026-06-15',
      location: 'Shanghai Launch Hall',
    },
    {
      layout: 'toc',
      style: 'dark_tech',
      title: '目录',
      items: [
        { title: '活动概述' },
        { title: '核心亮点' },
        { title: '执行计划' },
        { title: '预算与 KPI' },
      ],
    },
    {
      layout: 'asymmetrical_story',
      style: 'dark_tech',
      composition: 'editorial-left',
      title: '核心亮点',
      regions: [
        { name: 'header', x: 7, y: 12, w: 38, h: 22, stack: 'vertical', gap: 12, align: 'start', valign: 'start' },
        { name: 'body',   x: 7, y: 40, w: 36, h: 22, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
        { name: 'facts',  x: 52, y: 14, w: 38, h: 60, stack: 'vertical', gap: 10, align: 'stretch', valign: 'start' },
      ],
      textBlocks: [
        { region: 'header', kind: 'eyebrow', text: 'HIGHLIGHTS' },
        { region: 'header', kind: 'title', text: '一场让品牌价值升维的发布会' },
        { region: 'body', kind: 'body', text: '把产品力、科技力、品牌力三条主线在 90 分钟内拧成一股劲。' },
        { region: 'facts', kind: 'fact-list', variant: 'side-notes', items: [
          '主舞台 LED + 全息一体投影',
          '签到礼盒与 VIP 体验动线分流',
          '互动装置呼应品牌主张',
          '直播 + 短视频双链路同步',
        ] },
      ],
      visualIntent: { role: 'highlights', density: 'medium', composition: 'editorial-left' },
      imageStrategy: { useBackground: false },
    },
    {
      layout: 'end_card',
      style: 'dark_tech',
      title: '谢谢观看',
      subtitle: 'See you on stage.',
      brand: 'NOVA',
    },
  ],
};
