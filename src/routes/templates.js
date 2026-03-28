// 模板管理API
const express = require('express');
const router = express.Router();
const templateManager = require('../services/templateManager');

// 获取所有模板列表
router.get('/', (req, res) => {
  try {
    const templates = templateManager.getTemplates();
    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取模板详情
router.get('/:id', (req, res) => {
  try {
    const template = templateManager.getTemplateById(req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        error: '模板不存在'
      });
    }

    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
