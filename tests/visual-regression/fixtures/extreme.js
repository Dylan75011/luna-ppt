// 极端 fixture：触发字体/版式系统的边角 case，用于测试 overflow guard 与字体稳定性。
// 故意做的事：
//  - 极长 CJK 标题（撞 region 边界）
//  - 中英混排（字宽估算最容易出错的场景）
//  - 8 项很长的 fact-list 塞进 22% region（强制触发 overflow guard）
//  - quote 超长 + 没设 clamp（测 stabilizePages 兜底）

module.exports = {
  title: '极端 fixture - 边角 case 测试',
  globalStyle: 'dark_tech',
  theme: { primary: '1A1A1A', secondary: '0F172A', brand: 'EXTREME', date: '2026-12-31' },
  pages: [
    {
      layout: 'immersive_cover',
      style: 'dark_tech',
      title: 'EXTREME 2026 全球品牌战略与产品发布会暨年度生态合作伙伴峰会',
      subtitle: 'Where Brand, Product, Tech & Ecosystem Converge',
      brand: 'EXTREME',
      date: '2026-12-31',
      location: 'Shenzhen Bay International Center',
    },
    {
      layout: 'editorial_quote',
      style: 'dark_tech',
      composition: 'manifesto-center',
      title: '品牌宣言',
      regions: [
        { name: 'header', x: 8, y: 12, w: 30, h: 18, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
        { name: 'quote', x: 8, y: 38, w: 44, h: 30, stack: 'vertical', gap: 10, align: 'start', valign: 'start' },
        { name: 'facts', x: 60, y: 22, w: 28, h: 44, stack: 'vertical', gap: 12, align: 'stretch', valign: 'start' },
      ],
      textBlocks: [
        { region: 'header', kind: 'eyebrow', text: 'MANIFESTO 2026' },
        { region: 'header', kind: 'title', text: '让产品退后一步，让品牌主张走在前' },
        // 故意超长 quote，配合 mixed CJK / Latin / 数字
        { region: 'quote', kind: 'quote', text: 'In 2026 we choose narrative over spec sheet — 把每一项功能放回它服务的生活场景里，而不是停留在 PPT 上的指标对比。让发布会回到"为什么"的层面，而不是"是什么"。' },
        { region: 'facts', kind: 'fact-list', variant: 'side-notes', items: [
          '每一处技术更新都对应一个生活场景',
          '不在台上反复念参数与数字',
          '让用户的故事替代品牌的口号',
        ] },
      ],
      visualIntent: { role: 'manifesto', density: 'airy', composition: 'editorial' },
      imageStrategy: { useBackground: false },
    },
    {
      // 强制触发 overflow guard：22% h 的 facts region 塞 8 长项
      layout: 'asymmetrical_story',
      style: 'dark_tech',
      composition: 'editorial-left',
      title: '执行核心要点',
      regions: [
        { name: 'header', x: 7, y: 8, w: 38, h: 14, stack: 'vertical', gap: 8, align: 'start', valign: 'start' },
        { name: 'facts',  x: 50, y: 12, w: 38, h: 22, stack: 'vertical', gap: 6, align: 'start', valign: 'start' },
      ],
      textBlocks: [
        { region: 'header', kind: 'eyebrow', text: 'EXECUTION' },
        { region: 'header', kind: 'title', text: '执行核心要点', size: 28 },
        { region: 'facts', kind: 'fact-list', variant: 'editorial-list', clamp: 4, items: [
          '这是第一条非常长的执行要点，需要明确预算分配、人员配置以及时间节点',
          '这是第二条非常长的执行要点，涉及主舞台、签到区、互动展区、媒体区四个分区',
          '这是第三条非常长的执行要点，要协调音视频、灯光、装置和现场动线',
          '这是第四条非常长的执行要点，关注嘉宾接待、媒体接待和 VIP 接待动线',
          '这是第五条非常长的执行要点，备份方案要覆盖技术失败、突发天气、舆情风险',
          '这是第六条非常长的执行要点，涉及活动后续传播节奏、媒体二轮、用户复盘',
          '这是第七条非常长的执行要点，涉及活动整体回顾报告与归档资料整理',
          '这是第八条非常长的执行要点，涉及活动核心 KPI 数据汇总与下次活动改进点',
        ] },
      ],
      visualIntent: { role: 'highlights', density: 'medium', composition: 'editorial-left' },
      imageStrategy: { useBackground: false },
    },
    {
      layout: 'end_card',
      style: 'dark_tech',
      title: '让一场发布会，跨越行业的所有边界',
      subtitle: 'EXTREME · 2026-12-31 · Shenzhen Bay',
      brand: 'EXTREME',
    },
  ],
};
