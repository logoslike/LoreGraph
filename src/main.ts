import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from '@/App.vue'
import router from '@/router'
import { useUiStore } from '@/stores/ui'
import '@/styles/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 挂载前初始化主题，避免深色模式出现闪烁
useUiStore().initTheme()

app.mount('#app')
