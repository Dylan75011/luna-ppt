// OpenClaw PPT Editor - Main Application
const API_BASE = '/api';

// 状态管理
const state = {
  templates: [],
  selectedTemplate: null,
  currentTemplateData: null,
  generatedFiles: []
};

// DOM元素
const elements = {
  templateGrid: null,
  editorSection: null,
  aiTopicInput: null,
  aiResult: null,
  fileList: null,
  generateBtn: null
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initElements();
  loadTemplates();
  loadFiles();
  bindEvents();
});

// 获取DOM元素
function initElements() {
  elements.templateGrid = document.getElementById('templateGrid');
  elements.editorSection = document.getElementById('editorSection');
  elements.aiTopicInput = document.getElementById('aiTopicInput');
  elements.aiResult = document.getElementById('aiResult');
  elements.fileList = document.getElementById('fileList');
  elements.generateBtn = document.getElementById('generateBtn');
}

// 绑定事件
function bindEvents() {
  // AI生成按钮
  document.getElementById('aiGenerateBtn')?.addEventListener('click', generateWithAI);

  // 生成PPT按钮
  elements.generateBtn?.addEventListener('click', generatePPT);

  // 回车键触发AI生成
  elements.aiTopicInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      generateWithAI();
    }
  });
}

// 加载模板列表
async function loadTemplates() {
  try {
    const response = await fetch(`${API_BASE}/templates`);
    const result = await response.json();

    if (result.success) {
      state.templates = result.data;
      renderTemplates();
    }
  } catch (error) {
    showToast('加载模板失败: ' + error.message, 'error');
  }
}

// 渲染模板卡片
function renderTemplates() {
  const templateIcons = {
    auto_show: '🚗',
    product_launch: '🚀',
    business_plan: '💼',
    meeting: '📋',
    simple: '📄'
  };

  elements.templateGrid.innerHTML = state.templates.map(template => `
    <div class="template-card" data-id="${template.id}">
      <div class="template-icon">${templateIcons[template.id] || '📄'}</div>
      <div class="template-name">${template.name}</div>
      <div class="template-desc">${template.description}</div>
    </div>
  `).join('');

  // 绑定点击事件
  document.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => selectTemplate(card.dataset.id));
  });
}

// 选择模板
async function selectTemplate(templateId) {
  // 更新选中状态
  document.querySelectorAll('.template-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.id === templateId);
  });

  state.selectedTemplate = templateId;

  // 加载模板详情
  try {
    const response = await fetch(`${API_BASE}/templates/${templateId}`);
    const result = await response.json();

    if (result.success) {
      state.currentTemplateData = result.data;
      showEditor();
    }
  } catch (error) {
    showToast('加载模板失败: ' + error.message, 'error');
  }
}

// 显示编辑器
function showEditor() {
  elements.editorSection.classList.remove('hidden');
  renderEditor();
}

// 渲染编辑器内容
function renderEditor() {
  const template = state.currentTemplateData;
  if (!template) return;

  // 更新标题
  document.getElementById('editorTitle').textContent = `编辑: ${template.name}`;

  // 渲染页面列表
  const pageList = document.getElementById('pageList');
  if (pageList && template.pages) {
    pageList.innerHTML = template.pages.map((page, index) => `
      <div class="page-item" data-index="${index}">
        <div class="page-number">${index + 1}</div>
        <div class="page-title">${page.title || page.mainTitle || '未命名页面'}</div>
        <div class="page-type">${getPageTypeName(page.type)}</div>
      </div>
    `).join('');
  }
}

// 获取页面类型名称
function getPageTypeName(type) {
  const typeNames = {
    cover: '封面',
    toc: '目录',
    content: '内容',
    two_column: '双栏',
    cards: '卡片',
    timeline: '时间线',
    end: '结束'
  };
  return typeNames[type] || type;
}

// AI生成
async function generateWithAI() {
  const topic = elements.aiTopicInput.value.trim();
  if (!topic) {
    showToast('请输入PPT主题', 'error');
    return;
  }

  const btn = document.getElementById('aiGenerateBtn');
  const originalText = btn.textContent;
  btn.textContent = '生成中...';
  btn.disabled = true;

  try {
    const response = await fetch(`${API_BASE}/ai/generate-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        templateType: state.selectedTemplate || 'simple'
      })
    });

    const result = await response.json();

    if (result.success) {
      state.currentTemplateData = result.data;
      elements.aiResult.innerHTML = `
        <strong>生成的PPT大纲:</strong><br><br>
        标题: ${result.data.title}<br>
        页面数: ${result.data.pages?.length || 0}<br>
        ${result.data.searchResults ? '<br><strong>搜索结果:</strong><br>' + result.data.searchResults.map(r => `• ${r.title}`).join('<br>') : ''}
      `;
      elements.aiResult.classList.add('show');
      showEditor();
      showToast('AI生成成功，请编辑后生成PPT', 'success');
    } else {
      showToast(result.error || '生成失败', 'error');
    }
  } catch (error) {
    showToast('AI生成失败: ' + error.message, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// 生成PPT
async function generatePPT() {
  if (!state.currentTemplateData) {
    showToast('请先选择模板或使用AI生成', 'error');
    return;
  }

  const btn = elements.generateBtn;
  const originalText = btn.textContent;
  btn.innerHTML = '<span class="loading"></span> 生成中...';
  btn.disabled = true;

  try {
    const response = await fetch(`${API_BASE}/ppt/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: state.currentTemplateData,
        outputName: `PPT_${Date.now()}.pptx`
      })
    });

    const result = await response.json();

    if (result.success) {
      showToast('PPT生成成功！', 'success');
      loadFiles();

      // 显示下载链接
      const downloadUrl = result.data.downloadUrl;
      setTimeout(() => {
        window.open(downloadUrl, '_blank');
      }, 500);
    } else {
      showToast(result.error || '生成失败', 'error');
    }
  } catch (error) {
    showToast('生成失败: ' + error.message, 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

// 加载文件列表
async function loadFiles() {
  try {
    const response = await fetch(`${API_BASE}/files/list`);
    const result = await response.json();

    if (result.success) {
      state.generatedFiles = result.data;
      renderFiles();
    }
  } catch (error) {
    console.error('加载文件列表失败:', error);
  }
}

// 渲染文件列表
function renderFiles() {
  if (!elements.fileList) return;

  if (state.generatedFiles.length === 0) {
    elements.fileList.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">暂无生成的文件</p>';
    return;
  }

  elements.fileList.innerHTML = state.generatedFiles.map(file => `
    <div class="file-item">
      <div class="file-info">
        <div class="file-icon">📊</div>
        <div>
          <div class="file-name">${file.filename}</div>
          <div class="file-meta">${formatFileSize(file.size)} · ${formatDate(file.created)}</div>
        </div>
      </div>
      <div>
        <a href="${file.downloadUrl}" class="btn btn-primary" download>下载</a>
      </div>
    </div>
  `).join('');
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 格式化日期
function formatDate(date) {
  return new Date(date).toLocaleString('zh-CN');
}

// 显示提示
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}
