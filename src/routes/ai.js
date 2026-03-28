// AI生成API
const express = require('express');
const router = express.Router();
const aiAssistant = require('../services/aiAssistant');

// 搜索增强
router.post('/search', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: '请提供搜索关键词'
      });
    }

    const result = await aiAssistant.searchWithTavily(query);

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 生成PPT大纲
router.post('/generate-outline', async (req, res) => {
  try {
    const { topic, templateType } = req.body;

    if (!topic) {
      return res.status(400).json({
        success: false,
        error: '请提供PPT主题'
      });
    }

    const outline = await aiAssistant.generateOutline(topic, templateType || 'simple');

    res.json({
      success: true,
      data: outline
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 智能填充内容
router.post('/fill-content', async (req, res) => {
  try {
    const { pageType, context } = req.body;

    if (!pageType) {
      return res.status(400).json({
        success: false,
        error: '请提供页面类型'
      });
    }

    const content = await aiAssistant.fillPageContent(pageType, context || {});

    res.json({
      success: true,
      data: content
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 一键生成完整PPT
router.post('/generate-full', async (req, res) => {
  try {
    const { topic, templateType } = req.body;

    if (!topic) {
      return res.status(400).json({
        success: false,
        error: '请提供PPT主题'
      });
    }

    const pptData = await aiAssistant.generateFullPPT(topic, templateType || 'simple');

    res.json({
      success: true,
      data: pptData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
