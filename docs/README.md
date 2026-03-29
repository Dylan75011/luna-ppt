# OpenClaw PPT — 多 Agent 系统文档索引

## 文档列表

| 文件 | 用途 | 何时查阅 |
|---|---|---|
| [architecture.md](./architecture.md) | 系统架构、Agent 协作流程、设计决策 | 理解整体系统时 |
| [agents.md](./agents.md) | 5 个 Agent 的职责、模型、输入/输出 Schema | 实现各 Agent 代码时 |
| [api.md](./api.md) | 新增 API 接口的请求/响应格式、SSE 事件规范 | 写路由或前端对接时 |
| [implementation.md](./implementation.md) | 文件结构、环境变量、实施路线图 | 启动开发或查项目结构时 |

## 背景一句话

为活动策划专家构建多 Agent PPT 生成系统：3 个 Research Agent 并行搜素材 → Strategy Agent 出方案 → Critic Agent 评审迭代（最多 3 轮）→ PPT Builder 生成 PPTX。
