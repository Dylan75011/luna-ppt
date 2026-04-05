# 活动图设计师角色设计方案

## 背景

当前系统已经具备以下能力：

- `Strategy Agent` 能产出活动策划方案，并给出 `visualTheme`
- `PptBuilderAgent` 能生成页面结构，并为每页输出 `visualIntent` / `imageStrategy`
- `ImageAgent` 能基于 Pexels 搜图，并用 MiniMax 为封面生成一张图
- `PPT` 生成链路已经支持按页注入 `bgImagePath`

但它还缺少一个真正面向活动方案场景的“活动图设计师”角色。现状里的图片能力更像“自动配图”，而不是“根据活动策划意图，为关键页面设计现场效果图并落到 PPT 中”。

这会带来几个问题：

- 图片来源偏素材检索，不够像活动现场效果图
- MiniMax 目前只用于封面，无法覆盖“主视觉页 / 场景演绎页 / 展区页 / 签到页 / 舞台页 / 互动装置页”
- 没有“每页为什么要出图、该出什么图、图里要保留哪些策划信息”的中间设计层
- 无法把“方案语言”稳定转成“生图 prompt 语言”

## 结论

建议新增一个独立角色：`EventVisualDesignerAgent`（活动图设计师）。

不建议只在现有 `ImageAgent` 上继续堆逻辑。原因是：

- `ImageAgent` 当前定位是“统一风格搜图 + 少量生图”
- 活动效果图需要先做“场景定义”，再做“prompt 生成”，再做“批量出图与筛选”
- 这部分已经从“配图工具”升级为“视觉策划子流程”

推荐结构是：

`Strategy Agent`
→ `PptBuilderAgent`
→ `EventVisualDesignerAgent`
→ `ImageAgent / MiniMax image generation`
→ `PPT Generator`

其中：

- `EventVisualDesignerAgent` 负责“决定哪些页值得生图、每页要生什么、prompt 如何写”
- `ImageAgent` 退化为“视觉资产执行器”，负责搜图、调用 MiniMax、下载、裁切、缓存、回退

## 角色定位

### 核心职责

`EventVisualDesignerAgent` 应该负责：

- 从活动方案中识别适合做“现场效果图”的章节
- 将 PPT 页面拆成“必须生图 / 可搜图 / 纯版式页”
- 为每个需生图页面定义场景设定
- 输出结构化的生图 prompt
- 规定每页图片在 PPT 中的用途：全背景、半版视觉、局部插图、章节开场图
- 在生成失败时给出回退策略

### 不负责的事

- 不直接负责网页搜索
- 不直接负责 PPT 排版
- 不直接负责图片下载和压缩
- 不负责最终的策划逻辑判断

## 新流程设计

### 1. 方案阶段

`Strategy Agent` 除 `visualTheme` 外，建议补充一个新字段：

```json
{
  "visualExecutionHints": {
    "sceneTone": "年轻未来感 / 高级沉浸 / 都市夜游 / 自然共创",
    "mustRenderScenes": ["主舞台", "签到区", "产品体验区"],
    "avoidElements": ["过于写实的人脸", "品牌 logo 乱贴", "拥挤展会既视感"]
  }
}
```

作用是把“方案审美主张”前置，而不是等到 PPT 阶段再临时猜。

### 2. PPT 结构阶段

`PptBuilderAgent` 继续输出页面结构，但每页新增一组字段：

```json
{
  "visualAssetPlan": {
    "assetType": "generated_scene | searched_background | none",
    "priority": "high | medium | low",
    "reason": "这一页需要通过效果图呈现场景想象，而非信息列表",
    "sceneType": "main_stage | checkin | exhibition_zone | interaction_installation | finale",
    "insertMode": "background | panel | full_page"
  }
}
```

判断原则建议如下：

- 封面页：优先生图
- 章节开场页：优先生图
- “现场体验 / 空间规划 / 亮点装置 / 互动玩法”页：优先生图
- 时间排期、预算、KPI、流程说明页：默认不生图

### 3. 活动图设计阶段

`EventVisualDesignerAgent` 输入：

- `bestPlan`
- `pptOutline`
- `visualTheme`
- `visualExecutionHints`
- 用户补充要求
- 用户上传的参考图分析结果

输出：

```json
{
  "globalStyleGuide": {
    "visualStyle": "future premium launch space",
    "lighting": "cinematic spotlight with volumetric haze",
    "palette": "black, graphite, electric cyan, warm silver",
    "cameraLanguage": "wide angle hero shot, eye-level, architectural composition",
    "negativePrompt": "blurry text, distorted perspective, low detail crowd, extra limbs, watermark"
  },
  "pages": [
    {
      "pageIndex": 0,
      "pageTitle": "封面",
      "generateImage": true,
      "sceneType": "main_stage",
      "insertMode": "background",
      "shotIntent": "品牌发布会主舞台英雄视角",
      "mustHave": ["超宽屏主舞台", "中心产品发光体", "观众席轮廓", "顶部灯光矩阵"],
      "avoid": ["真实品牌logo", "文字海报", "廉价展板感"],
      "prompt": "英文最终生图 prompt",
      "fallbackQuery": "cinematic launch stage dark premium"
    }
  ]
}
```

这里最关键的是把“页面意图”翻译成“场景 prompt”，这一步不应该继续混在 `ImageAgent.generateSearchQueries()` 里。

### 4. 视觉资产执行阶段

由 `ImageAgent` 负责执行：

- 对 `generateImage=true` 的页面调用 MiniMax 生图
- 对 `searched_background` 的页面继续走 Pexels 搜图
- 下载到本地
- 统一裁切为 1920×1080
- 产出 `imageMap.pages[pageIndex]`

建议把目前仅支持封面的：

- `coverGeneratePrompt`

升级为：

- `pageGeneratePlans[]`

例如：

```json
{
  "pages": [
    {
      "pageIndex": 0,
      "mode": "generate",
      "prompt": "...",
      "fallbackQuery": "..."
    },
    {
      "pageIndex": 3,
      "mode": "generate",
      "prompt": "...",
      "fallbackQuery": "interactive installation premium dark"
    }
  ]
}
```

## 数据结构改造建议

### `plan`

新增：

- `visualExecutionHints`

### `pptOutline.pages[]`

新增：

- `visualAssetPlan`

### `imageMap.pages[pageIndex]`

扩展为：

```json
{
  "pageIndex": 3,
  "source": "generated | pexels",
  "localPath": "/abs/path.jpg",
  "prompt": "used prompt",
  "fallbackQuery": "used fallback query",
  "sceneType": "interaction_installation",
  "insertMode": "background",
  "assetRole": "hero_scene"
}
```

这样后续前端才能展示“这张图是生成的还是检索的、用于哪一页、原始 prompt 是什么”。

## 工具与编排建议

### 方案 A：新增 Agent，但不暴露给 Brain Tool 层

最推荐。

做法：

- 用户仍只和 `Brain Agent` 交互
- `build_ppt` 内部在 `PptBuilderAgent` 之后插入 `EventVisualDesignerAgent`
- Brain 不需要新增用户可见工具

优点：

- 改动集中在 PPT 生产链路
- 用户心智简单
- 便于灰度发布

### 方案 B：新增一个显式工具 `generate_event_visuals`

适合后续做成可单独重跑的能力，但不建议第一版就上。

适用场景：

- 用户说“先别出 PPT，先让我看几张效果图方向”
- 用户想重生某一页视觉

建议作为第二阶段能力。

## 前端体验建议

当前前端对 PPT 生成过程已经有卡片和进度反馈。新增后建议补三类可见反馈：

- `正在设计活动效果图脚本...`
- `正在生成第 1/4 张活动场景图...`
- `正在将效果图插入 PPT 页面...`

后续可再加一个轻量能力：

- 在右侧预览区显示“页面图源标签”
  - `AI效果图`
  - `素材配图`

## MiniMax 生图 Prompt 设计建议

Prompt 不建议只写“活动现场效果图”。应采用分层模板：

```text
[Scene]
A premium consumer electronics launch event stage in a futuristic indoor venue

[Composition]
wide-angle architectural hero shot, centered composition, audience silhouette, high ceiling lighting truss

[Mood]
cinematic, immersive, premium, youthful, high contrast

[Materials]
black mirror floor, translucent LED screens, brushed metal, volumetric haze

[Color]
graphite black, electric cyan, silver glow

[Quality]
ultra detailed, realistic event rendering, spatial depth, refined lighting

[Negative]
text, watermark, deformed crowd, low detail, logo clutter, trade show booth style
```

这类模板更容易做出稳定结果，也方便做缓存。

## 风险评估

### 1. 生图质量不稳定

风险：

- 人脸、手、透视、空间比例容易翻车

应对：

- 第一版优先生成“空间感 / 舞台感 / 装置感”图，少做人像主导图
- 以“建筑空间 + 光影装置 + 材质氛围”为主

### 2. 每页都生图会拖慢耗时

风险：

- PPT 生成等待时间显著上升

应对：

- 首版限制高优先级页面最多 3-5 页生图
- 其余页面继续搜图或不用图

### 3. 方案与图片脱节

风险：

- 图很美，但和策划内容没关系

应对：

- 强制要求 `visualAssetPlan.reason` 与 `sceneType`
- Prompt 里加入页级目标和必须元素

### 4. 成本不可控

风险：

- MiniMax 出图张数上升

应对：

- 默认单页 1 张，失败再回退搜图
- 增加基于 prompt hash 的本地缓存

## MVP 建议

### 第一阶段

目标：先把“活动图设计师”跑通，不追求复杂交互。

实现范围：

- 新增 `EventVisualDesignerAgent`
- 只在 `build_ppt` 链路中调用
- 只给高优先级页面生图，最多 4 页
- 输出页级 prompt
- `ImageAgent` 支持页级 MiniMax 生图
- 失败回退到 Pexels

### 第二阶段

增强范围：

- 支持用户先看“效果图方向”再决定是否生成 PPT
- 支持某一页重生
- 支持参考图风格迁移
- 支持前端展示 prompt / 图源 / 重试

### 第三阶段

增强范围：

- 多图候选打分
- 用视觉模型做生成后质检
- 自动筛掉带明显文字、透视错乱、主体糊掉的图

## 实施顺序建议

1. 新增 `src/agents/eventVisualDesignerAgent.js`
2. 在 `build_ppt` / `runPptBuilder` 内插入视觉设计阶段
3. 扩展 `ImageAgent` 支持“页级 generate plans”
4. 扩展 `imageMap.pages` 元数据
5. 增加进度事件与前端状态文案
6. 最后再考虑显式工具和重生成交互

## 最终判断

这个角色值得加，而且是高价值改造。

因为你的判断是对的：活动策划方案里，很多时候真正能把用户“打动”的不是文字本身，而是“如果现场长这样，会不会成立”。这类效果图不是普通配图，而是方案说服力的一部分。

因此它最合适的产品定义不是“图片生成器”，而是：

**把活动方案翻译成可落地空间想象的活动图设计师。**
