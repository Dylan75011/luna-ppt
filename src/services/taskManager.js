// 任务状态管理（内存存储）
const { v4: uuidv4 } = require('uuid');

const tasks = new Map();

function createTask(userInput) {
  const taskId = `task_${Date.now()}_${uuidv4().slice(0, 6)}`;
  const task = {
    taskId,
    status: 'pending',   // pending | running | completed | failed
    currentStage: null,
    round: 1,
    progress: 0,
    userInput,
    result: null,
    error: null,
    createdAt: Date.now(),
    sseClients: []        // 存储 SSE res 对象
  };
  tasks.set(taskId, task);
  return task;
}

function getTask(taskId) {
  return tasks.get(taskId) || null;
}

function updateTask(taskId, updates) {
  const task = tasks.get(taskId);
  if (!task) return;
  Object.assign(task, updates);
}

function addSseClient(taskId, res) {
  const task = tasks.get(taskId);
  if (!task) return;
  task.sseClients.push(res);
}

function removeSseClient(taskId, res) {
  const task = tasks.get(taskId);
  if (!task) return;
  task.sseClients = task.sseClients.filter(c => c !== res);
}

/**
 * 向所有订阅此任务的 SSE 客户端推送事件
 */
function pushEvent(taskId, eventType, data) {
  const task = tasks.get(taskId);
  if (!task) return;
  const payload = JSON.stringify({ ...data, timestamp: Date.now() });
  for (const res of task.sseClients) {
    try {
      res.write(`event: ${eventType}\ndata: ${payload}\n\n`);
    } catch (e) {
      // 客户端已断开，忽略
    }
  }
}

module.exports = { createTask, getTask, updateTask, addSseClient, removeSseClient, pushEvent };
