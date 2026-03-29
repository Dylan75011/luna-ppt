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
  minimaxModel: process.env.MINIMAX_MODEL || 'MiniMax-M2.5',

  // DeepSeek（按量，仅 Critic Agent）
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  deepseekReasonerModel: process.env.DEEPSEEK_REASONER_MODEL || 'deepseek-reasoner',

  // 评审配置
  criticPassScore: parseFloat(process.env.CRITIC_PASS_SCORE || '7.0'),
  criticMaxRounds: parseInt(process.env.CRITIC_MAX_ROUNDS || '3', 10),

  // Pexels 图片搜索
  pexelsApiKey: process.env.PEXELS_API_KEY || 'PicqD7mq8tG2jFWuJ2E18DbTDDhq54ycV8Pvp9fxTAY0HjzK9RhdFVxW'
};
