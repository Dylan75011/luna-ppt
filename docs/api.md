# API 接口设计

## 新增接口

### POST `/api/multi-agent/generate`

触发完整多 Agent 生成流程，立即返回 `taskId`，任务异步执行。

**请求体**
```json
{
  "brand": "品牌名称",
  "productCategory": "汽车",
  "eventType": "auto_show",
  "topic": "活动名称或主题",
  "scale": "大型（500人以上）",
  "budget": "500万",
  "brandColor": "FF6B00",
  "style": "高端科技感",
  "requirements": "其他补充要求"
}
```

**字段说明**

| 字段 | 必填 | 说明 |
|---|---|---|
| `brand` | ✅ | 品牌名称，不限行业 |
| `productCategory` | ✅ | 产品类别，如：汽车、手机、智能硬件、耳机、家居 |
| `eventType` | ✅ | 活动类型，见下方枚举 |
| `topic` | ✅ | 本次活动的具体名称或主题描述 |
| `scale` | ✅ | 活动规模 |
| `budget` | ✅ | 总预算（含单位，如"500万"） |
| `brandColor` | ❌ | 品牌主色（十六进制，不含 #），默认 `1A1A1A` |
| `style` | ❌ | 视觉风格偏好 |
| `requirements` | ❌ | 补充需求，如竞品对标、特定亮点等 |

**eventType 枚举**

| 值 | 活动类型 |
|---|---|
| `auto_show` | 车展 / 汽车展览 |
| `product_launch` | 新品发布会 |
| `exhibition` | 品牌展览 / 博览会参展 |
| `meeting` | 经销商大会 / 品牌峰会 |
| `simple` | 通用活动 |

**响应**
```json
{
  "success": true,
  "taskId": "task_1714000000_abc123",
  "streamUrl": "/api/multi-agent/stream/task_1714000000_abc123"
}
```

---

### GET `/api/multi-agent/stream/:taskId`

SSE 长连接，实时推送各 Agent 进度。前端用 `EventSource` 订阅。

**Response Headers**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**事件类型：`progress`**
```json
{
  "stage":     "orchestrator",
  "agentId":   "research-2",
  "status":    "running",
  "message":   "正在搜索行业趋势...",
  "round":     1,
  "score":     null,
  "passed":    null,
  "timestamp": 1714000000000
}
```

| 字段 | 说明 |
|---|---|
| `stage` | `orchestrator` / `research` / `strategy` / `critic` / `building` |
| `agentId` | research 阶段有值（`research-1/2/3`），其余为 null |
| `status` | `running` / `completed` / `failed` |
| `round` | strategy / critic 阶段有效，其余为 null |
| `score` | critic completed 时有值 |
| `passed` | critic completed 时有值（bool） |

**事件类型：`done`**
```json
{
  "filename":    "ppt_1714000000.pptx",
  "downloadUrl": "/api/files/download/ppt_1714000000.pptx",
  "previewData": { "...": "PPT JSON，供浏览器端渲染预览" }
}
```

**事件类型：`error`**
```json
{
  "stage":   "strategy",
  "message": "Strategy Agent 调用失败：超时",
  "code":    "AGENT_TIMEOUT"
}
```

**完整事件序列**
```
progress  stage=orchestrator  status=running
progress  stage=orchestrator  status=completed
progress  stage=research  agentId=research-1  status=running
progress  stage=research  agentId=research-2  status=running
progress  stage=research  agentId=research-3  status=running
progress  stage=research  agentId=research-1  status=completed
progress  stage=research  agentId=research-2  status=completed
progress  stage=research  agentId=research-3  status=completed
progress  stage=strategy  status=running   round=1
progress  stage=strategy  status=completed round=1
progress  stage=critic    status=running   round=1
progress  stage=critic    status=completed round=1  score=6.5  passed=false
progress  stage=strategy  status=running   round=2
progress  stage=strategy  status=completed round=2
progress  stage=critic    status=running   round=2
progress  stage=critic    status=completed round=2  score=7.8  passed=true
progress  stage=building  status=running
progress  stage=building  status=completed
done      { filename, downloadUrl, previewData }
```

---

### GET `/api/multi-agent/status/:taskId`

查询任务状态，SSE 断线时的轮询备用。

**响应**
```json
{
  "taskId": "task_xxx",
  "status": "running",
  "currentStage": "strategy",
  "round": 2,
  "progress": 60,
  "result": null
}
```

**status 枚举**：`pending` / `running` / `completed` / `failed`

**completed 时的 result**
```json
{
  "filename":    "ppt_xxx.pptx",
  "downloadUrl": "/api/files/download/ppt_xxx.pptx",
  "previewData": { "...": "..." }
}
```

---

## 保留的原有接口（不改动）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/templates` | 获取模板列表 |
| GET | `/api/templates/:id` | 获取模板详情 |
| POST | `/api/ppt/generate` | 按模板生成 PPT |
| POST | `/api/ai/generate-outline` | 旧版 AI 大纲生成 |
| POST | `/api/ai/generate-full` | 旧版 AI 完整生成 |
| GET | `/api/files/list` | 文件列表 |
| GET | `/api/files/download/:filename` | 下载文件 |
| GET | `/api/health` | 服务健康检查 |
