import { createApp } from 'vue'
import ArcoVue from '@arco-design/web-vue'
import ArcoVueIcon from '@arco-design/web-vue/es/icon'
import '@arco-design/web-vue/dist/arco.css'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'

const app = createApp(App)
app.use(ArcoVue, { size: 'medium' })
app.use(ArcoVueIcon)
app.use(createPinia())
app.use(router)
app.mount('#app')
