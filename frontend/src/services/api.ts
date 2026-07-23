import axios from 'axios';
import { router } from '../routers/index';

const api = axios.create({
    baseURL: '/api'
});

// Inyecta el token en cada request
api.interceptors.request.use(config => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

// Si el servidor responde 401, limpia sesión y redirige al login
api.interceptors.response.use(
    res => res,
    err => {
        if (err.response?.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('usuario');
            localStorage.removeItem('empresas');
            router.push('/login');
        }
        return Promise.reject(err);
    }
);

export const apiService = {
    // Auth
    login: (usuario: string, password: string) =>
        api.post('/auth/login', { usuario, password }),

    getEmpresas: () => api.get('/auth/empresas'),

    // Contenedores
    crearContenedor: (data: any) => api.post('/contenedores', data),
    getDetalleContenedor: (id: number) => api.get(`/contenedores/${id}`),
    getTodos: () => api.get('/contenedores'),
    getDisponibles: () => api.get('/listacontenedores'),
    deleteContenedor: (id: number) => api.delete(`/contenedores/${id}`),

    // Datos ERP
    getAlbaranesAsociados: (numeroContenedor: string) =>
        api.get(`/comprasgeneral/${numeroContenedor}`),
    getVentasTiendas: (numeroContenedor: string) =>
        api.get(`/ventastiendas/${numeroContenedor}`),
    getComprasTiendas: (numeroContenedor: string) =>
        api.get(`/comprastiendas/${numeroContenedor}`),

    // Gastos
    agregarGasto: (data: any) => api.post('/gastos', data),
    eliminarGasto: (id: number) => api.delete(`/gastos/${id}`),
    actualizarGasto: (id: number, data: any) => api.put(`/gastos/${id}`, data),

    // Maestro de gastos
    getMaestroGastos: (marca: string) => api.get(`/maestro-gastos/${marca}`),
    sincronizarCatalogo: () => api.post('/sincronizar-maestro-gastos'),

    // Procesamiento ERP
    procesarGastosERP: (contenedorId: number | string) =>
        api.post(`/contenedores/${contenedorId}/procesar-gastos-tiendas`),

    // Reportes
    getReporteCostosTienda: (contenedor: string, serie = 'T%', numero = 0, marca?: string) =>
        api.get('/reportes/costos-tienda', { params: { contenedor, serie, numero, ...(marca && { marca }) } }),

    // Borrado completo (admin)
    deleteContenedorCompleto: (id: number) => api.delete(`/contenedores/${id}/completo`),

    // Cierre masivo
    cierreMasivo: () => api.post('/contenedores/cierre-masivo'),

    // Carga masiva de gastos (multi-contenedor)
    descargarPlantillaMasiva: () =>
        api.get('/gastos/plantilla-masiva', { responseType: 'blob' }),
    uploadGastosMasivo: (archivo: File) => {
        const fd = new FormData(); fd.append('archivo', archivo);
        return api.post('/gastos/bulk-masiva', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },

    // Sistema
    getHealth:          () => api.get('/health'),
    actualizarSistema:  (zip_url: string) => api.post('/admin/actualizar', { zip_url }),

    // Tasas de cambio
    getTasas:           () => api.get('/tasas').then(r => r.data),
    guardarTasaBinance: (tasa: number) => api.post('/tasas/binance', { tasa }),

    // Admin panel
    getAdminUsuarios:      ()                                    => api.get('/admin/usuarios').then(r => r.data),
    setAdminUsuario:       (usuario: string, isAdmin: boolean)   => api.put(`/admin/usuarios/${usuario}/admin`, { isAdmin }),
    setPermisosUsuario:    (usuario: string, permisos: string[]) => api.put(`/admin/usuarios/${usuario}/permisos`, { permisos }),
    getAdminMaestroGastos: ()                                    => api.get('/admin/maestro-gastos').then(r => r.data),
    createAdminGasto:      (data: any)                           => api.post('/admin/maestro-gastos', data),
    updateAdminGasto:      (id: number, data: any)               => api.put(`/admin/maestro-gastos/${id}`, data),
    deleteAdminGasto:      (id: number)                          => api.delete(`/admin/maestro-gastos/${id}`),
};
