<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { apiService } from '../services/api';

const route = useRoute();
const router = useRouter();
const id = route.params.id;

// --- ESTADOS ---
const contenedor = ref<any>(null);
const albaranes = ref<any[]>([]);
const ventas = ref<any[]>([]);
const comprasTiendas = ref<any[]>([]);
const listaMaestraGastos = ref<any[]>([]); 
const expandidos = ref<Record<string, boolean>>({});
const cargando = ref(true);

const nuevoGasto = ref({
  NOMBREGASTO: '', CODIGO_ERP: '', IMPORTE: 0, FACTOR: 0, DESCRIPCIONGASTO: '',
  MAESTRO_GASTO_ID: null as number | null,
  TASA_CAMBIO: null as number | null,
  FECHA_PAGO: '' as string
});

const gastoSeleccionado = computed(() =>
  listaMaestraGastos.value.find(g => g.CODIGO_ERP === nuevoGasto.value.CODIGO_ERP) ?? null
);

// Limpia campos extra al cambiar de gasto
watch(() => nuevoGasto.value.CODIGO_ERP, () => {
  nuevoGasto.value.TASA_CAMBIO = null;
  nuevoGasto.value.FECHA_PAGO = '';
});

// --- CARGA DE DATOS ---
const cargarTodo = async () => {
  try {
    cargando.value = true;
    const resDetalle = await apiService.getDetalleContenedor(Number(id));
    contenedor.value = resDetalle.data;

    if (contenedor.value?.NUMEROCONTENEDOR) {
      const [resAlb, resVen, resCompT, resMaestro] = await Promise.all([
        apiService.getAlbaranesAsociados(contenedor.value.NUMEROCONTENEDOR),
        apiService.getVentasTiendas(contenedor.value.NUMEROCONTENEDOR),
        apiService.getComprasTiendas(contenedor.value.NUMEROCONTENEDOR),
        apiService.getMaestroGastos('ALL')
      ]);
      albaranes.value = resAlb.data;
      ventas.value = resVen.data;
      comprasTiendas.value = resCompT.data;
      listaMaestraGastos.value = resMaestro.data;
    }
  } catch (error) { console.error(error); } finally { cargando.value = false; }
};

// --- PROPIEDADES COMPUTADAS (TOTALES) ---
const totalAlbaranes = computed(() => {
  return albaranes.value.reduce((acc, alb) => acc + Number(alb.TOTALNETO || 0), 0);
});

const totalVentas = computed(() => {
  return ventas.value.reduce((acc, v) => acc + Number(v.TOTALNETO || 0), 0);
});

const totalCostoChina = computed(() => {
  return ventas.value.reduce((acc, v) => acc + Number(v.COSTO_REAL_CHINA || 0), 0);
});

// --- ACCIONES DE GASTOS ---
const registrarGasto = async () => {
  if (!nuevoGasto.value.CODIGO_ERP) return alert("Seleccione concepto");
  const item = gastoSeleccionado.value;
  if (!item) return alert("Concepto no encontrado");
  if (item.TIPO_TASA === 'BINANCE' && !nuevoGasto.value.TASA_CAMBIO) {
    return alert("Este gasto usa Tasa Binance. Ingrese la cotización actual.");
  }
  if (item.TIPO_TASA === 'BCV' && !nuevoGasto.value.FECHA_PAGO) {
    return alert("Este gasto usa Tasa BCV. Ingrese la fecha en que realizó el pago.");
  }
  try {
    await apiService.agregarGasto({
      ...nuevoGasto.value,
      NOMBREGASTO: item.NOMBRE_GASTO,
      MAESTRO_GASTO_ID: item.ID,
      CONTENEDORID: Number(id)
    });
    nuevoGasto.value = { NOMBREGASTO: '', CODIGO_ERP: '', IMPORTE: 0, FACTOR: 0, DESCRIPCIONGASTO: '', MAESTRO_GASTO_ID: null, TASA_CAMBIO: null, FECHA_PAGO: '' };
    await cargarTodo();
  } catch (error) { alert("Error al registrar gasto"); }
};

const eliminarGasto = async (gastoId: number) => {
  if (!confirm("¿Eliminar este gasto?")) return;
  try {
    await apiService.eliminarGasto(gastoId);
    await cargarTodo();
  } catch (error) { alert("No se pudo eliminar el gasto."); }
};

const editarGastoPrompt = async (gasto: any) => {
  const nuevoMonto = prompt(`Editar importe para ${gasto.NOMBREGASTO}:`, gasto.IMPORTE);
  if (nuevoMonto !== null) {
    const monto = parseFloat(nuevoMonto);
    const nuevoFactor = monto / contenedor.value.VALOR_USS;
    try {
      await apiService.actualizarGasto(gasto.GASTOID, { 
        IMPORTE: monto, 
        FACTOR: nuevoFactor, 
        DESCRIPCIONGASTO: gasto.DESCRIPCIONGASTO 
      });
      await cargarTodo();
    } catch (error) { alert("Error al actualizar"); }
  }
};

const calcularFactorAuto = () => { if (contenedor.value?.VALOR_USS > 0) nuevoGasto.value.FACTOR = nuevoGasto.value.IMPORTE / contenedor.value.VALOR_USS; };

const procesarCierre = async () => {
  if (!confirm("Se procesarán los costos en el ERP. ¿Continuar?")) return;
  try {
    cargando.value = true;
    const resp = await apiService.procesarGastosERP(Number(id));
    const detalle = resp.data?.detalle ?? {};
    const lineas = Object.entries(detalle)
      .map(([marca, d]: [string, any]) =>
        d.error
          ? `${marca}: ERROR → ${d.error}`
          : `${marca}: ${d.albaranesTienda} albaranes, ${d.lineasInsertadas} líneas insertadas`
      ).join('\n');
    alert(`Cierre completado.\n\n${lineas || 'Sin detalle disponible.'}`);
    await cargarTodo();
  } catch (error: any) {
    alert(`Error durante el proceso: ${error?.response?.data?.error || error.message}`);
  } finally {
    cargando.value = false;
  }
};

// --- FUNCIONES DE TABLA Y FORMATO ---
const fFecha = (f: string) => f ? new Date(f).toLocaleDateString('es-ES') : '---';
const toggleRow = (doc: string) => expandidos.value[doc] = !expandidos.value[doc];
const obtenerComprasDeVenta = (doc: string) => comprasTiendas.value.filter(c => c.DOCUMENTOVENTA === doc);

const obtenerInfoTienda = (docVenta: string) => {
  const compra = comprasTiendas.value.find(c => c.DOCUMENTOVENTA === docVenta);
  return compra ? {
    NOMBRECOMERCIAL: compra.NOMBRECOMERCIAL || '---',
    POBLACION: compra.POBLACION || '---',
    MARCA: compra.MARCA || '---'
  } : { NOMBRECOMERCIAL: '---', POBLACION: '---', MARCA: '---' };
};

onMounted(cargarTodo);
</script>

<template>
  <div v-if="cargando" class="loading-overlay">
    <div class="spinner"></div>
    <p>Procesando cierre, por favor espere...</p>
  </div>

  <div v-if="contenedor" class="container-detail">
    <div class="header-actions">
      <button @click="router.push('/')" class="btn-back">← Volver al Listado</button>
      <div class="title-row">
        <div class="main-titles">
          <h1>{{ contenedor.NUMEROCONTENEDOR }}</h1>
          <p class="subtitle">{{ contenedor.IMPORTADOR }} | BL: {{ contenedor.BL }}</p>
        </div>
        <span class="status-badge" :class="contenedor.ESTATUS.toLowerCase()">{{ contenedor.ESTATUS }}</span>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <label>VALOR FOB DECLARADO</label>
        <div class="value primary">${{ Number(contenedor.VALOR_USS).toLocaleString() }}</div>
      </div>
      <div class="kpi-card">
        <label>GASTOS TOTALES</label>
        <div class="value danger">${{ contenedor.gastos?.reduce((a:any, g:any) => a + Number(g.IMPORTE), 0).toLocaleString() }}</div>
      </div>
      <div class="kpi-card" v-if="contenedor.MARCAS">
        <label>MARCAS EN CONTENEDOR</label>
        <div class="marcas-kpi">
          <span v-for="m in contenedor.MARCAS.split(', ').filter((x: string) => x)" :key="m" class="marca-pill-kpi">{{ m }}</span>
        </div>
      </div>
    </div>

    <section class="section-card">
      <div class="section-header">
        <div class="h3-group">
          <h3>Distribución y Cierre de Costos</h3>
          <p class="help-text">Los gastos se prorratearán basándose en el valor FOB.</p>
        </div>
        <button v-if="contenedor.ESTATUS !== 'PROCESADO'" @click="procesarCierre" class="btn-erp">🚀 Ejecutar Cierre en Tiendas</button>
      </div>

      <div v-if="contenedor.ESTATUS !== 'PROCESADO'" class="expense-form-container">
        <div class="expense-form">
          <div class="form-group">
            <label>Concepto ERP</label>
            <select v-model="nuevoGasto.CODIGO_ERP">
              <option disabled value="">Seleccione...</option>
              <option v-for="g in listaMaestraGastos" :key="g.CODIGO_ERP" :value="g.CODIGO_ERP">{{ g.CODIGO_ERP }} - {{ g.NOMBRE_GASTO }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>Importe ($)</label>
            <input type="number" v-model="nuevoGasto.IMPORTE" @input="calcularFactorAuto" placeholder="0.00" />
          </div>
          <div class="form-group" v-if="gastoSeleccionado?.TIPO_TASA === 'BINANCE'">
            <label>Tasa Binance (Bs./$) <span class="tasa-badge binance">BINANCE</span></label>
            <input type="number" v-model="nuevoGasto.TASA_CAMBIO" placeholder="Ej: 38.50" step="0.01" min="0" />
          </div>
          <div class="form-group" v-if="gastoSeleccionado?.TIPO_TASA === 'BCV'">
            <label>Fecha de pago <span class="tasa-badge bcv">BCV</span></label>
            <input type="date" v-model="nuevoGasto.FECHA_PAGO" />
          </div>
          <div class="form-group factor-group">
            <label>Factor Calculado</label>
            <div class="factor-display">{{ (nuevoGasto.FACTOR * 100).toFixed(4) }}%</div>
          </div>
          <button @click="registrarGasto" class="btn-add">Registrar Gasto</button>
        </div>
      </div>

      <table class="styled-table">
        <thead>
          <tr>
            <th>CONCEPTO</th>
            <th class="text-right">IMPORTE</th>
            <th class="text-right">FACTOR</th>
            <th class="text-right">ACCIONES</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in contenedor.gastos" :key="g.GASTOID">
            <td class="bold">{{ g.NOMBREGASTO }}</td>
            <td class="text-right bold">${{ Number(g.IMPORTE).toLocaleString() }}</td>
            <td class="text-right font-mono">{{ (Number(g.FACTOR) * 100).toFixed(2) }}%</td>
            <td class="text-right">
              <div class="action-buttons" v-if="contenedor.ESTATUS !== 'PROCESADO'">
                <button @click="editarGastoPrompt(g)" class="btn-icon edit" title="Editar">✏️</button>
                <button @click="eliminarGasto(g.GASTOID)" class="btn-icon delete" title="Eliminar">🗑️</button>
              </div>
              <span v-else class="locked-text">🔒 Bloqueado</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="section-card">
      <h3>🚚 Ventas -> Compras Tiendas</h3>
      <table class="styled-table sales-theme">
        <thead>
          <tr>
            <th style="width: 40px"></th>
            <th>DOC. VENTA</th>
            <th>FECHA</th>
            <th>TIENDA / COMERCIAL</th>
            <th>POBLACIÓN</th>
            <th>MARCA</th>
            <th class="text-right">TOTAL</th>
            <th class="text-right">COSTO CHINA</th>
            <th class="text-right">% CONTENEDOR</th>
            <th class="text-center">ESTADO</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="v in ventas" :key="v.DOCUMENTO">
            <tr @click="toggleRow(v.DOCUMENTO)" class="row-clickable">
              <td class="text-center"><span class="arrow-icon" :class="{ 'is-active': expandidos[v.DOCUMENTO] }">▸</span></td>
              <td class="bold">{{ v.DOCUMENTO }}</td>
              <td>{{ fFecha(v.FECHA) }}</td>
              <td>{{ obtenerInfoTienda(v.DOCUMENTO).NOMBRECOMERCIAL }}</td>
              <td>{{ obtenerInfoTienda(v.DOCUMENTO).POBLACION }}</td>
              <td><span class="brand-tag">{{ obtenerInfoTienda(v.DOCUMENTO).MARCA }}</span></td>
              <td class="text-right">${{ Number(v.TOTALNETO).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
              <td class="text-right bold primary-value">${{ Number(v.COSTO_REAL_CHINA || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
              <td class="text-right font-mono">{{ Number(v.PORCENTAJE_CONTENEDOR || 0).toFixed(2) }}%</td>
              <td class="text-center">
                <span :class="['status-pill', v.NORECIBIDO === 'F' ? 'is-received' : 'is-not-received']">
                  {{ v.NORECIBIDO === 'F' ? 'RECIBIDO' : 'PENDIENTE' }}
                </span>
              </td>
            </tr>
            <tr v-if="expandidos[v.DOCUMENTO]">
              <td colspan="10" class="subtable-container">
                <div class="subtable-wrapper">
                  <table class="sub-table">
                    <thead>
                      <tr>
                        <th>DOC. COMPRA</th>
                        <th>FECHA</th>
                        <th class="text-right">TOTAL NETO</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="c in obtenerComprasDeVenta(v.DOCUMENTO)" :key="c.DOCUMENTO">
                        <td class="bold text-slate">{{ c.DOCUMENTO }}</td>
                        <td>{{ fFecha(c.FECHA) }}</td>
                        <td class="text-right bold">${{ Number(c.TOTALNETO).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td colspan="6" class="text-right">TOTALES:</td>
            <td class="text-right">${{ totalVentas.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
            <td class="text-right primary-value">${{ totalCostoChina.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </section>

    <section class="section-card erp-section">
      <h3>📄 Albaranes Compra General</h3>
      <table class="styled-table erp-theme">
        <thead>
          <tr>
            <th>DOCUMENTO</th>
            <th>MARCA</th>
            <th>FECHA</th>
            <th class="text-right">TOTAL BRUTO</th>
            <th class="text-right">TOTAL NETO</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="alb in albaranes" :key="alb.DOCUMENTO + alb.MARCA">
            <td class="bold">{{ alb.DOCUMENTO }}</td>
            <td><span class="brand-tag">{{ alb.MARCA }}</span></td>
            <td>{{ fFecha(alb.FECHA) }}</td>
            <td class="text-right">${{ Number(alb.TOTALBRUTO).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
            <td class="text-right bold">${{ Number(alb.TOTALNETO).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td colspan="4" class="text-right">TOTAL ALBARANES:</td>
            <td class="text-right">${{ totalAlbaranes.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  </div>
</template>

<style scoped>
/* ── Loading overlay ──────────────────────── */
.loading-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(255,255,255,0.85);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 9999;
  backdrop-filter: blur(2px);
}
.spinner {
  width: 48px; height: 48px;
  border: 4px solid #e8e8e5;
  border-top: 4px solid var(--primary);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
  margin-bottom: 14px;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Layout principal ─────────────────────── */
.container-detail {
  padding: 28px 32px;
  max-width: 1400px;
  margin: auto;
  font-family: 'Inter', sans-serif;
}

.header-actions { margin-bottom: 22px; }

.btn-back {
  background: none;
  border: none;
  color: var(--primary-dark);
  cursor: pointer;
  font-weight: 700;
  font-size: 14px;
  padding: 0;
  font-family: inherit;
  transition: color 0.2s;
}
.btn-back:hover { color: var(--dark); }

.title-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 28px;
}
.main-titles h1 { margin: 0; font-size: 2rem; font-weight: 800; color: var(--dark); }
.subtitle { color: var(--gray); margin-top: 6px; font-size: 14px; }

.status-badge {
  padding: 8px 18px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.status-badge.procesado { background: #e8f5e9; color: #2e7d32; }
.status-badge.transito  { background: var(--primary-light); color: var(--primary-dark); }

/* ── KPI cards ────────────────────────────── */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 18px;
  margin-bottom: 32px;
}
.kpi-card {
  background: var(--white);
  padding: 22px 24px;
  border-radius: 12px;
  border: 1px solid var(--border);
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}
.kpi-card label {
  font-size: 10px;
  font-weight: 700;
  color: var(--gray-light);
  display: block;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}
.kpi-card .value { font-size: 21px; font-weight: 800; color: var(--dark); }
.value.primary { color: var(--primary-dark); }
.value.danger  { color: #c0392b; }

.marcas-kpi { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.marca-pill-kpi {
  background: var(--primary-light);
  color: var(--primary-dark);
  border: 1px solid rgba(134,187,37,0.35);
  border-radius: 5px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

/* ── Section cards ────────────────────────── */
.section-card {
  background: var(--white);
  padding: 28px;
  border-radius: 14px;
  margin-bottom: 28px;
  border: 1px solid var(--border);
  box-shadow: 0 2px 6px rgba(0,0,0,0.05);
}
.section-card h3 {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 800;
  color: var(--dark);
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 22px;
}

/* ── Formulario de gastos ─────────────────── */
.expense-form-container {
  background: #f6f6f3;
  padding: 18px 20px;
  border-radius: 10px;
  margin-bottom: 20px;
  border: 1px solid var(--border);
}
.expense-form { display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap; }
.form-group { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 130px; }
.form-group label {
  font-size: 10px;
  font-weight: 700;
  color: var(--gray);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.form-group input,
.form-group select {
  padding: 9px 10px;
  border: 1.5px solid var(--gray-lighter);
  border-radius: 7px;
  font-family: inherit;
  font-size: 13px;
  color: var(--dark);
  background: var(--white);
  outline: none;
  transition: border-color 0.2s;
}
.form-group input:focus,
.form-group select:focus { border-color: var(--primary); }
.factor-display {
  padding: 9px 10px;
  background: #ececea;
  border-radius: 7px;
  font-family: monospace;
  font-weight: 700;
  font-size: 13px;
  color: var(--gray);
}

/* ── Botones de acción ────────────────────── */
.btn-erp {
  background: var(--primary);
  color: white;
  border: none;
  padding: 11px 22px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s, transform 0.1s;
}
.btn-erp:hover { background: var(--primary-dark); transform: translateY(-1px); }

.btn-add {
  background: var(--dark);
  color: white;
  border: none;
  padding: 10px 18px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s;
}
.btn-add:hover { background: #333; }

.tasa-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  vertical-align: middle;
  margin-left: 4px;
  letter-spacing: 0.5px;
}
.tasa-badge.binance { background: #f6a623; color: #1a1a1a; }
.tasa-badge.bcv     { background: #3b82f6; color: #fff; }

.btn-icon {
  border: none;
  border-radius: 5px;
  padding: 5px 8px;
  cursor: pointer;
  font-size: 14px;
  transition: 0.2s;
  margin-left: 4px;
}
.btn-icon.edit  { background: #eef6d0; color: var(--primary-dark); }
.btn-icon.edit:hover  { background: var(--primary); color: white; }
.btn-icon.delete { background: #fde8e8; color: #c0392b; }
.btn-icon.delete:hover { background: #c0392b; color: white; }

.locked-text { color: var(--gray-light); font-size: 12px; }
.action-buttons { display: flex; justify-content: flex-end; }

/* ── Tablas ───────────────────────────────── */
.styled-table { width: 100%; border-collapse: collapse; }
.styled-table th {
  text-align: left;
  padding: 11px 13px;
  background: #f6f6f3;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--gray);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  border-bottom: 2px solid var(--border);
}
.styled-table td {
  padding: 13px 13px;
  border-bottom: 1px solid #f0f0ed;
  font-size: 13.5px;
  color: var(--gray);
}
.styled-table tbody tr:last-child td { border-bottom: none; }

.text-right  { text-align: right; }
.text-center { text-align: center; }
.bold        { font-weight: 700; color: var(--dark); }
.font-mono   { font-family: 'Courier New', monospace; }
.text-slate  { color: var(--gray); }

/* Filas expandibles */
.row-clickable { cursor: pointer; transition: background-color 0.15s; }
.row-clickable:hover { background-color: var(--primary-light); }
.arrow-icon {
  display: inline-block;
  transition: 0.25s;
  color: var(--gray-lighter);
  font-size: 17px;
  line-height: 1;
}
.arrow-icon.is-active { transform: rotate(90deg); color: var(--primary); }

.subtable-container { padding: 0; background: #fafaf8; }
.subtable-wrapper {
  padding: 14px 14px 14px 36px;
  border-left: 3px solid var(--primary);
  background: #fafaf8;
}
.sub-table { width: 100%; background: var(--white); border-radius: 8px; border-collapse: collapse; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow: hidden; }
.sub-table th {
  background: #f0f0ed;
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--gray);
  letter-spacing: 0.06em;
}
.sub-table td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #f0f0ed; color: var(--dark); }
.sub-table tbody tr:last-child td { border-bottom: none; }

/* Totales */
.total-row td {
  background: #f2f2ef;
  font-size: 14px;
  font-weight: 800;
  border-top: 2px solid var(--gray-lighter);
  padding: 14px 13px;
  color: var(--dark);
}

/* Pills de estado */
.status-pill { padding: 3px 11px; border-radius: 20px; font-size: 10px; font-weight: 800; letter-spacing: 0.04em; }
.is-received     { background: var(--primary-light); color: var(--primary-dark); }
.is-not-received { background: #fde8e8; color: #c0392b; }

/* Brand tag */
.brand-tag {
  background: var(--primary-light);
  color: var(--primary-dark);
  padding: 3px 9px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid rgba(134,187,37,0.3);
  text-transform: uppercase;
}

/* Costo china destacado */
.primary-value { color: var(--primary-dark) !important; font-weight: 700; }
</style>