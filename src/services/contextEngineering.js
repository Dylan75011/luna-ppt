function compactText(text = '', maxLength = 300) {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function compactList(items = [], maxItems = 4, maxItemLength = 60) {
  return (Array.isArray(items) ? items : [])
    .map(item => compactText(item, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function compactDocNames(docs = [], maxItems = 3) {
  return (Array.isArray(docs) ? docs : [])
    .map(doc => String(doc?.name || '').trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildTaskPromptContext(userInput = {}) {
  return {
    requirements: compactText(userInput.requirements || '', 240),
    spaceContextSummary: compactText(userInput.spaceContextSummary || '', 160),
    spaceContextKeyPoints: compactList(userInput.spaceContextKeyPoints || [], 3, 32),
    spaceContextDocs: compactDocNames(userInput.spaceContextDocs || [], 3),
    platformMemorySummary: compactText(userInput.platformMemorySummary || '', 120),
    platformMemoryPrinciples: compactList(userInput.platformMemoryPrinciples || [], 4, 32),
    platformMemoryPatterns: compactList(userInput.platformMemoryPatterns || [], 4, 32),
    platformMemoryPitfalls: compactList(userInput.platformMemoryPitfalls || [], 4, 32),
    platformMemoryRecentLearnings: compactList(userInput.platformMemoryRecentLearnings || [], 3, 40)
  };
}

function buildChatHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter(item => item && typeof item.text === 'string' && item.text.trim())
    .slice(-4)
    .map(item => ({
      role: item.role === 'ai' ? 'assistant' : 'user',
      content: compactText(item.text, 120)
    }));
}

module.exports = {
  compactText,
  compactList,
  compactDocNames,
  buildTaskPromptContext,
  buildChatHistory
};
