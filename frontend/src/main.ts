import { createApp } from 'vue'
import App from './App.vue'
import { router } from './routers/index' // Asegúrate de que la ruta sea correcta
import './style.css'

const app = createApp(App)
app.use(router) // ESTA LÍNEA ES LA QUE ACTIVA EL ROUTER
app.mount('#app')