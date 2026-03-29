// Research Agent 提示词
function buildResearchPrompt(task, orchestratorOutput) {
  const systemPrompt = `你是一位活动策划行业的研究专员，善于从搜索结果中提炼有价值的行业洞察、竞品案例和创意灵感。
你需要根据搜索到的信息，输出结构化的研究摘要，为后续策划方案提供素材支撑。

输出必须是合法的JSON格式，不要包含任何其他文字。`;

  const userPrompt = `研究任务：${task.focus}
核心目标：${orchestratorOutput.parsedGoal}
搜索关键词：${task.keywords.join('、')}

以下是搜索结果：
{{SEARCH_RESULTS}}

请基于搜索结果，输出以下JSON格式：
{
  "taskId": "${task.id}",
  "summary": "100-200字的综合摘要",
  "keyFindings": [
    "重要发现1（含具体数据或案例）",
    "重要发现2",
    "重要发现3"
  ],
  "inspirations": [
    "对本次策划的创意启发1",
    "对本次策划的创意启发2"
  ],
  "sources": []
}

如果搜索结果不充分，请基于行业通用知识补充相关内容，但要注明是推断。`;

  return { systemPrompt, userPrompt };
}

module.exports = { buildResearchPrompt };
