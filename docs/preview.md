# PPT 预览系统设计

## 设计原则

`previewRenderer.js` 与 `pptGenerator.js` 共用**同一份 PPT JSON**，只是输出格式不同：
- `pptGenerator.js` → `.pptx` 文件（下载用）
- `previewRenderer.js` → HTML 幻灯片数组（浏览器预览用）

两者输入完全相同，保证预览所见即所得。

---

## previewData 数据格式

`done` 事件中 `previewData` 字段的完整 Schema：

```json
{
  "title": "[品牌] [活动名称] 策划方案",
  "theme": {
    "primary": "FF6B00",
    "secondary": "1A1A1A"
  },
  "totalPages": 12,
  "pages": [
    {
      "index": 0,
      "type": "cover",
      "mainTitle": "[品牌名]",
      "subtitle": "[活动名称] 策划方案",
      "date": "[活动日期]",
      "location": "[活动地点]"
    },
    {
      "index": 1,
      "type": "toc",
      "items": [
        { "num": "01", "title": "项目背景与目标" },
        { "num": "02", "title": "核心策略" }
      ]
    },
    {
      "index": 2,
      "type": "content",
      "title": "项目背景与目标",
      "sectionNum": "01",
      "sections": [
        { "title": "核心目标", "content": ["目标1", "目标2"] }
      ],
      "kpis": [
        { "value": "500+", "label": "预计到场人数" }
      ]
    },
    {
      "index": 3,
      "type": "two_column",
      "title": "竞品对比分析",
      "left":  { "title": "我方优势", "points": ["优势1", "优势2"] },
      "right": { "title": "市场机会", "points": ["机会1", "机会2"] }
    },
    {
      "index": 4,
      "type": "cards",
      "title": "三大活动亮点",
      "cards": [
        { "icon": "🎯", "title": "亮点标题", "desc": "描述内容" }
      ]
    },
    {
      "index": 5,
      "type": "timeline",
      "title": "执行时间线",
      "phases": [
        { "date": "第1周", "title": "筹备阶段", "desc": "场地确认、物料准备" }
      ]
    },
    {
      "index": 11,
      "type": "end",
      "brand": "[品牌名]",
      "tagline": "[活动口号]",
      "contact": "[联系信息，可选]"
    }
  ]
}
```

> `previewData` 与传入 `pptGenerator.js` 的 JSON 结构完全一致，仅多一个 `index` 字段（前端翻页用）。

---

## previewRenderer.js 规格

### 接口

```js
/**
 * 将 PPT JSON 转为 HTML 幻灯片数组
 * @param {Object} pptData  - 与 pptGenerator 相同的输入 JSON
 * @returns {string[]}      - 每个元素是一张幻灯片的 HTML 字符串
 */
function renderToHtml(pptData) { ... }

module.exports = { renderToHtml }
```

### 输出格式

返回 `string[]`，数组长度 = 幻灯片总页数，每个元素：

```html
<div class="slide slide-cover" data-index="0"
     style="--primary: #FF6B00; --secondary: #1A1A1A;">
  <!-- 页面内容 -->
</div>
```

- 使用 CSS 变量 `--primary` / `--secondary` 注入品牌色，无需内联样式
- 每张幻灯片固定尺寸 **960 × 540px**（16:9），前端通过 `transform: scale()` 适配屏幕

### 7种页面类型 → HTML 映射

| type | HTML 结构 |
|---|---|
| `cover` | 全屏背景色块 + 居中大标题 + 副标题 + 底部日期/地点信息栏 |
| `toc` | 左侧品牌色竖线 + 右侧目录列表（编号 + 标题） |
| `content` | 顶部章节编号标题栏 + 左侧要点列表 + 右侧 KPI 数据块（若有） |
| `two_column` | 顶部标题 + 左右等宽两栏，各有小标题和要点列表 |
| `cards` | 顶部标题 + 横排 3-4 张卡片，每张含图标/标题/描述 |
| `timeline` | 顶部标题 + 横向时间轴，节点含日期/标题/描述 |
| `end` | 全屏品牌色背景 + 居中品牌名 + 活动口号 + 底部联系方式 |

### 样式约定

```css
/* 每张幻灯片固定尺寸 */
.slide {
  width: 960px;
  height: 540px;
  position: relative;
  overflow: hidden;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: #fff;
  color: #1A1A1A;
}

/* 品牌色通过 CSS 变量注入 */
.slide-cover       { background: var(--primary); color: #fff; }
.slide-end         { background: var(--primary); color: #fff; }
.slide-toc .accent { color: var(--primary); border-color: var(--primary); }
```

---

## 前端预览组件设计

### 布局结构

```
┌─────────────────────────────────────────────┐
│  [←]  幻灯片主展示区（16:9 自适应缩放）  [→] │
│                                             │
│         960×540 → transform:scale()        │
│                                             │
├─────────────────────────────────────────────┤
│  [全屏] [下载PPTX]    3 / 12    缩略图导航  │
└─────────────────────────────────────────────┘
```

### 三个交互区域

**1. 幻灯片主展示区**
- 容器宽度 100%，高度自适应保持 16:9
- `transform: scale(containerWidth / 960)` 等比缩放
- 左右箭头按钮（悬浮在边缘）

**2. 底部控制栏**
- 左侧：全屏按钮、下载 PPTX 按钮
- 中间：当前页 / 总页数（如 `3 / 12`）
- 右侧：缩略图横向滚动条（点击跳转）

**3. 缩略图条**
- 每张缩略图 120 × 68px（16:9）
- 当前页高亮边框（品牌主色）
- 超出宽度横向滚动，当前页自动滚入可视区

### 键盘快捷键

| 按键 | 功能 |
|---|---|
| `←` / `→` | 上一页 / 下一页 |
| `F` | 进入/退出全屏 |
| `ESC` | 退出全屏 |
| `Home` / `End` | 跳到第一页 / 最后一页 |

### 全屏模式

调用浏览器原生 `requestFullscreen()` API，无需自己实现遮罩。全屏时：
- 黑色背景
- 幻灯片居中展示，`scale()` 重新计算适配屏幕高度
- 控制栏保留在底部，鼠标静止 3 秒后淡出，移动时重新显示

### 生成流程中的预览时机

```
done 事件到达
  │
  ├─ 取 previewData.pages → 渲染全部缩略图
  ├─ 展示第 1 页为当前页
  └─ 显示"下载 PPTX"按钮（downloadUrl）

用户翻页时
  └─ 直接读取已渲染好的 HTML，无需再请求后端
```

---

## previewRenderer 与 pptGenerator 共用数据说明

```
用户输入
    │
    ▼
PPT Builder Agent 输出 pptData（JSON）
    │
    ├──▶ pptGenerator.js(pptData)  →  output/xxx.pptx（下载）
    └──▶ renderToHtml(pptData)     →  slides[]（浏览器预览）
```

两个函数使用**完全相同的输入**，只是消费方式不同。这样保证：
- 修改内容时，预览和最终 PPTX 同步更新
- 不需要维护两套数据格式
