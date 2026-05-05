import { createRouter, createWebHashHistory } from 'vue-router'
import WorkspaceView  from '../views/WorkspaceView.vue'
import AgentView      from '../views/AgentView.vue'
import SettingsView   from '../views/SettingsView.vue'
import TemplatesView  from '../views/TemplatesView.vue'

const routes = [
  { path: '/',           redirect: '/workspace' },

  // 策划空间：可选 nodeId 直接定位某文档/文件夹/PPT/图片
  { path: '/workspace/:nodeId?',  component: WorkspaceView,  name: 'workspace' },

  // 智能助手：spaceId 可选；带 conversationId 时 spaceId 必须存在
  { path: '/agent/:spaceId/c/:conversationId',  component: AgentView, name: 'agent-conversation' },
  { path: '/agent/:spaceId?',                    component: AgentView, name: 'agent' },

  { path: '/templates',  component: TemplatesView,  name: 'templates'  },
  { path: '/settings',   component: SettingsView,   name: 'settings'   },
]

export default createRouter({
  history: createWebHashHistory(),
  routes
})
