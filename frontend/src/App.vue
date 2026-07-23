<template>
  <div v-if="esLoginPage" class="login-layout">
    <router-view></router-view>
  </div>

  <div v-else class="dashboard">
    <aside class="sidebar">
      <div class="brand">
        <img src="./assets/LOGO/1.png" alt="Redesip" class="sidebar-logo" />
      </div>
      <nav class="menu">
        <router-link to="/" class="menu-item">
          <i>🏠</i> Contenedores
        </router-link>
        <router-link to="/reportes" class="menu-item">
          <i>📊</i> Reportes
        </router-link>
        <router-link v-if="esAdmin" to="/admin" class="menu-item admin-link">
          <i>🛡</i> Administración
        </router-link>
      </nav>

      <div class="sidebar-footer">
        <div class="empresas-badge" v-if="empresas.length > 0">
          <span class="badge-label">Marcas accesibles</span>
          <div class="empresa-tags">
            <span v-for="e in empresas" :key="e.codempresa" class="empresa-tag">
              {{ e.titulo }}
            </span>
          </div>
        </div>
      </div>
    </aside>

    <main class="main-content">
      <header class="top-bar">
        <div class="user-info">
          <span class="user-icon">👤</span>
          <span class="user-name">{{ usuarioNombre }}</span>
        </div>
        <button class="btn-logout" @click="cerrarSesion">Cerrar Sesión</button>
      </header>
      <div class="view-container">
        <router-view></router-view>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { isAdmin as checkAdmin } from './utils/auth';

const route = useRoute();
const router = useRouter();

const usuarioNombre = ref('');
const empresas      = ref<any[]>([]);
const esAdmin       = ref(false);

const esLoginPage = computed(() => route.path === '/login');

const actualizarSesion = () => {
  usuarioNombre.value = localStorage.getItem('usuario') || '';
  esAdmin.value = checkAdmin();
  try {
    empresas.value = JSON.parse(localStorage.getItem('empresas') || '[]');
  } catch { empresas.value = []; }
};

onMounted(actualizarSesion);

// Re-evalúa permisos cada vez que la ruta cambia (ej: después de login/logout)
watch(() => route.path, actualizarSesion);

const cerrarSesion = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  localStorage.removeItem('empresas');
  router.push('/login');
};
</script>

<style scoped>
.login-layout { min-height: 100vh; }
.dashboard { display: flex; min-height: 100vh; }

/* ── Sidebar ──────────────────────────────── */
.sidebar {
  width: 260px;
  background: var(--dark);
  color: white;
  display: flex;
  flex-direction: column;
  box-shadow: 2px 0 12px rgba(0,0,0,0.18);
}

.brand {
  padding: 1.4rem 1.6rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}

.sidebar-logo {
  width: 160px;
  object-fit: contain;
  display: block;
}

.menu { padding: 1.2rem 1rem; flex: 1; }

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  color: var(--gray-light);
  text-decoration: none;
  border-radius: 8px;
  margin-bottom: 4px;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.menu-item:hover {
  background: var(--sidebar-hover);
  color: #fff;
}

.router-link-active {
  background: var(--primary) !important;
  color: #fff !important;
  font-weight: 700;
}

.menu-item.disabled { opacity: 0.35; cursor: default; pointer-events: none; }
.admin-link { border: 1px solid rgba(134,187,37,0.25); margin-top: 8px; }

/* ── Sidebar footer ───────────────────────── */
.sidebar-footer {
  padding: 1rem 1.2rem 1.4rem;
  border-top: 1px solid rgba(255,255,255,0.07);
}

.badge-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--gray-light);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  display: block;
  margin-bottom: 8px;
}

.empresa-tags { display: flex; flex-wrap: wrap; gap: 6px; }

.empresa-tag {
  background: rgba(134, 187, 37, 0.18);
  color: var(--primary);
  border: 1px solid rgba(134, 187, 37, 0.35);
  border-radius: 5px;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

/* ── Main content ─────────────────────────── */
.main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

.top-bar {
  height: 58px;
  background: var(--white);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 0 2rem;
  flex-shrink: 0;
}

.user-info { display: flex; align-items: center; gap: 8px; }
.user-icon { font-size: 17px; }
.user-name { font-size: 13px; font-weight: 700; color: var(--dark); }

.btn-logout {
  background: transparent;
  border: 1.5px solid var(--gray-lighter);
  color: var(--gray);
  padding: 7px 16px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  letter-spacing: 0.02em;
}
.btn-logout:hover {
  background: #ffe8e8;
  color: #c0392b;
  border-color: #f5b7b1;
}

.view-container { padding: 2rem; overflow-y: auto; flex: 1; }
</style>
