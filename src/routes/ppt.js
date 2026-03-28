// PPT生成API
const express = require('express');
const router = express.Router();
const pptGenerator = require('../services/pptGenerator');
const templateManager = require('../services/templateManager');
const aiAssistant = require('../services/aiAssistant');

// 生成PPT
router.post('/generate', async (req, res) => {
  try {
    const { templateId, data, outputName } = req.body;

    let pptData;

    // 如果指定了模板ID，加载模板
    if (templateId) {
      pptData = templateManager.getTemplateById(templateId);
      if (!pptData) {
        return res.status(404).json({
          success: false,
          error: '模板不存在'
        });
      }
    }

    // 如果提供了数据，合并到模板
    if (data) {
      pptData = pptData ? { ...pptData, ...data } : data;
    }

    // 如果没有数据，返回错误
    if (!pptData) {
      return res.status(400).json({
        success: false,
        error: '请提供模板ID或完整PPT数据'
      });
    }

    // 生成PPT
    const result = await pptGenerator.generatePPT(pptData, outputName);

    res.json({
      success: true,
      data: {
        filename: result.filename,
        filepath: result.filepath,
        downloadUrl: result.path
      }
    });
  } catch (error) {
    console.error('PPT生成失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 预览PPT（返回基本信息）
router.get('/preview/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = require('path').join(require('../config').outputDir, filename);

    if (!require('fs').existsSync(filepath)) {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }

    res.json({
      success: true,
      data: {
        filename,
        size: require('fs').statSync(filepath).size,
        downloadUrl: `/api/files/download/${filename}`
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
