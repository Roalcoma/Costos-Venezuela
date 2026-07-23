<template>
  <div class="page-container">
    <div class="page-header">
      <h1>Gestión de Contenedores</h1>
      <div class="header-btns">
        <button class="btn-cierre-masivo" @click="ejecutarCierreMasivo" :disabled="cargandoCierre">
          <span v-if="cargandoCierre">⏳ Procesando...</span>
          <span v-else>🚀 Ejecutar Cierre Masivo</span>
        </button>
        <button class="btn-primary" @click="abrirModal">+ Nuevo Contenedor</button>
      </div>
    </div>

    <div class="search-box">
      <div class="input-with-icon">
        <span class="icon">🔍</span>
        <input v-model="search" placeholder="Buscar por contenedor, importador o buque..." />
      </div>
      <div class="date-filter">
        <label>Filtrar por ETD:</label>
        <input type="date" v-model="fechaFiltro" />
      </div>
    </div>

    <div class="table-card">
      <table class="modern-table">
        <thead>
          <tr>
            <th>CONTENEDOR</th>
            <th>FECHA (ETD)</th>
            <th>IMPORTADOR</th>
            <th>BUQUE</th>
            <th>MARCAS</th>
            <th>VALOR US$</th>
            <th class="text-center">GASTOS</th>
            <th>ESTADO</th>
            <th class="text-center">ACCIONES</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in filtrados" :key="c.CONTENEDORID" @click="$router.push(`/contenedor/${c.CONTENEDORID}`)">
            <td class="bold-text">{{ c.NUMEROCONTENEDOR }}</td>
            <td>{{ formatearFecha(c.FECHASALIDA_ETD) }}</td>
            <td>{{ c.IMPORTADOR }}</td>
            <td>{{ c.BUQUE_VIAJE }}</td>
            <td>
              <div class="marcas-cell">
                <span v-for="m in (c.MARCAS || '').split(', ').filter((x: string) => x)" :key="m" class="marca-pill">{{ m }}</span>
              </div>
            </td>
            <td class="amount">${{ Number(c.VALOR_USS).toLocaleString('en-US', { minimumFractionDigits: 2 }) }}</td>
            <td class="text-center">
              <div class="gastos-badge-wrap">
                <span v-if="c.GASTOS_COUNT > 0" class="gastos-badge ok">
                  ✓ {{ c.GASTOS_COUNT }} gasto{{ c.GASTOS_COUNT > 1 ? 's' : '' }}
                </span>
                <span v-else class="gastos-badge none">Sin gastos</span>
                <div v-if="c.GASTOS_COUNT > 0 && c.GASTOS_DETALLE" class="gastos-tooltip">
                  <div class="tooltip-title">Gastos cargados</div>
                  <div v-for="linea in c.GASTOS_DETALLE.split(' | ')" :key="linea" class="tooltip-linea">{{ linea }}</div>
                </div>
              </div>
            </td>
            <td>
              <span class="badge" :class="c.ESTATUS.toLowerCase()">{{ c.ESTATUS }}</span>
            </td>
            <td class="actions-cell">
              <button
                v-if="c.ESTATUS.toLowerCase() !== 'procesado'"
                class="btn-delete"
                @click.stop="eliminarContenedor(c.CONTENEDORID)"
                title="Eliminar contenedor"
              >
                🗑️
              </button>
              <button
                v-if="esAdmin && c.ESTATUS.toLowerCase() === 'procesado'"
                class="btn-delete btn-delete-admin"
                @click.stop="eliminarContenedorCompleto(c.CONTENEDORID, c.NUMEROCONTENEDOR)"
                title="[Admin] Borrado completo (incluye ERP)"
              >
                🛡🗑️
              </button>
            </td>
          </tr>
          <tr v-if="filtrados.length === 0">
            <td colspan="9" class="no-data">No se encontraron contenedores registrados.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal con Dropdown Personalizado integrado (Apertura hacia abajo) -->
    <div v-if="mostrarModal" class="modal-overlay">
      <div class="modal-content wide-modal">
        <div class="modal-header">
          <h2>📦 Registro de Importación</h2>
          <button @click="mostrarModal = false" class="btn-close">&times;</button>
        </div>
        
        <form @submit.prevent="guardarNuevoContenedor" class="modal-grid">
          <div class="input-group custom-select-group">
            <label># Contenedor</label>
            <input 
              type="text" 
              v-model="busquedaContenedorModal"
              @focus="mostrarDropdownModal = true"
              @input="mostrarDropdownModal = true"
              @blur="ocultarDropdownConDelay"
              placeholder="Escribe para buscar o selecciona..." 
              required 
            />
            
            <div 
              v-if="mostrarDropdownModal" 
              class="options-dropdown"
            >
              <div 
                v-for="(item, index) in contenedoresFiltradosModal" 
                :key="index" 
                class="option-item"
                @mousedown.prevent="seleccionarContenedorModal(item.CONTENEDOR)"
              >
                {{ item.CONTENEDOR }}
              </div>
              <div v-if="contenedoresFiltradosModal.length === 0" class="option-item no-results">
                No hay coincidencias
              </div>
            </div>
          </div>

          <div class="input-group">
            <label>Bill of Lading</label>
            <input v-model="nuevoContenedor.BILLOFLADING" placeholder="MEDUPA..." />
          </div>
          <div class="input-group">
            <label>Buque / Viaje</label>
            <input v-model="nuevoContenedor.BUQUE_VIAJE" placeholder="MSC SAMIRA III..." />
          </div>
          <div class="input-group">
            <label>Importador</label>
            <input v-model="nuevoContenedor.IMPORTADOR" placeholder="Nombre de la empresa" />
          </div>
          <div class="input-group">
            <label>Procedencia</label>
            <input v-model="nuevoContenedor.PROCEDENCIA" placeholder="Panamá, etc." />
          </div>
          <div class="input-group">
            <label>Fecha ETD (Salida)</label>
            <input type="date" v-model="nuevoContenedor.FECHASALIDA_ETD" required />
          </div>
          <div class="input-group">
            <label>Fecha ETA (Llegada)</label>
            <input type="date" v-model="nuevoContenedor.FECHALLEGADA_ETA" />
          </div>
          <div class="input-group">
            <label>Valor FOB (US$)</label>
            <input type="number" v-model.number="nuevoContenedor.VALOR_USS" min="0" step="0.01" placeholder="0.00" />
          </div>
          <div class="input-group">
            <label>% Ajuste sobre FOB</label>
            <input type="number" v-model.number="multiplicadorPorcentaje" min="0" step="0.01" placeholder="0.00" />
          </div>
          <div class="input-group">
            <label>Valor Final US$</label>
            <div class="valor-display">${{ valorMercanciaFinal.toLocaleString('en-US', { minimumFractionDigits: 2 }) }}</div>
          </div>

          <button type="submit" class="btn-submit" :disabled="cargando">
            {{ cargando ? 'Procesando...' : 'Confirmar Registro Logístico' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { apiService } from '../services/api';
import { isAdmin as checkAdmin } from '../utils/auth';

const mostrarModal = ref(false);
const cargando = ref(false);
const cargandoCierre = ref(false);
const search = ref('');
const fechaFiltro = ref('');
const contenedores = ref<any[]>([]);
const contenedoresDisponibles = ref<any[]>([]);
const esAdmin = ref(false);

// Variables para el dropdown de contenedor personalizado
const busquedaContenedorModal = ref('');
const mostrarDropdownModal = ref(false);

const contenedoresFiltradosModal = computed(() => {
  if (!busquedaContenedorModal.value) return contenedoresDisponibles.value;
  return contenedoresDisponibles.value.filter(item =>
    item.CONTENEDOR?.toLowerCase().includes(busquedaContenedorModal.value.toLowerCase())
  );
});

const seleccionarContenedorModal = (codigo: string) => {
  nuevoContenedor.value.NUMEROCONTENEDOR = codigo;
  busquedaContenedorModal.value = codigo;
  mostrarDropdownModal.value = false;
};

const ocultarDropdownConDelay = () => {
  setTimeout(() => {
    mostrarDropdownModal.value = false;
  }, 200);
};

const abrirModal = () => {
  nuevoContenedor.value.NUMEROCONTENEDOR = '';
  busquedaContenedorModal.value = '';
  mostrarDropdownModal.value = false;
  mostrarModal.value = true;
};

// Variables para el valor y el porcentaje
const multiplicadorPorcentaje = ref(0);
const nuevoContenedor = ref({
  NUMEROCONTENEDOR: '',
  BILLOFLADING: '',
  BUQUE_VIAJE: '',
  ESTATUS: 'TRANSITO',
  TAMANO: '40HC',
  IMPORTADOR: '',
  PROCEDENCIA: '',
  NUMEROFACTURA: '',
  VALOR_USS: 0,
  BULTOS: 0,
  FECHASALIDA_ETD: '',
  FECHALLEGADA_ETA: '',
  OBSERVACIONES: ''
});

// Computed para calcular el valor final con el incremento
const valorMercanciaFinal = computed(() => {
  const valorBase = Number(nuevoContenedor.value.VALOR_USS) || 0;
  const porcentaje = Number(multiplicadorPorcentaje.value) || 0;
  const incremento = valorBase * (porcentaje / 100);
  return valorBase + incremento;
});

// Función para formatear fechas de SQL a formato legible
const formatearFecha = (fechaStr: string) => {
  if (!fechaStr) return '---';
  const fecha = new Date(fechaStr);
  return fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const cargarContenedores = async () => {
  try {
    const res = await apiService.getTodos();
    contenedores.value = res.data;
  } catch (error) {
    console.error("Error al cargar:", error);
  }
};

const cargarContenedoresDisponibles = async () => {
  try {
    const res = await apiService.getDisponibles();
    contenedoresDisponibles.value = (res.data).contenedores;
  } catch (error) {
    console.error("Error al cargar la lista de contenedores:", error);
  }
};

const guardarNuevoContenedor = async () => {
  try {
    cargando.value = true;
    
    // Aseguramos que tome el valor ingresado en el input de búsqueda
    nuevoContenedor.value.NUMEROCONTENEDOR = busquedaContenedorModal.value;

    const contenedorAGuardar = {
      ...nuevoContenedor.value,
      VALOR_USS: valorMercanciaFinal.value
    };

    await apiService.crearContenedor(contenedorAGuardar);
    
    alert("Registro exitoso");
    mostrarModal.value = false;
    await cargarContenedores();
    
    nuevoContenedor.value = { 
      NUMEROCONTENEDOR: '', BILLOFLADING: '', BUQUE_VIAJE: '', ESTATUS: 'TRANSITO',
      TAMANO: '40HC', IMPORTADOR: '', PROCEDENCIA: '', NUMEROFACTURA: '',
      VALOR_USS: 0, BULTOS: 0, FECHASALIDA_ETD: '', FECHALLEGADA_ETA: '', OBSERVACIONES: '' 
    };
    busquedaContenedorModal.value = '';
    multiplicadorPorcentaje.value = 0;
    
  } catch (error) {
    alert("Error al guardar");
  } finally {
    cargando.value = false;
  }
};

const eliminarContenedor = async (id: number) => {
  const confirmacion = confirm("¿Estás seguro de que deseas eliminar este contenedor? Esta acción borrará también sus gastos y no se puede deshacer.");
  if (!confirmacion) return;

  try {
    const res = await apiService.deleteContenedor(id);
    if (res.data.success) {
      await cargarContenedores();
    } else {
      alert("Hubo un problema al intentar eliminar el contenedor.");
    }
  } catch (error) {
    console.error("Error al eliminar:", error);
    alert("Ocurrió un error en el servidor.");
  }
};

const filtrados = computed(() => {
  return contenedores.value.filter(c => {
    const matchBusqueda = (c.NUMEROCONTENEDOR + c.IMPORTADOR + c.BUQUE_VIAJE).toLowerCase().includes(search.value.toLowerCase());
    const matchFecha = fechaFiltro.value ? c.FECHASALIDA_ETD.includes(fechaFiltro.value) : true;
    return matchBusqueda && matchFecha;
  });
});

const ejecutarCierreMasivo = async () => {
  const pendientes = contenedores.value.filter(c => c.ESTATUS.toLowerCase() !== 'procesado');
  if (pendientes.length === 0) return alert('No hay contenedores pendientes de cierre.');
  if (!confirm(`¿Ejecutar cierre en los ${pendientes.length} contenedor(es) pendiente(s)?\n\nEsta operación puede tardar varios minutos.`)) return;

  cargandoCierre.value = true;
  try {
    const res = await apiService.cierreMasivo();
    const { total, exitosos, fallidos, resultados } = res.data;
    const lineas = Object.entries(resultados)
      .map(([num, r]: [string, any]) =>
        r.ok
          ? `✓ ${num}: ${Object.values(r.detalle as Record<string, any>).reduce((s: number, d: any) => s + (d.lineasInsertadas || 0), 0)} líneas insertadas`
          : `✗ ${num}: ${r.error}`
      ).join('\n');
    alert(`Cierre masivo finalizado.\n\n${exitosos} exitoso(s), ${fallidos} fallido(s) de ${total}.\n\n${lineas}`);
    await cargarContenedores();
  } catch (e: any) {
    alert(e?.response?.data?.error || 'Error durante el cierre masivo.');
  } finally {
    cargandoCierre.value = false;
  }
};

const eliminarContenedorCompleto = async (id: number, numero: string) => {
  const confirmacion = confirm(`⚠️ BORRADO TOTAL\n\n¿Eliminar el contenedor "${numero}" junto con todos sus gastos en el ERP (ALBCOMPRAGASTOS)?\n\nEsta acción NO se puede deshacer.`);
  if (!confirmacion) return;
  try {
    await apiService.deleteContenedorCompleto(id);
    alert('Contenedor y sus datos del ERP eliminados correctamente.');
    await cargarContenedores();
  } catch (error: any) {
    console.error('Error al eliminar completo:', error);
    alert(error?.response?.data?.error || 'Ocurrió un error en el servidor.');
  }
};

onMounted(() => {
  esAdmin.value = checkAdmin();
  cargarContenedores();
  cargarContenedoresDisponibles();
});
</script>

<style scoped>
/* ── Página ───────────────────────────────── */
.page-container { padding: 24px 28px; }
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
h1 {
  color: var(--dark);
  font-size: 22px;
  font-weight: 800;
  margin: 0;
  letter-spacing: -0.01em;
}

/* ── Botones ──────────────────────────────── */
.btn-primary {
  background: var(--primary);
  color: #fff;
  padding: 11px 22px;
  border: none;
  border-radius: 8px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
  font-family: inherit;
}
.btn-primary:hover { background: var(--primary-dark); transform: translateY(-1px); }

/* ── Buscador ─────────────────────────────── */
.search-box {
  display: flex;
  gap: 16px;
  background: var(--white);
  padding: 14px 16px;
  border-radius: 10px;
  margin-bottom: 22px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  align-items: flex-end;
  border: 1px solid var(--border);
}
.input-with-icon {
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--bg-main);
  border: 1px solid var(--gray-lighter);
  border-radius: 7px;
  padding: 0 12px;
  transition: border-color 0.2s;
}
.input-with-icon:focus-within { border-color: var(--primary); }
.input-with-icon .icon { color: var(--gray); font-size: 14px; margin-right: 6px; }
.input-with-icon input {
  width: 100%;
  border: none;
  background: transparent;
  padding: 10px 4px;
  outline: none;
  font-family: inherit;
  font-size: 14px;
  color: var(--dark);
}
.date-filter { display: flex; flex-direction: column; gap: 5px; }
.date-filter label { font-size: 11px; font-weight: 700; color: var(--gray); text-transform: uppercase; letter-spacing: 0.05em; }
.date-filter input { padding: 9px 10px; border: 1px solid var(--gray-lighter); border-radius: 7px; font-family: inherit; color: var(--dark); outline-color: var(--primary); }

/* ── Tabla ────────────────────────────────── */
.table-card {
  background: var(--white);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.07);
  overflow: hidden;
  border: 1px solid var(--border);
}
.modern-table { width: 100%; border-collapse: collapse; }
.modern-table th {
  background: #f6f6f3;
  padding: 12px 16px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  color: var(--gray);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  border-bottom: 2px solid var(--border);
}
.modern-table td {
  padding: 15px 16px;
  border-bottom: 1px solid #f0f0ed;
  font-size: 13.5px;
  color: var(--gray);
}
.modern-table tbody tr:hover { background: var(--primary-light); cursor: pointer; }
.modern-table tbody tr:last-child td { border-bottom: none; }
.bold-text { font-weight: 700; color: var(--dark); }
.amount { font-family: 'Courier New', monospace; font-weight: 700; color: var(--dark); }
.text-center { text-align: center !important; }

/* ── Badges de estado ─────────────────────── */
.badge { padding: 4px 12px; border-radius: 99px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.badge.transito  { background: var(--primary-light); color: var(--primary-dark); }
.badge.recibido  { background: #e0f7fa; color: #006064; }
.badge.procesado { background: #f0f0ed; color: var(--gray); }

/* ── Botón eliminar ───────────────────────── */
.actions-cell { text-align: center; }
.btn-delete {
  background: #fde8e8;
  color: #c0392b;
  border: none;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: 0.2s;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.btn-delete:hover { background: #c0392b; color: white; transform: scale(1.06); }
.btn-delete-admin { background: #fff0d0; color: #8a5c00; }
.btn-delete-admin:hover { background: #e67e22; color: white; }

/* ── Pills de marcas ──────────────────────── */
.marcas-cell { display: flex; flex-wrap: wrap; gap: 4px; }
.marca-pill {
  background: var(--primary-light);
  color: var(--primary-dark);
  border: 1px solid rgba(134,187,37,0.3);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  text-transform: uppercase;
}

/* ── Modal ────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(32,32,32,0.65);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}
.wide-modal {
  width: 820px;
  max-width: 95%;
  background: var(--white);
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 30px 60px rgba(0,0,0,0.2);
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 28px;
}
.modal-header h2 { margin: 0; font-size: 18px; font-weight: 800; color: var(--dark); }
.btn-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--gray);
  line-height: 1;
  padding: 0;
  transition: color 0.2s;
}
.btn-close:hover { color: var(--dark); }

.modal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.input-group { display: flex; flex-direction: column; gap: 7px; }
.input-group label {
  font-size: 11px;
  font-weight: 700;
  color: var(--gray);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.input-group input,
.input-group select {
  padding: 10px 12px;
  border: 1.5px solid var(--gray-lighter);
  border-radius: 7px;
  outline: none;
  font-family: inherit;
  font-size: 14px;
  color: var(--dark);
  background: #fafaf8;
  transition: border-color 0.2s;
}
.input-group input:focus,
.input-group select:focus { border-color: var(--primary); background: var(--white); }
.valor-display { padding: 10px 12px; background: var(--gray-lighter, #f0f0ee); border-radius: 7px; font-size: 14px; font-weight: 700; color: var(--dark); }

/* ── Custom Select / Dropdown Posicionamiento Hacia Abajo ── */
.custom-select-group {
  position: relative;
}

.options-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 180px;
  overflow-y: auto;
  background: #ffffff;
  border: 1.5px solid var(--gray-lighter, #e0e0e0);
  border-radius: 7px;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
  z-index: 1050;
  margin-top: 4px;
}

.option-item {
  padding: 10px 12px;
  cursor: pointer;
  font-size: 13.5px;
  color: var(--dark, #333);
  transition: background 0.15s;
}

.option-item:hover {
  background: var(--primary-light, #f0f7e6);
}

.option-item.no-results {
  color: var(--gray, #888);
  cursor: default;
}

.help-text { color: var(--gray); font-size: 11px; margin-top: 3px; font-weight: 600; }
.btn-submit {
  grid-column: span 2;
  background: var(--primary);
  color: white;
  padding: 14px;
  border: none;
  border-radius: 99px;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  margin-top: 8px;
  font-family: inherit;
  transition: background 0.2s, transform 0.1s;
}
.btn-submit:hover:not(:disabled) { background: var(--primary-dark); transform: translateY(-1px); }
.btn-submit:disabled { opacity: 0.55; cursor: not-allowed; }

.no-data { text-align: center; color: var(--gray-light); padding: 50px; font-size: 14px; }

/* ── Header botones ───────────────────────── */
.header-btns { display: flex; gap: 10px; align-items: center; }

.btn-cierre-masivo {
  background: #202020;
  color: #fff;
  padding: 11px 20px;
  border: none;
  border-radius: 8px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
  font-family: inherit;
  white-space: nowrap;
}
.btn-cierre-masivo:hover:not(:disabled) { background: var(--primary-dark); }
.btn-cierre-masivo:disabled { opacity: 0.55; cursor: not-allowed; }

/* ── Badge de gastos con tooltip ──────────── */
.gastos-badge-wrap {
  position: relative;
  display: inline-block;
}
.gastos-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 99px;
  font-size: 11px;
  font-weight: 700;
  cursor: default;
  white-space: nowrap;
}
.gastos-badge.ok {
  background: var(--primary-light);
  color: var(--primary-dark);
  border: 1px solid rgba(134,187,37,0.35);
}
.gastos-badge.none {
  background: #f5f5f2;
  color: var(--gray-light);
  border: 1px solid var(--border);
}

/* Tooltip */
.gastos-tooltip {
  display: none;
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--dark);
  color: #fff;
  border-radius: 8px;
  padding: 10px 14px;
  min-width: 220px;
  max-width: 320px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.25);
  z-index: 100;
  text-align: left;
}
.gastos-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: var(--dark);
}
.gastos-badge-wrap:hover .gastos-tooltip { display: block; }
.tooltip-title {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--primary);
  margin-bottom: 6px;
}
.tooltip-linea {
  font-size: 12px;
  color: #e0e0dd;
  padding: 2px 0;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}
.tooltip-linea:last-child { border-bottom: none; }
</style>