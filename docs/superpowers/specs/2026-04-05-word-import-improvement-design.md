# Word 文档导入格式还原优化方案

**日期**: 2026-04-05
**状态**: 已批准

## 背景

当前文档空间使用 `mammoth` 库将 Word 文档转换为 HTML，格式还原较差，主要丢失：图片、表格样式、字体规格、段落格式等。用户要求导入后所见即所得，内容可编辑。

## 设计目标

1. **完整样式还原** - 支持图片、表格、字体、颜色、段落格式
2. **可编辑性** - 导入后内容在 NotionEditor 中可直接编辑
3. **样式一致性** - 导入后的内容保持统一美观

## 技术方案

### 核心库替换

| 组件 | 当前 | 改进后 |
|------|------|--------|
| Word 解析 | mammoth | docx-preview |
| 编辑器 | Tiptap | Tiptap（增强扩展） |

### 实现路径

```
.docx → docx-preview 渲染 → 提取 DOM → 转换为 Tiptap JSON → 存储
```

### 关键改进点

| 功能 | 当前 | 改进后 |
|------|------|--------|
| 图片 | 不支持 | ✅ Base64/Blob 支持 |
| 表格 | 基础转 HTML | ✅ 边框、合并单元格、对齐 |
| 字体 | 丢失 | ✅ 字号、颜色、粗细、斜体 |
| 段落 | 丢失 | ✅ 缩进、行高、间距、对齐 |
| 高亮 | 基础 | ✅ 背景色、文本色 |
| 列表 | 基础 | ✅ 多级列表、缩进 |

## 文件变更

### 新增
- `src/services/docxPreviewConverter.js` - docx-preview 封装转换服务

### 修改
- `src/routes/workspace.js` - 导入路由使用新转换器
- `src/services/wordConverter.js` - 保留导出功能，移除导入逻辑
- `package.json` - 添加 docx-preview 依赖
- `frontend/src/components/NotionEditor.vue` - 增强样式扩展

## 实现步骤

1. 添加 docx-preview 依赖
2. 创建 docxPreviewConverter.js 转换服务
3. 修改导入路由使用新转换器
4. 增强 Tiptap 编辑器扩展支持缺失样式
5. 测试验证各种 Word 文档格式还原

## 风险与备选

- 若 docx-preview 与 Tiptap 集成复杂，可采用双模式：导入用 docx-preview 预览，编辑降级为简化样式
