import { createRouter, createWebHashHistory } from 'vue-router'
import WorkspaceView from '../views/WorkspaceView.vue'
import AgentView     from '../views/AgentView.vue'
import SettingsView  from '../views/SettingsView.vue'

const routes = [
  { path: '/',          redirect: '/workspace' },
  { path: '/workspace', component: WorkspaceView, name: 'workspace' },
  { path: '/agent',     component: AgentView,     name: 'agent' },
  { path: '/settings',  component: SettingsView,  name: 'settings' }
]

export default createRouter({
  history: createWebHashHistory(),
  routes
})
