// 配置文件
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  outputDir: process.env.OUTPUT_DIR || './output',
  templatesDir: './src/templates',

  // MiniMax（订阅制，主力）
  minimaxApiKey: process.env.MINIMAX_API_KEY || '',
  minimaxBaseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
  minimaxModel: process.env.MINIMAX_MODEL || 'MiniMax-M2.7-highspeed',

  // DeepSeek V4（按量，Critic Agent + 跨厂商兜底）
  // 旧 alias deepseek-chat / deepseek-reasoner 在 2026-07-24 停服，需迁移到 v4-pro / v4-flash。
  // thinking/non-thinking 模式由 llmClients.js 在请求里显式传 thinking 参数切换，不靠 model id。
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  // Critic Agent：旗舰 1.6T，跑 thinking 模式
  deepseekReasonerModel: process.env.DEEPSEEK_REASONER_MODEL || 'deepseek-v4-pro',
  // brainAgent 跨厂商兜底：284B 快速版，跑 non-thinking 模式
  deepseekChatModel: process.env.DEEPSEEK_CHAT_MODEL || 'deepseek-v4-flash',

  // 兜底开关：默认启用（有 deepseek key 就用），设 'off' 强制走原有的 minimax 软失败
  fallbackProvider: process.env.LUNA_FALLBACK_PROVIDER || 'auto',

  // 评审配置
  criticPassScore: parseFloat(process.env.CRITIC_PASS_SCORE || '7.0'),
  criticMaxRounds: parseInt(process.env.CRITIC_MAX_ROUNDS || '3', 10),

  // 图片搜索优先级：SerpAPI（Bing/百度/谷歌）→ 直接 Bing → Pexels
  bingApiKey:   process.env.BING_API_KEY   || '',
  serpApiKey:   process.env.SERP_API_KEY   || '',
  pexelsApiKey: process.env.PEXELS_API_KEY || 'PicqD7mq8tG2jFWuJ2E18DbTDDhq54ycV8Pvp9fxTAY0HjzK9RhdFVxW',

  // 公网部署时设置此项，所有生成的下载链接将带上完整域名
  // 例如：PUBLIC_BASE_URL=https://your-domain.com 或 http://1.2.3.4:3000
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),

  // 产出物保留策略：避免 output/ 永久膨胀
  // 设为 0 表示该维度不限制
  retention: {
    runsKeep:    parseInt(process.env.RETENTION_RUNS_KEEP     || '20', 10),   // output/runs 最多保留个数
    runsMaxAge:  parseInt(process.env.RETENTION_RUNS_MAX_AGE  || String(7 * 24 * 3600 * 1000), 10), // 7 天
    uploadsKeep: parseInt(process.env.RETENTION_UPLOADS_KEEP  || '50', 10),   // agent-inputs 上传图
    uploadsMaxAge: parseInt(process.env.RETENTION_UPLOADS_MAX_AGE || String(3 * 24 * 3600 * 1000), 10), // 3 天
  }
};
