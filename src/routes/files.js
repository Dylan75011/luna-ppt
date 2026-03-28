// 文件API
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const config = require('../config');

// 下载文件
router.get('/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(config.outputDir, filename);

    // 安全检查：确保文件在输出目录内
    const resolvedPath = path.resolve(filepath);
    const resolvedOutputDir = path.resolve(config.outputDir);

    if (!resolvedPath.startsWith(resolvedOutputDir)) {
      return res.status(403).json({
        success: false,
        error: '禁止访问'
      });
    }

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }

    res.download(filepath, filename);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 列出生成的文件
router.get('/list', (req, res) => {
  try {
    const outputDir = path.resolve(config.outputDir);

    if (!fs.existsSync(outputDir)) {
      return res.json({
        success: true,
        data: []
      });
    }

    const files = fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.pptx'))
      .map(f => {
        const filepath = path.join(outputDir, f);
        const stats = fs.statSync(filepath);
        return {
          filename: f,
          size: stats.size,
          created: stats.birthtime,
          downloadUrl: `/api/files/download/${f}`
        };
      });

    res.json({
      success: true,
      data: files
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 删除文件
router.delete('/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(config.outputDir, filename);

    // 安全检查
    const resolvedPath = path.resolve(filepath);
    const resolvedOutputDir = path.resolve(config.outputDir);

    if (!resolvedPath.startsWith(resolvedOutputDir)) {
      return res.status(403).json({
        success: false,
        error: '禁止访问'
      });
    }

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }

    fs.unlinkSync(filepath);

    res.json({
      success: true,
      message: '文件已删除'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
