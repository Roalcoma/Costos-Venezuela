<template>
  <div class="admin-page">
    <div class="page-header">
      <div>
        <h1>🛡 Panel de Administración</h1>
        <p class="subtitle">Gestión de usuarios, permisos y catálogo de gastos</p>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <button :class="['tab', { active: tabActiva === 'usuarios' }]"  @click="tabActiva = 'usuarios'">👥 Usuarios y Permisos</button>
      <button :class="['tab', { active: tabActiva === 'gastos' }]"    @click="tabActiva = 'gastos'">💰 Catálogo de Gastos</button>
      <button :class="['tab', { active: tabActiva === 'masiva' }]"    @click="tabActiva = 'masiva'">📥 Carga Masiva</button>
      <button :class="['tab', { active: tabActiva === 'tasas' }]"     @click="tabActiva = 'tasas'; cargarTasas()">💱 Tasas de Cambio</button>
      <button :class="['tab', { active: tabActiva === 'sistema' }]"    @click="tabActiva = 'sistema'">⚙ Sistema</button>
      <button :class="['tab', { active: tabActiva === 'conexion' }]"  @click="tabActiva = 'conexion'; cargarConfig()">🔌 Conexión</button>
    </div>

    <!-- ──────────────── TAB: USUARIOS ──────────────── -->
    <div v-if="tabActiva === 'usuarios'" class="tab-content">
      <div class="section-card">
        <div class="section-header">
          <h3>Usuarios del sistema</h3>
          <button @click="cargarUsuarios" class="btn-secondary">↺ Actualizar</button>
        </div>

        <!-- Buscador usuarios -->
        <div class="search-bar">
          <span class="search-icon">🔍</span>
          <input v-model="busquedaUsuarios" placeholder="Buscar usuario..." class="search-input" />
          <span class="result-count">{{ usuariosFiltrados.length }} usuario(s)</span>
        </div>

        <div v-if="cargandoUsuarios" class="loading-msg">Cargando usuarios...</div>
        <template v-else>
          <table class="admin-table">
            <thead>
              <tr>
                <th>USUARIO</th>
                <th class="text-center">ADMIN</th>
                <th>PERMISOS DE ACCESO</th>
                <th class="text-center">GUARDAR</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in usuariosPagina" :key="u.CODUSUARIO">
                <td class="bold">{{ u.USUARIO }}</td>
                <td class="text-center">
                  <label class="toggle">
                    <input type="checkbox" v-model="u.isAdmin" @change="toggleAdmin(u)" :disabled="u.USUARIO === usuarioActual" />
                    <span class="slider"></span>
                  </label>
                </td>
                <td>
                  <div class="permisos-check">
                    <label v-for="p in PERMISOS_DISPONIBLES" :key="p.key" class="perm-label">
                      <input type="checkbox" :value="p.key" v-model="u.permisos" :disabled="u.isAdmin" />
                      {{ p.label }}
                    </label>
                  </div>
                </td>
                <td class="text-center">
                  <button @click="guardarPermisos(u)" class="btn-save" :disabled="u.isAdmin">Guardar</button>
                </td>
              </tr>
              <tr v-if="usuariosPagina.length === 0">
                <td colspan="4" class="no-data">No se encontraron usuarios.</td>
              </tr>
            </tbody>
          </table>

          <!-- Paginación usuarios -->
          <div class="pagination">
            <div class="pag-info">
              {{ (paginaUsuarios - 1) * tamUsuarios + 1 }}–{{ Math.min(paginaUsuarios * tamUsuarios, usuariosFiltrados.length) }}
              de {{ usuariosFiltrados.length }}
            </div>
            <div class="pag-controls">
              <select v-model.number="tamUsuarios" @change="paginaUsuarios = 1" class="pag-select">
                <option :value="10">10 / pág.</option>
                <option :value="25">25 / pág.</option>
                <option :value="50">50 / pág.</option>
              </select>
              <button @click="paginaUsuarios = 1"           :disabled="paginaUsuarios === 1"           class="pag-btn">«</button>
              <button @click="paginaUsuarios--"             :disabled="paginaUsuarios === 1"           class="pag-btn">‹</button>
              <span class="pag-current">{{ paginaUsuarios }} / {{ totalPaginasU }}</span>
              <button @click="paginaUsuarios++"             :disabled="paginaUsuarios === totalPaginasU" class="pag-btn">›</button>
              <button @click="paginaUsuarios = totalPaginasU" :disabled="paginaUsuarios === totalPaginasU" class="pag-btn">»</button>
            </div>
          </div>
        </template>

        <p class="info-note">💡 Los administradores tienen acceso total automáticamente. Los permisos sólo aplican a usuarios no-admin.</p>
      </div>
    </div>

    <!-- ──────────────── TAB: GASTOS ──────────────── -->
    <div v-if="tabActiva === 'gastos'" class="tab-content">
      <div class="section-card">
        <div class="section-header">
          <h3>Catálogo de gastos logísticos</h3>
          <button @click="mostrarFormGasto = !mostrarFormGasto" class="btn-primary">+ Nuevo Gasto</button>
        </div>

        <!-- Formulario nuevo gasto -->
        <div v-if="mostrarFormGasto" class="form-card">
          <h4>Agregar gasto al catálogo</h4>
          <div class="form-row">
            <div class="form-group">
              <label>Nombre del gasto</label>
              <input v-model="nuevoGasto.NOMBRE_GASTO" placeholder="Ej: FLETE MARÍTIMO" />
            </div>
            <div class="form-group">
              <label>Código ERP (REFPROVEEDOR)</label>
              <input v-model="nuevoGasto.CODIGO_ERP" placeholder="Ej: C001" />
            </div>
            <div class="form-group">
              <label>Marca (opcional)</label>
              <input v-model="nuevoGasto.MARCA" placeholder="ARDENE, ADIDAS..." />
            </div>
            <div class="form-group">
              <label>Tasa de conversión</label>
              <select v-model="nuevoGasto.TIPO_TASA" class="tasa-select">
                <option value="BCV">Tasa BCV (Oficial)</option>
                <option value="BINANCE">Tasa Binance (Libre)</option>
              </select>
            </div>
            <div class="form-group center">
              <label>Activo</label>
              <input type="checkbox" v-model="nuevoGasto.ACTIVO" class="big-check" />
            </div>
          </div>
          <div class="form-actions">
            <button @click="crearGasto" class="btn-primary">Guardar</button>
            <button @click="mostrarFormGasto = false" class="btn-secondary">Cancelar</button>
          </div>
        </div>

        <!-- Buscador gastos -->
        <div class="search-bar">
          <span class="search-icon">🔍</span>
          <input v-model="busquedaGastos" placeholder="Buscar por nombre, código o marca..." class="search-input" />
          <span class="result-count">{{ gastosFiltrados.length }} concepto(s)</span>
        </div>

        <!-- Tabla de gastos -->
        <div v-if="cargandoGastos" class="loading-msg">Cargando catálogo...</div>
        <template v-else>
          <table class="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>NOMBRE</th>
                <th>CÓDIGO ERP</th>
                <th>MARCA</th>
                <th class="text-center">TASA</th>
                <th class="text-center">ACTIVO</th>
                <th class="text-center">ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in gastosPagina" :key="g.ID">
                <td class="mono text-gray">{{ g.ID }}</td>
                <td>
                  <input v-if="editandoGasto === g.ID" v-model="g.NOMBRE_GASTO" class="inline-input" />
                  <span v-else class="bold">{{ g.NOMBRE_GASTO }}</span>
                </td>
                <td class="mono">{{ g.CODIGO_ERP }}</td>
                <td><span v-if="g.MARCA" class="marca-tag">{{ g.MARCA }}</span><span v-else class="text-gray">—</span></td>
                <td class="text-center">
                  <select v-if="editandoGasto === g.ID" v-model="g.TIPO_TASA" class="tasa-select-sm">
                    <option value="BCV">BCV</option>
                    <option value="BINANCE">Binance</option>
                  </select>
                  <span v-else :class="['tasa-pill', g.TIPO_TASA === 'BINANCE' ? 'binance' : 'bcv']">{{ g.TIPO_TASA || 'BCV' }}</span>
                </td>
                <td class="text-center">
                  <span :class="['estado-pill', g.ACTIVO ? 'activo' : 'inactivo']">{{ g.ACTIVO ? 'Sí' : 'No' }}</span>
                </td>
                <td class="text-center">
                  <div class="action-btns">
                    <template v-if="editandoGasto === g.ID">
                      <button @click="guardarGasto(g)" class="btn-icon save">✓</button>
                      <button @click="editandoGasto = null" class="btn-icon cancel">✕</button>
                    </template>
                    <template v-else>
                      <button @click="editandoGasto = g.ID" class="btn-icon edit" title="Editar">✏️</button>
                      <button @click="eliminarGasto(g.ID)" class="btn-icon del" title="Eliminar">🗑️</button>
                    </template>
                  </div>
                </td>
              </tr>
              <tr v-if="gastosPagina.length === 0">
                <td colspan="7" class="no-data">No se encontraron conceptos.</td>
              </tr>
            </tbody>
          </table>

          <!-- Paginación gastos -->
          <div class="pagination">
            <div class="pag-info">
              {{ (paginaGastos - 1) * tamGastos + 1 }}–{{ Math.min(paginaGastos * tamGastos, gastosFiltrados.length) }}
              de {{ gastosFiltrados.length }}
            </div>
            <div class="pag-controls">
              <select v-model.number="tamGastos" @change="paginaGastos = 1" class="pag-select">
                <option :value="10">10 / pág.</option>
                <option :value="25">25 / pág.</option>
                <option :value="50">50 / pág.</option>
              </select>
              <button @click="paginaGastos = 1"            :disabled="paginaGastos === 1"            class="pag-btn">«</button>
              <button @click="paginaGastos--"              :disabled="paginaGastos === 1"            class="pag-btn">‹</button>
              <span class="pag-current">{{ paginaGastos }} / {{ totalPaginasG }}</span>
              <button @click="paginaGastos++"              :disabled="paginaGastos === totalPaginasG" class="pag-btn">›</button>
              <button @click="paginaGastos = totalPaginasG" :disabled="paginaGastos === totalPaginasG" class="pag-btn">»</button>
            </div>
          </div>
        </template>
      </div>
    </div>
    <!-- ──────────────── TAB: CARGA MASIVA ──────────────── -->
    <div v-if="tabActiva === 'masiva'" class="tab-content">
      <div class="section-card">
        <div class="section-header">
          <h3>Carga masiva de gastos</h3>
        </div>

        <div class="masiva-explainer">
          <div class="explainer-step">
            <span class="step-num">1</span>
            <div>
              <strong>Descarga la plantilla Excel</strong>
              <p>Contiene una columna por cada concepto de gasto activo en el catálogo.</p>
            </div>
          </div>
          <div class="explainer-step">
            <span class="step-num">2</span>
            <div>
              <strong>Completa el archivo</strong>
              <p>Una fila por contenedor. Pon el número exacto en la columna <em>CONTENEDOR</em> y el importe en cada gasto que aplique. Deja en blanco los que no correspondan.</p>
            </div>
          </div>
          <div class="explainer-step">
            <span class="step-num">3</span>
            <div>
              <strong>Sube el archivo</strong>
              <p>La aplicación creará los gastos en cada contenedor automáticamente.</p>
            </div>
          </div>
        </div>

        <div class="masiva-actions">
          <button @click="descargarPlantillaMasiva" class="btn-template-big">
            ⬇ Descargar Plantilla Excel
          </button>

          <div class="upload-zone" :class="{ 'uploading': masivaUploading }">
            <label class="upload-label">
              <span v-if="masivaUploading">⏳ Procesando...</span>
              <template v-else>
                <span class="upload-icon">⬆</span>
                <span>Subir Excel completado</span>
                <span class="upload-hint">Haz clic o arrastra el archivo aquí</span>
              </template>
              <input
                ref="masivaFileInput"
                type="file"
                accept=".xlsx,.xls"
                style="display:none"
                :disabled="masivaUploading"
                @change="subirMasiva"
              />
            </label>
          </div>
        </div>

        <!-- Resultado de la última carga -->
        <div v-if="masivaResultado" class="masiva-resultado" :class="masivaResultado.tipo">
          <p class="resultado-titulo">{{ masivaResultado.titulo }}</p>
          <p class="resultado-detalle">{{ masivaResultado.detalle }}</p>
          <ul v-if="masivaResultado.errores?.length" class="resultado-errores">
            <li v-for="e in masivaResultado.errores" :key="e">{{ e }}</li>
          </ul>
        </div>

      </div>
    </div>

    <!-- ──────────────── TAB: TASAS DE CAMBIO ──────────────── -->
    <div v-if="tabActiva === 'tasas'" class="tab-content">
      <div class="section-card">
        <h3>Tasas de Cambio</h3>

        <div v-if="cargandoTasas" class="loading-msg">Consultando tasas...</div>
        <div v-else class="tasas-grid">

          <!-- BCV -->
          <div class="tasa-card bcv-card">
            <div class="tasa-card-header">
              <span class="tasa-icon">🏦</span>
              <span class="tasa-label">Tasa BCV (Oficial)</span>
            </div>
            <div class="tasa-valor">{{ tasaBCV ? tasaBCV.toFixed(4) + ' Bs/USD' : 'No disponible' }}</div>
            <div class="tasa-note">Se obtiene automáticamente del ERP (F_GET_COTIZACION)</div>
          </div>

          <!-- Binance -->
          <div class="tasa-card binance-card">
            <div class="tasa-card-header">
              <span class="tasa-icon">🔶</span>
              <span class="tasa-label">Tasa Binance (Libre)</span>
            </div>
            <div class="tasa-valor">{{ tasaBinance ? tasaBinance.toFixed(4) + ' Bs/USD' : 'Sin configurar' }}</div>
            <div class="tasa-input-row">
              <input v-model.number="nuevaTasaBinance" type="number" step="0.0001" min="0" placeholder="Ej: 42.5000" class="tasa-input" />
              <button @click="guardarTasaBinance" class="btn-primary" :disabled="guardandoTasa">
                {{ guardandoTasa ? 'Guardando...' : 'Actualizar' }}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- ──────────────── TAB: SISTEMA ──────────────── -->
    <div v-if="tabActiva === 'sistema'" class="tab-content">
      <div class="section-card">
        <div class="section-header">
          <h3>Actualización del Sistema</h3>
          <span class="version-badge">v{{ versionActual || '...' }}</span>
        </div>

        <!-- URL de GitHub -->
        <div class="sys-block">
          <label class="sys-label">URL del ZIP en GitHub</label>
          <div class="sys-url-row">
            <input v-model="githubZipUrl" class="sys-url-input"
              placeholder="https://github.com/usuario/repo/archive/refs/heads/main.zip" />
            <button @click="guardarUrl" class="btn-save-url" title="Guardar URL">
              💾 Guardar URL
            </button>
          </div>
          <span v-if="urlGuardada" class="url-saved-msg">✓ URL guardada</span>
        </div>

        <!-- Botón principal -->
        <div class="sys-block">
          <button
            @click="iniciarActualizacion"
            :disabled="actualizando || !githubZipUrl"
            class="btn-actualizar"
          >
            <span v-if="actualizando" class="btn-spinner"></span>
            {{ actualizando ? estadoActualizacion : '⬆ Actualizar a la versión de GitHub' }}
          </button>
        </div>

        <!-- Estado -->
        <div v-if="actualizacionCompletada" class="sys-msg ok">
          ✅ Sistema actualizado correctamente. Nueva versión: v{{ versionActual }}
        </div>
        <div v-if="errorActualizacion" class="sys-msg err">
          ❌ {{ errorActualizacion }}
        </div>

        <!-- Instrucciones -->
        <div class="sys-help">
          <strong>Flujo de trabajo:</strong>
          Haz cambios en el código → <code>git push</code> a GitHub → clic en "Actualizar" → el servidor se reinicia automáticamente (~2–3 min).
        </div>
      </div>
    </div>

    <!-- ──────────────── TAB: CONEXIÓN ──────────────── -->
    <div v-if="tabActiva === 'conexion'" class="tab-content">

      <!-- Conexión primaria -->
      <div class="section-card" style="margin-bottom:20px">
        <div class="section-header">
          <h3>Conexión primaria (GESTIONCOMPRASDB)</h3>
          <span class="conn-badge ok">● Servidor principal</span>
        </div>
        <div v-if="configCargando" class="loading-msg">Cargando...</div>
        <template v-else>
          <div class="conn-grid">
            <div class="form-group">
              <label>Servidor (IP o hostname)</label>
              <input v-model="configForm.server" type="text" placeholder="127.0.0.1" class="conn-input" />
            </div>
            <div class="form-group">
              <label>Usuario SQL</label>
              <input v-model="configForm.user" type="text" placeholder="sa" class="conn-input" />
            </div>
            <div class="form-group">
              <label>Contraseña SQL</label>
              <input v-model="configForm.password" type="password"
                :placeholder="configHasPassword ? '••••••• (sin cambios si se deja vacío)' : 'Nueva contraseña'"
                class="conn-input" />
            </div>
            <div class="form-group">
              <label>Marcas excluidas (separadas por coma)</label>
              <input v-model="configForm.marcasExcluidas" type="text" placeholder="TOPGROUP,MAYORES" class="conn-input" />
            </div>
          </div>
        </template>
      </div>

      <!-- Servidores adicionales -->
      <div class="section-card" style="margin-bottom:20px">
        <div class="section-header">
          <h3>Servidores adicionales</h3>
          <button @click="agregarServidor" class="btn-secondary">+ Agregar servidor</button>
        </div>
        <p class="info-note" style="margin-top:0;margin-bottom:16px">
          Para marcas cuyas bases de datos están en otros SQL Server. El campo <strong>Servidor</strong>
          debe coincidir con el prefijo usado en <code>GENERAL.EMPRESAS.PATHBD</code> (ej. <code>192.168.1.50:NOMBREBD</code>).
        </p>

        <div v-if="servers.length === 0" class="no-data" style="padding:16px">
          Sin servidores adicionales configurados.
        </div>

        <table v-else class="admin-table">
          <thead>
            <tr>
              <th>SERVIDOR (IP / HOSTNAME)</th>
              <th>USUARIO SQL</th>
              <th>CONTRASEÑA</th>
              <th class="text-center">ACCIÓN</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in servers" :key="i">
              <td><input v-model="s.host"     type="text"     placeholder="192.168.1.50" class="inline-input" /></td>
              <td><input v-model="s.user"     type="text"     placeholder="sa"           class="inline-input" /></td>
              <td><input v-model="s.password" type="password"
                    :placeholder="s.hasPassword ? '••••••• (sin cambios)' : 'Contraseña'"
                    class="inline-input" /></td>
              <td class="text-center">
                <button @click="servers.splice(i, 1)" class="btn-icon del">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Advertencia + botón guardar -->
      <div class="section-card">
        <div class="conn-warning">
          ⚠ Guardar reiniciará el servidor automáticamente (~15 seg). La sesión se mantendrá.
        </div>
        <div class="conn-actions">
          <button @click="guardarTodo" :disabled="configGuardando" class="btn-actualizar">
            <span v-if="configGuardando" class="btn-spinner"></span>
            {{ configGuardando ? configEstado : '💾 Guardar y reiniciar' }}
          </button>
        </div>
        <div v-if="configMsg" class="sys-msg" :class="configMsg.tipo" style="margin-top:16px">{{ configMsg.texto }}</div>
      </div>

    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { apiService } from '../services/api';

const tabActiva        = ref<'usuarios' | 'gastos' | 'masiva' | 'tasas' | 'sistema' | 'conexion'>('usuarios');
const usuarios         = ref<any[]>([]);
const gastos           = ref<any[]>([]);
const cargandoUsuarios = ref(false);
const cargandoGastos   = ref(false);
const mostrarFormGasto = ref(false);
const editandoGasto    = ref<number | null>(null);
const usuarioActual    = localStorage.getItem('usuario') || '';

// ── Búsqueda y paginación usuarios ──────────────
const busquedaUsuarios  = ref('');
const paginaUsuarios    = ref(1);
const tamUsuarios       = ref(10);

const usuariosFiltrados = computed(() => {
    const q = busquedaUsuarios.value.trim().toLowerCase();
    return q ? usuarios.value.filter(u => u.USUARIO.toLowerCase().includes(q)) : usuarios.value;
});
const totalPaginasU = computed(() => Math.max(1, Math.ceil(usuariosFiltrados.value.length / tamUsuarios.value)));
const usuariosPagina = computed(() => {
    const s = (paginaUsuarios.value - 1) * tamUsuarios.value;
    return usuariosFiltrados.value.slice(s, s + tamUsuarios.value);
});
watch(busquedaUsuarios, () => { paginaUsuarios.value = 1; });

// ── Búsqueda y paginación gastos ─────────────────
const busquedaGastos = ref('');
const paginaGastos   = ref(1);
const tamGastos      = ref(10);

const gastosFiltrados = computed(() => {
    const q = busquedaGastos.value.trim().toLowerCase();
    return q
        ? gastos.value.filter(g =>
            g.NOMBRE_GASTO?.toLowerCase().includes(q) ||
            String(g.CODIGO_ERP).includes(q) ||
            g.MARCA?.toLowerCase().includes(q))
        : gastos.value;
});
const totalPaginasG = computed(() => Math.max(1, Math.ceil(gastosFiltrados.value.length / tamGastos.value)));
const gastosPagina = computed(() => {
    const s = (paginaGastos.value - 1) * tamGastos.value;
    return gastosFiltrados.value.slice(s, s + tamGastos.value);
});
watch(busquedaGastos, () => { paginaGastos.value = 1; });

const PERMISOS_DISPONIBLES = [
    { key: 'GESTION',   label: 'Gestión de Contenedores' },
    { key: 'REPORTES',  label: 'Reportes' }
];

const nuevoGasto = ref({ NOMBRE_GASTO: '', CODIGO_ERP: '' as string, MARCA: '', TIPO_TASA: 'BCV', ACTIVO: true });

// ── Tasas de cambio ──────────────────────────────
const tasaBCV          = ref<number | null>(null);
const tasaBinance      = ref<number | null>(null);
const nuevaTasaBinance = ref<number | null>(null);
const cargandoTasas    = ref(false);
const guardandoTasa    = ref(false);

const cargarTasas = async () => {
    cargandoTasas.value = true;
    try {
        const res = await apiService.getTasas();
        tasaBCV.value     = res.bcv;
        tasaBinance.value = res.binance;
        nuevaTasaBinance.value = res.binance;
    } catch { /* silencioso */ }
    finally { cargandoTasas.value = false; }
};

const guardarTasaBinance = async () => {
    if (!nuevaTasaBinance.value || nuevaTasaBinance.value <= 0) return alert('Ingresa una tasa válida.');
    guardandoTasa.value = true;
    try {
        await apiService.guardarTasaBinance(nuevaTasaBinance.value);
        tasaBinance.value = nuevaTasaBinance.value;
        alert('Tasa Binance actualizada.');
    } catch (e: any) { alert('Error: ' + (e?.response?.data?.error || e.message)); }
    finally { guardandoTasa.value = false; }
};

const cargarUsuarios = async () => {
    cargandoUsuarios.value = true;
    try { usuarios.value = await apiService.getAdminUsuarios(); }
    catch (e: any) { alert('Error: ' + e?.response?.data?.error || e.message); }
    finally { cargandoUsuarios.value = false; }
};

const cargarGastos = async () => {
    cargandoGastos.value = true;
    try { gastos.value = await apiService.getAdminMaestroGastos(); }
    catch (e: any) { alert('Error cargando gastos'); }
    finally { cargandoGastos.value = false; }
};

const toggleAdmin = async (u: any) => {
    try {
        await apiService.setAdminUsuario(u.USUARIO, u.isAdmin);
    } catch (e: any) {
        u.isAdmin = !u.isAdmin;
        alert('Error: ' + (e?.response?.data?.error || e.message));
    }
};

const guardarPermisos = async (u: any) => {
    try {
        await apiService.setPermisosUsuario(u.USUARIO, u.permisos);
        alert(`Permisos de ${u.USUARIO} guardados.`);
    } catch (e: any) { alert('Error guardando permisos'); }
};

const crearGasto = async () => {
    try {
        await apiService.createAdminGasto(nuevoGasto.value);
        nuevoGasto.value = { NOMBRE_GASTO: '', CODIGO_ERP: '', MARCA: '', TIPO_TASA: 'BCV', ACTIVO: true };
        mostrarFormGasto.value = false;
        await cargarGastos();
    } catch (e: any) { alert('Error creando gasto: ' + (e?.response?.data?.error || e.message)); }
};

const guardarGasto = async (g: any) => {
    try {
        await apiService.updateAdminGasto(g.ID, { NOMBRE_GASTO: g.NOMBRE_GASTO, TIPO_TASA: g.TIPO_TASA || 'BCV', ACTIVO: g.ACTIVO });
        editandoGasto.value = null;
    } catch (e: any) { alert('Error guardando'); }
};

const eliminarGasto = async (id: number) => {
    if (!confirm('¿Eliminar este gasto del catálogo?')) return;
    try {
        await apiService.deleteAdminGasto(id);
        gastos.value = gastos.value.filter(g => g.ID !== id);
    } catch (e: any) { alert('Error eliminando'); }
};

// ── Carga masiva ─────────────────────────────────
const masivaUploading  = ref(false);
const masivaFileInput  = ref<HTMLInputElement | null>(null);
const masivaResultado  = ref<{ tipo: string; titulo: string; detalle: string; errores?: string[] } | null>(null);

const descargarPlantillaMasiva = async () => {
    try {
        const res = await apiService.descargarPlantillaMasiva();
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'plantilla_carga_masiva_gastos.xlsx';
        document.body.appendChild(a); a.click(); a.remove();
        window.URL.revokeObjectURL(url);
    } catch (e: any) {
        // Cuando responseType:'blob', el error del servidor llega como Blob — leerlo para mostrar el mensaje real
        if (e?.response?.data instanceof Blob) {
            const texto = await e.response.data.text();
            try { alert('Error al descargar plantilla: ' + JSON.parse(texto).error); }
            catch { alert('Error al descargar plantilla: ' + texto); }
        } else {
            alert('Error al descargar plantilla: ' + (e?.message || 'Error desconocido'));
        }
    }
};

const subirMasiva = async (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    masivaUploading.value = true;
    masivaResultado.value = null;
    try {
        const res = await apiService.uploadGastosMasivo(file);
        const { insertados, errores } = res.data;
        masivaResultado.value = {
            tipo: errores?.length ? 'parcial' : 'ok',
            titulo: `✅ Carga completada: ${insertados} gasto(s) insertados.`,
            detalle: errores?.length ? `Se encontraron ${errores.length} advertencia(s):` : 'Todos los registros se procesaron correctamente.',
            errores: errores || []
        };
    } catch (e: any) {
        masivaResultado.value = {
            tipo: 'error',
            titulo: '❌ Error al procesar el archivo',
            detalle: e?.response?.data?.error || 'Error desconocido.'
        };
    } finally {
        masivaUploading.value = false;
        if (masivaFileInput.value) masivaFileInput.value.value = '';
    }
};

// ── Auto-updater ──────────────────────────────────
const LS_KEY = 'cv_github_zip_url';
const githubZipUrl            = ref(localStorage.getItem(LS_KEY) || '');
const urlGuardada             = ref(false);
const actualizando            = ref(false);
const actualizacionCompletada = ref(false);
const errorActualizacion      = ref('');
const estadoActualizacion     = ref('');
const versionActual           = ref('');

const cargarVersion = async () => {
    try { versionActual.value = (await apiService.getHealth()).data.version; } catch {}
};

const guardarUrl = () => {
    localStorage.setItem(LS_KEY, githubZipUrl.value);
    urlGuardada.value = true;
    setTimeout(() => { urlGuardada.value = false; }, 2000);
};

const iniciarActualizacion = async () => {
    if (!githubZipUrl.value) return alert('Primero ingresa y guarda la URL del ZIP.');
    if (!confirm('¿Confirmas la actualización? El servidor se reiniciará automáticamente (~2–3 min).')) return;
    actualizando.value = true;
    actualizacionCompletada.value = false;
    errorActualizacion.value = '';
    estadoActualizacion.value = 'Descargando ZIP...';
    try {
        await apiService.actualizarSistema(githubZipUrl.value);
        estadoActualizacion.value = 'Aplicando cambios y reiniciando servidor...';
        await new Promise<void>((resolve, reject) => {
            let attempts = 0;
            setTimeout(() => {
                const poll = setInterval(async () => {
                    if (++attempts > 120) { clearInterval(poll); reject(new Error('Timeout: el servidor tardó más de 6 min.')); return; }
                    try { await apiService.getHealth(); clearInterval(poll); resolve(); } catch {}
                }, 3000);
            }, 8000);
        });
        actualizacionCompletada.value = true;
        await cargarVersion();
    } catch (e: any) {
        errorActualizacion.value = e?.response?.data?.error || e.message || 'Error desconocido.';
    } finally { actualizando.value = false; estadoActualizacion.value = ''; }
};

// ── Configuración de conexión ──────────────────────
const configCargando = ref(false);
const configGuardando = ref(false);
const configHasPassword = ref(false);
const configEstado = ref('');
const configMsg = ref<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
const configForm = ref({ server: '', user: '', password: '', marcasExcluidas: '' });

const servers = ref<Array<{ host: string; user: string; password: string; hasPassword: boolean }>>([]);

const cargarConfig = async () => {
    configCargando.value = true;
    configMsg.value = null;
    try {
        const [cfgRes, srvRes] = await Promise.all([apiService.getConfig(), apiService.getServers()]);
        const data = cfgRes.data;
        configForm.value.server          = data.server          || '';
        configForm.value.user            = data.user            || '';
        configForm.value.password        = '';
        configForm.value.marcasExcluidas = data.marcasExcluidas || '';
        configHasPassword.value          = data.hasPassword     || false;
        servers.value = (srvRes.data || []).map((s: any) => ({ ...s, password: '' }));
    } catch { configMsg.value = { tipo: 'err', texto: 'No se pudo cargar la configuración.' }; }
    finally  { configCargando.value = false; }
};

const agregarServidor = () => {
    servers.value.push({ host: '', user: 'sa', password: '', hasPassword: false });
};

const _pollRestart = () => new Promise<void>((resolve, reject) => {
    let attempts = 0;
    setTimeout(() => {
        const poll = setInterval(async () => {
            if (++attempts > 40) { clearInterval(poll); reject(new Error('Timeout: el servidor tardó más de 2 min.')); return; }
            try { await apiService.getHealth(); clearInterval(poll); resolve(); } catch {}
        }, 3000);
    }, 5000);
});

const guardarTodo = async () => {
    if (!confirm('¿Confirmas guardar los cambios? El servidor se reiniciará automáticamente.')) return;
    configGuardando.value = true;
    configMsg.value = null;
    try {
        // 1. Guardar servidores adicionales (sin reiniciar)
        configEstado.value = 'Guardando servidores adicionales...';
        await apiService.updateServers(servers.value.map(s => ({ host: s.host, user: s.user, password: s.password })));

        // 2. Guardar config primaria → reinicia el servidor (una sola vez)
        configEstado.value = 'Guardando y reiniciando...';
        const payload: any = {
            server:          configForm.value.server,
            user:            configForm.value.user,
            marcasExcluidas: configForm.value.marcasExcluidas,
        };
        if (configForm.value.password) payload.password = configForm.value.password;
        await apiService.updateConfig(payload);

        // 3. Esperar que vuelva
        configEstado.value = 'Esperando reinicio...';
        await _pollRestart();

        configForm.value.password = '';
        servers.value.forEach(s => { s.password = ''; s.hasPassword = true; });
        configMsg.value = { tipo: 'ok', texto: '✅ Configuración guardada. Servidor reiniciado correctamente.' };
    } catch (e: any) {
        configMsg.value = { tipo: 'err', texto: e?.response?.data?.error || e.message || 'Error desconocido.' };
    } finally { configGuardando.value = false; configEstado.value = ''; }
};

onMounted(() => { cargarUsuarios(); cargarGastos(); cargarVersion(); });
</script>

<style scoped>
.admin-page { padding: 24px 28px; }
.page-header { margin-bottom: 24px; }
h1 { margin: 0; font-size: 22px; font-weight: 800; color: var(--dark); }
.subtitle { color: var(--gray); font-size: 14px; margin: 4px 0 0; }

/* Tabs */
.tabs { display: flex; gap: 4px; margin-bottom: 24px; border-bottom: 2px solid var(--border); }
.tab {
  padding: 10px 20px; border: none; background: none; cursor: pointer;
  font-family: inherit; font-size: 14px; font-weight: 600; color: var(--gray);
  border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.2s;
}
.tab:hover { color: var(--dark); }
.tab.active { color: var(--primary-dark); border-bottom-color: var(--primary); }

/* Section card */
.section-card {
  background: var(--white); border: 1px solid var(--border);
  border-radius: 14px; padding: 28px; box-shadow: 0 2px 6px rgba(0,0,0,0.05);
}
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 22px; }
.section-header h3 { margin: 0; font-size: 16px; font-weight: 800; color: var(--dark); }

/* Buttons */
.btn-primary {
  background: var(--primary); color: #fff; border: none; padding: 10px 20px;
  border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; font-family: inherit;
}
.btn-primary:hover { background: var(--primary-dark); }
.btn-secondary {
  background: #f0f0ed; color: var(--gray); border: none; padding: 10px 16px;
  border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; font-family: inherit;
}
.btn-save {
  background: var(--primary-light); color: var(--primary-dark); border: 1px solid rgba(134,187,37,0.4);
  padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer;
}
.btn-save:disabled { opacity: 0.4; cursor: not-allowed; }

/* Admin table */
.admin-table { width: 100%; border-collapse: collapse; }
.admin-table th {
  background: #f6f6f3; padding: 11px 14px; text-align: left; font-size: 11px;
  font-weight: 700; color: var(--gray); text-transform: uppercase; letter-spacing: 0.07em;
  border-bottom: 2px solid var(--border);
}
.admin-table td { padding: 13px 14px; border-bottom: 1px solid #f0f0ed; font-size: 13.5px; color: var(--gray); }
.admin-table tbody tr:last-child td { border-bottom: none; }
.admin-table tbody tr:hover { background: #fafaf8; }
.bold { font-weight: 700; color: var(--dark); }
.mono { font-family: monospace; }
.text-gray { color: var(--gray-light); }
.text-center { text-align: center; }

/* Toggle switch */
.toggle { position: relative; display: inline-block; width: 40px; height: 22px; }
.toggle input { display: none; }
.slider {
  position: absolute; inset: 0; background: #ccc; border-radius: 22px; cursor: pointer; transition: 0.3s;
}
.toggle input:checked + .slider { background: var(--primary); }
.slider::before {
  content: ''; position: absolute; width: 16px; height: 16px; left: 3px; bottom: 3px;
  background: white; border-radius: 50%; transition: 0.3s;
}
.toggle input:checked + .slider::before { transform: translateX(18px); }

/* Permisos checks */
.permisos-check { display: flex; gap: 16px; flex-wrap: wrap; }
.perm-label {
  display: flex; align-items: center; gap: 6px; font-size: 13px;
  color: var(--dark); cursor: pointer; user-select: none;
}
.perm-label input { accent-color: var(--primary); width: 15px; height: 15px; }

/* Form card */
.form-card {
  background: #f6f6f3; border: 1px solid var(--border); border-radius: 10px;
  padding: 20px; margin-bottom: 24px;
}
.form-card h4 { margin: 0 0 16px; font-size: 14px; font-weight: 700; color: var(--dark); }
.form-row { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-end; }
.form-group { display: flex; flex-direction: column; gap: 6px; min-width: 180px; flex: 1; }
.form-group label { font-size: 10px; font-weight: 700; color: var(--gray); text-transform: uppercase; letter-spacing: 0.06em; }
.form-group.center { align-items: center; }
.form-group input[type="text"],
.form-group input[type="number"] {
  padding: 9px 11px; border: 1.5px solid var(--gray-lighter); border-radius: 7px;
  font-family: inherit; font-size: 13px; color: var(--dark); background: #fff; outline: none;
}
.form-group input:focus { border-color: var(--primary); }
.big-check { width: 18px; height: 18px; accent-color: var(--primary); }
.form-actions { display: flex; gap: 10px; margin-top: 16px; }

/* Inline edit */
.inline-input {
  border: 1.5px solid var(--primary); border-radius: 5px; padding: 5px 8px;
  font-family: inherit; font-size: 13px; color: var(--dark); outline: none; width: 100%;
}

/* Action buttons */
.action-btns { display: flex; gap: 6px; justify-content: center; }
.btn-icon {
  border: none; border-radius: 5px; padding: 5px 9px;
  cursor: pointer; font-size: 13px; transition: 0.2s;
}
.btn-icon.edit  { background: #f0f7e0; color: var(--primary-dark); }
.btn-icon.edit:hover  { background: var(--primary); color: #fff; }
.btn-icon.del   { background: #fde8e8; color: #c0392b; }
.btn-icon.del:hover   { background: #c0392b; color: #fff; }
.btn-icon.save  { background: #e8f5e9; color: #2e7d32; font-weight: 700; }
.btn-icon.cancel { background: #f5f5f3; color: var(--gray); font-weight: 700; }

/* Pills */
.marca-tag {
  background: var(--primary-light); color: var(--primary-dark);
  border: 1px solid rgba(134,187,37,0.3); border-radius: 4px;
  padding: 2px 8px; font-size: 11px; font-weight: 700; text-transform: uppercase;
}
.estado-pill {
  padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 700;
}
.activo   { background: var(--primary-light); color: var(--primary-dark); }
.inactivo { background: #f0f0ed; color: var(--gray); }

.info-note {
  margin-top: 18px; font-size: 12px; color: var(--gray); background: #fafaf8;
  padding: 10px 14px; border-radius: 7px; border: 1px solid var(--border);
}
.loading-msg { color: var(--gray); padding: 20px 0; font-size: 14px; }
.no-data { text-align: center; color: var(--gray-light); padding: 30px; font-size: 14px; }

/* ── Buscador ── */
.search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f6f6f3;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 14px;
  margin-bottom: 16px;
}
.search-icon { font-size: 14px; color: var(--gray); flex-shrink: 0; }
.search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-family: inherit;
  font-size: 13px;
  color: var(--dark);
}
.result-count {
  font-size: 11px;
  color: var(--gray-light);
  font-weight: 600;
  white-space: nowrap;
}

/* ── Paginación ── */
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 4px;
  margin-top: 8px;
  flex-wrap: wrap;
  gap: 10px;
  border-top: 1px solid var(--border);
}
.pag-info { font-size: 13px; color: var(--gray); font-weight: 500; }
.pag-controls { display: flex; align-items: center; gap: 5px; }
.pag-select {
  padding: 6px 9px;
  border: 1.5px solid var(--gray-lighter);
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  color: var(--dark);
  background: #fafaf8;
  cursor: pointer;
  outline: none;
  margin-right: 6px;
}
.pag-btn {
  background: var(--white);
  border: 1.5px solid var(--gray-lighter);
  color: var(--gray);
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s;
  font-family: inherit;
  line-height: 1;
}
.pag-btn:hover:not(:disabled) { background: var(--primary); border-color: var(--primary); color: #fff; }
.pag-btn:disabled { opacity: 0.3; cursor: not-allowed; }
/* ── Carga masiva ── */
.masiva-explainer {
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: #f6f6f3;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px 24px;
  margin-bottom: 28px;
}
.explainer-step {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.step-num {
  width: 28px; height: 28px;
  background: var(--primary);
  color: #fff;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 800;
  flex-shrink: 0;
}
.explainer-step strong { font-size: 13px; font-weight: 700; color: var(--dark); display: block; margin-bottom: 2px; }
.explainer-step p { margin: 0; font-size: 12px; color: var(--gray); }
.explainer-step em { color: var(--primary-dark); font-style: normal; font-weight: 700; }

.masiva-actions {
  display: flex;
  gap: 20px;
  align-items: stretch;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.btn-template-big {
  background: var(--dark);
  color: #fff;
  border: none;
  padding: 14px 24px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s;
  white-space: nowrap;
}
.btn-template-big:hover { background: #333; }

.upload-zone {
  flex: 1;
  min-width: 220px;
  border: 2px dashed var(--gray-lighter);
  border-radius: 10px;
  transition: border-color 0.2s, background 0.2s;
  background: #fafaf8;
}
.upload-zone:hover:not(.uploading) { border-color: var(--primary); background: var(--primary-light); }
.upload-zone.uploading { opacity: 0.6; }
.upload-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 22px;
  cursor: pointer;
  height: 100%;
  font-family: inherit;
}
.upload-icon { font-size: 24px; }
.upload-label span:nth-child(2) { font-size: 14px; font-weight: 700; color: var(--dark); }
.upload-hint { font-size: 11px; color: var(--gray-light); }

.masiva-resultado {
  border-radius: 10px;
  padding: 16px 20px;
  border: 1px solid;
}
.masiva-resultado.ok      { background: #f0fde4; border-color: rgba(134,187,37,0.4); }
.masiva-resultado.parcial { background: #fff8e1; border-color: #ffe082; }
.masiva-resultado.error   { background: #fde8e8; border-color: #f5b7b1; }
.resultado-titulo  { font-size: 14px; font-weight: 700; margin: 0 0 4px; color: var(--dark); }
.resultado-detalle { font-size: 13px; color: var(--gray); margin: 0 0 8px; }
.resultado-errores { margin: 0; padding-left: 18px; font-size: 12px; color: #c0392b; }
.resultado-errores li { margin-bottom: 2px; }

.pag-current {
  padding: 5px 12px;
  background: var(--primary-light);
  color: var(--primary-dark);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid rgba(134,187,37,0.3);
  white-space: nowrap;
}

/* ── Tasas de cambio ─────────────────────────── */
.tasas-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 16px; }
.tasa-card { border-radius: 12px; padding: 24px; border: 1px solid var(--border); }
.bcv-card   { background: linear-gradient(135deg, #f0f7ff 0%, #e8f4fd 100%); border-color: #aecde8; }
.binance-card { background: linear-gradient(135deg, #fffbf0 0%, #fef3d0 100%); border-color: #f0c040; }
.tasa-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.tasa-icon { font-size: 22px; }
.tasa-label { font-size: 14px; font-weight: 700; color: var(--text); }
.tasa-valor { font-size: 28px; font-weight: 800; color: var(--primary-dark); margin-bottom: 8px; }
.tasa-note { font-size: 12px; color: var(--gray); }
.tasa-input-row { display: flex; gap: 8px; margin-top: 14px; }
.tasa-input { flex: 1; padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }

/* ── Pill tasa en tabla ───────────────────────── */
.tasa-pill { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; }
.tasa-pill.bcv     { background: #e8f4fd; color: #1a6fa3; }
.tasa-pill.binance { background: #fef3d0; color: #b07a00; }
.tasa-select    { padding: 6px 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; width: 100%; }
.tasa-select-sm { padding: 4px 8px;  border: 1px solid #ddd; border-radius: 6px; font-size: 12px; }
/* Sistema tab */
.version-badge  { background: var(--accent, #4f46e5); color: #fff; border-radius: 12px; padding: 3px 14px; font-size: 13px; font-weight: 700; }
.sys-block      { margin-bottom: 20px; }
.sys-label      { display: block; font-size: 12px; font-weight: 700; color: var(--gray); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
.sys-url-row    { display: flex; gap: 8px; align-items: stretch; }
.sys-url-input  { flex: 1; padding: 10px 12px; border: 1.5px solid var(--border, #ddd); border-radius: 8px; font-size: 13px; outline: none; }
.sys-url-input:focus { border-color: var(--accent, #4f46e5); }
.btn-save-url   { padding: 0 18px; background: #f3f4f6; color: #374151; border: 1.5px solid #d1d5db; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.btn-save-url:hover { background: #e5e7eb; }
.url-saved-msg  { font-size: 12px; color: #16a34a; margin-top: 4px; display: block; }
.btn-actualizar { display: inline-flex; align-items: center; gap: 8px; padding: 11px 28px; background: var(--accent, #4f46e5); color: #fff; border: none; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; }
.btn-actualizar:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-actualizar:not(:disabled):hover { filter: brightness(1.1); }
.btn-spinner    { width: 16px; height: 16px; border: 2.5px solid rgba(255,255,255,.35); border-top-color: #fff; border-radius: 50%; animation: spin 0.75s linear infinite; flex-shrink: 0; }
@keyframes spin { to { transform: rotate(360deg); } }
.sys-msg        { margin-top: 16px; padding: 12px 16px; border-radius: 8px; font-size: 14px; }
.sys-msg.ok     { background: #d1fae5; color: #065f46; }
.sys-msg.err    { background: #fee2e2; color: #991b1b; }
.sys-help       { margin-top: 24px; padding: 14px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; color: #475569; line-height: 1.6; }
.sys-help code  { background: #e2e8f0; padding: 1px 6px; border-radius: 4px; font-family: monospace; }

/* ── Conexión tab ─────────────────────────────── */
.conn-badge       { padding: 3px 12px; border-radius: 12px; font-size: 12px; font-weight: 700; }
.conn-badge.ok    { background: #d1fae5; color: #065f46; }
.conn-badge.loading { background: #fef3c7; color: #92400e; }
.conn-grid        { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
.conn-input       { padding: 9px 12px; border: 1.5px solid var(--border, #ddd); border-radius: 8px; font-size: 13px; font-family: inherit; outline: none; width: 100%; box-sizing: border-box; }
.conn-input:focus { border-color: var(--primary); }
.conn-warning     { background: #fef9c3; border: 1px solid #fde047; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #713f12; margin-bottom: 20px; }
.conn-actions     { display: flex; gap: 12px; align-items: center; }
</style>
