// 模板管理服务
const fs = require('fs');
const path = require('path');
const config = require('../config');

// 获取所有模板列表
function getTemplates() {
  const templates = [];

  // 预定义模板列表
  const templateFiles = [
    'auto_show.json',
    'product_launch.json',
    'business_plan.json',
    'meeting.json',
    'simple.json'
  ];

  templateFiles.forEach(filename => {
    const filepath = path.join(__dirname, '../templates', filename);
    if (fs.existsSync(filepath)) {
      try {
        const template = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        templates.push({
          id: template.id,
          name: template.name,
          description: template.description,
          thumbnail: template.thumbnail || null
        });
      } catch (e) {
        console.error(`Error loading template ${filename}:`, e);
      }
    }
  });

  return templates;
}

// 获取模板详情
function getTemplateById(id) {
  const filepath = path.join(__dirname, '../templates', `${id}.json`);

  if (!fs.existsSync(filepath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`Error loading template ${id}:`, e);
    return null;
  }
}

// 保存用户自定义模板
function saveCustomTemplate(templateData) {
  const id = `custom_${Date.now()}`;
  const filepath = path.join(__dirname, '../templates', `${id}.json`);

  fs.writeFileSync(filepath, JSON.stringify(templateData, null, 2));

  return { id, filepath };
}

module.exports = {
  getTemplates,
  getTemplateById,
  saveCustomTemplate
};
