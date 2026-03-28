// 配置文件
module.exports = {
  port: process.env.PORT || 3000,
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  outputDir: process.env.OUTPUT_DIR || './output',
  templatesDir: './src/templates'
};
