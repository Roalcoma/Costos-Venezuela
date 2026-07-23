import { createRouter, createWebHistory } from 'vue-router';
import ListaContenedores from '../views/ListaContenedores.vue';
import DetalleContenedor from '../views/DetalleContenedor.vue';
import Reportes    from '../views/Reportes.vue';
import AdminPanel  from '../views/AdminPanel.vue';
import Login       from '../views/Login.vue';
import { isAdmin } from '../utils/auth';

const routes = [
    { path: '/login',      component: Login,             meta: { public: true } },
    { path: '/',           component: ListaContenedores },
    { path: '/contenedor/:id', component: DetalleContenedor, props: true },
    { path: '/reportes',   component: Reportes },
    { path: '/admin',      component: AdminPanel, meta: { adminOnly: true } },
];

export const router = createRouter({
    history: createWebHistory(),
    routes
});

router.beforeEach((to, _from, next) => {
    const token = localStorage.getItem('token');
    if (!to.meta.public && !token) {
        next('/login');
    } else if (to.path === '/login' && token) {
        next('/');
    } else if (to.meta.adminOnly && !isAdmin()) {
        next('/');
    } else {
        next();
    }
});
