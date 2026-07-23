<template>
  <div class="reportes-page">

    <!-- ── Encabezado ── -->
    <div class="page-header">
      <div>
        <h1>Reportes</h1>
        <p class="subtitle">Análisis de costos por contenedor y marca</p>
      </div>
      <button v-if="datos.length > 0" @click="exportarExcel" class="btn-export">
        ⬇ Exportar Excel
      </button>
    </div>

    <!-- ── Filtros ── -->
    <div class="filtros-card">
      <div class="filtros-grid">
        <div class="form-group wide">
          <label>Contenedor</label>
          <select v-model="filtros.contenedor">
            <option value="">-- Seleccione un contenedor --</option>
            <option v-for="c in contenedores" :key="c.CONTENEDORID" :value="c.NUMEROCONTENEDOR">
              {{ c.NUMEROCONTENEDOR }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label>Serie (patrón LIKE)</label>
          <input v-model="filtros.serie" placeholder="T%" />
        </div>
        <div class="form-group">
          <label>Nº Albarán <span class="hint">(0 = todos)</span></label>
          <input type="number" v-model.number="filtros.numero" min="0" />
        </div>
        <div class="btn-group">
          <button @click="generarReporte" class="btn-primary" :disabled="!filtros.contenedor || cargando">
            <span v-if="cargando">⏳ Cargando...</span>
            <span v-else>🔍 Generar Reporte</span>
          </button>
          <button v-if="datos.length > 0" @click="limpiar" class="btn-secondary">✕ Limpiar</button>
        </div>
      </div>

      <!-- Pills de marca para filtrar -->
      <div v-if="marcasDisponibles.length > 1" class="marca-filter">
        <span class="filter-label">Marca:</span>
        <span
          class="marca-pill"
          :class="{ active: marcaActiva === null }"
          @click="marcaActiva = null"
        >TODAS</span>
        <span
          v-for="m in marcasDisponibles"
          :key="m"
          class="marca-pill"
          :class="{ active: marcaActiva === m }"
          @click="marcaActiva = m"
        >{{ m }}</span>
      </div>
    </div>

    <!-- ── Error ── -->
    <div v-if="error" class="error-banner">⚠ {{ error }}</div>

    <!-- ── Resultados ── -->
    <template v-if="datosFiltrados.length > 0">

      <!-- KPIs -->
      <div class="kpi-row">
        <div class="kpi-mini">
          <label>ARTÍCULOS</label>
          <span>{{ datosFiltrados.length }}</span>
        </div>
        <div class="kpi-mini">
          <label>UNIDADES TOTALES</label>
          <span>{{ totales.unidades.toLocaleString() }}</span>
        </div>
        <div class="kpi-mini highlight">
          <label>COSTO TOTAL CHINA</label>
          <span>${{ fmt(totales.costoTotal) }}</span>
        </div>
        <div class="kpi-mini">
          <label>GASTOS LOGÍSTICOS</label>
          <span>${{ fmt(totales.gastos) }}</span>
        </div>
        <div class="kpi-mini">
          <label>MARCAS CON DATOS</label>
          <span>{{ marcasDisponibles.length }}</span>
        </div>
      </div>

      <!-- Tabla -->
      <div class="table-card">
        <div class="table-wrapper">
          <table class="report-table">
            <thead>
              <tr>
                <th @click="sortBy('MARCA')" class="sortable">MARCA <span class="sort-icon">{{ sortIcon('MARCA') }}</span></th>
                <th @click="sortBy('CODARTICULO')" class="sortable">CÓD. ART. <span class="sort-icon">{{ sortIcon('CODARTICULO') }}</span></th>
                <th>REFERENCIA</th>
                <th>DESCRIPCIÓN</th>
                <th @click="sortBy('UNIDADES')" class="sortable text-right">UNIDADES <span class="sort-icon">{{ sortIcon('UNIDADES') }}</span></th>
                <th @click="sortBy('PRECIO_CHINA')" class="sortable text-right">P. CHINA <span class="sort-icon">{{ sortIcon('PRECIO_CHINA') }}</span></th>
                <th @click="sortBy('PRECIO_TOTAL')" class="sortable text-right">TOTAL CHINA <span class="sort-icon">{{ sortIcon('PRECIO_TOTAL') }}</span></th>
                <th class="text-right">GASTO 1</th>
                <th class="text-right">GASTO 2</th>
                <th class="text-right">GASTO 3</th>
                <th @click="sortBy('GASTOS_TOTAL')" class="sortable text-right">GASTOS TOT. <span class="sort-icon">{{ sortIcon('GASTOS_TOTAL') }}</span></th>
                <th @click="sortBy('ULTIMO_COSTE')" class="sortable text-right">ÚLT. COSTE <span class="sort-icon">{{ sortIcon('ULTIMO_COSTE') }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in datosPagina" :key="`${row.MARCA}-${row.CODARTICULO}-${row.CONTENEDOR}`">
                <td><span class="marca-tag">{{ row.MARCA }}</span></td>
                <td class="bold mono">{{ row.CODARTICULO }}</td>
                <td class="mono text-gray">{{ row.REFERENCIA }}</td>
                <td>{{ row.NOMBRE_ARTICULO }}</td>
                <td class="text-right bold">{{ Number(row.UNIDADES).toLocaleString() }}</td>
                <td class="text-right mono">${{ fmt(row.PRECIO_CHINA) }}</td>
                <td class="text-right bold">${{ fmt(row.PRECIO_TOTAL) }}</td>
                <td class="text-right mono text-gray">${{ fmt(row.GASTO1) }}</td>
                <td class="text-right mono text-gray">${{ fmt(row.GASTO2) }}</td>
                <td class="text-right mono text-gray">${{ fmt(row.GASTO3) }}</td>
                <td class="text-right bold primary-val">${{ fmt(row.GASTOS_TOTAL) }}</td>
                <td class="text-right mono">${{ fmt(row.ULTIMO_COSTE) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="total-row">
                <td colspan="4" class="text-right">TOTALES</td>
                <td class="text-right">{{ totales.unidades.toLocaleString() }}</td>
                <td></td>
                <td class="text-right">${{ fmt(totales.costoTotal) }}</td>
                <td class="text-right">${{ fmt(totales.gasto1) }}</td>
                <td class="text-right">${{ fmt(totales.gasto2) }}</td>
                <td class="text-right">${{ fmt(totales.gasto3) }}</td>
                <td class="text-right primary-val">${{ fmt(totales.gastos) }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Paginación -->
      <div class="pagination">
        <div class="pag-info">
          Mostrando {{ (paginaActual - 1) * tamPagina + 1 }}–{{ Math.min(paginaActual * tamPagina, datosOrdenados.length) }}
          de {{ datosOrdenados.length }} registros
        </div>
        <div class="pag-controls">
          <select v-model.number="tamPagina" @change="paginaActual = 1" class="pag-select">
            <option :value="25">25 / página</option>
            <option :value="50">50 / página</option>
            <option :value="100">100 / página</option>
            <option :value="250">250 / página</option>
          </select>
          <button @click="paginaActual = 1"            :disabled="paginaActual === 1"            class="pag-btn">«</button>
          <button @click="paginaActual--"              :disabled="paginaActual === 1"            class="pag-btn">‹</button>
          <span class="pag-current">{{ paginaActual }} / {{ totalPaginas }}</span>
          <button @click="paginaActual++"              :disabled="paginaActual === totalPaginas" class="pag-btn">›</button>
          <button @click="paginaActual = totalPaginas" :disabled="paginaActual === totalPaginas" class="pag-btn">»</button>
        </div>
      </div>
    </template>

    <!-- ── Estado vacío ── -->
    <div v-else-if="hasBuscado && !cargando" class="empty-state">
      <span class="empty-icon">📭</span>
      <p>No se encontraron datos para los parámetros indicados.</p>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { apiService } from '../services/api';

// ── Estado ──────────────────────────────────────
const contenedores  = ref<any[]>([]);
const datos         = ref<any[]>([]);
const cargando      = ref(false);
const hasBuscado    = ref(false);
const error         = ref('');
const marcaActiva   = ref<string | null>(null);
const sortCol       = ref('MARCA');
const sortAsc       = ref(true);
const paginaActual  = ref(1);
const tamPagina     = ref(50);

const filtros = ref({
  contenedor: '',
  serie: 'T%',
  numero: 0
});

// ── Computed ────────────────────────────────────
const marcasDisponibles = computed(() =>
  [...new Set(datos.value.map((r: any) => r.MARCA))].sort()
);

const datosFiltrados = computed(() =>
  marcaActiva.value
    ? datos.value.filter((r: any) => r.MARCA === marcaActiva.value)
    : datos.value
);

const datosOrdenados = computed(() => {
  const col = sortCol.value;
  return [...datosFiltrados.value].sort((a, b) => {
    const va = a[col] ?? '';
    const vb = b[col] ?? '';
    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return sortAsc.value ? cmp : -cmp;
  });
});

const totalPaginas = computed(() => Math.max(1, Math.ceil(datosOrdenados.value.length / tamPagina.value)));
const datosPagina  = computed(() => {
  const start = (paginaActual.value - 1) * tamPagina.value;
  return datosOrdenados.value.slice(start, start + tamPagina.value);
});

const totales = computed(() => {
  const rows = datosFiltrados.value;
  return {
    unidades:   rows.reduce((s: number, r: any) => s + Number(r.UNIDADES   || 0), 0),
    costoTotal: rows.reduce((s: number, r: any) => s + Number(r.PRECIO_TOTAL || 0), 0),
    gastos:     rows.reduce((s: number, r: any) => s + Number(r.GASTOS_TOTAL || 0), 0),
    gasto1:     rows.reduce((s: number, r: any) => s + Number(r.GASTO1 || 0), 0),
    gasto2:     rows.reduce((s: number, r: any) => s + Number(r.GASTO2 || 0), 0),
    gasto3:     rows.reduce((s: number, r: any) => s + Number(r.GASTO3 || 0), 0),
  };
});

// ── Métodos ─────────────────────────────────────
const fmt = (v: any) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sortBy = (col: string) => {
  if (sortCol.value === col) sortAsc.value = !sortAsc.value;
  else { sortCol.value = col; sortAsc.value = true; }
};
const sortIcon = (col: string) => sortCol.value === col ? (sortAsc.value ? '↑' : '↓') : '↕';

const generarReporte = async () => {
  error.value = '';
  cargando.value = true;
  hasBuscado.value = true;
  datos.value = [];
  marcaActiva.value = null;
  try {
    const res = await apiService.getReporteCostosTienda(
      filtros.value.contenedor,
      filtros.value.serie,
      filtros.value.numero
    );
    datos.value = res.data.data || [];
    if (res.data.errores) {
      const msgs = Object.entries(res.data.errores).map(([m, e]) => `${m}: ${e}`).join(' | ');
      error.value = `Advertencias: ${msgs}`;
    }
  } catch (err: any) {
    error.value = err?.response?.data?.error || 'Error al generar el reporte';
  } finally {
    cargando.value = false;
  }
};

const limpiar = () => {
  datos.value = [];
  hasBuscado.value = false;
  error.value = '';
  marcaActiva.value = null;
};

const exportarExcel = async () => {
  const XLSX = await import('xlsx');
  const cols = ['MARCA','CODARTICULO','REFERENCIA','NOMBRE_ARTICULO','UNIDADES','PRECIO_CHINA','PRECIO_TOTAL','GASTO1','GASTO2','GASTO3','GASTOS_TOTAL','ULTIMO_COSTE','CONTENEDOR'];
  const headers = ['MARCA','CÓD. ARTÍCULO','REFERENCIA','DESCRIPCIÓN','UNIDADES','PRECIO CHINA','TOTAL CHINA','GASTO 1','GASTO 2','GASTO 3','GASTOS TOTAL','ÚLT. COSTE','CONTENEDOR'];
  const data = [headers, ...datosOrdenados.value.map(r => cols.map(c => r[c] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [10,12,14,30,10,12,13,10,10,10,12,12,16].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
  XLSX.writeFile(wb, `reporte_${filtros.value.contenedor}_${new Date().toISOString().slice(0,10)}.xlsx`);
};

onMounted(async () => {
  try {
    const res = await apiService.getTodos();
    contenedores.value = res.data;
  } catch { /* silencioso */ }
});
</script>

<style scoped>
.reportes-page { padding: 24px 28px; }

/* ── Header ── */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}
h1 { margin: 0; font-size: 22px; font-weight: 800; color: var(--dark); }
.subtitle { color: var(--gray); font-size: 14px; margin: 4px 0 0; }

.btn-export {
  background: var(--dark);
  color: #fff;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s;
}
.btn-export:hover { background: #333; }

/* ── Filtros ── */
.filtros-card {
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 22px 24px;
  margin-bottom: 22px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}
.filtros-grid {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  flex-wrap: wrap;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 140px;
}
.form-group.wide { min-width: 240px; flex: 1; }
.form-group label {
  font-size: 10px;
  font-weight: 700;
  color: var(--gray);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}
.hint { font-weight: 400; text-transform: none; color: var(--gray-light); }
.form-group input,
.form-group select {
  padding: 10px 12px;
  border: 1.5px solid var(--gray-lighter);
  border-radius: 7px;
  font-family: inherit;
  font-size: 13px;
  color: var(--dark);
  background: #fafaf8;
  outline: none;
  transition: border-color 0.2s;
}
.form-group input:focus,
.form-group select:focus { border-color: var(--primary); background: #fff; }

.btn-group { display: flex; gap: 10px; align-items: flex-end; }
.btn-primary {
  background: var(--primary);
  color: #fff;
  border: none;
  padding: 11px 22px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s;
  white-space: nowrap;
}
.btn-primary:hover:not(:disabled) { background: var(--primary-dark); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  background: #f0f0ed;
  color: var(--gray);
  border: none;
  padding: 11px 16px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.btn-secondary:hover { background: var(--gray-lighter); }

/* ── Filtro de marcas ── */
.marca-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.filter-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--gray);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.marca-pill {
  padding: 5px 14px;
  border-radius: 99px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  border: 1.5px solid var(--gray-lighter);
  color: var(--gray);
  background: #f6f6f3;
  transition: all 0.18s;
  user-select: none;
}
.marca-pill:hover { border-color: var(--primary); color: var(--primary-dark); }
.marca-pill.active {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

/* ── Error ── */
.error-banner {
  background: #fff8e1;
  border: 1px solid #ffe082;
  color: #7a5c00;
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 13px;
  margin-bottom: 18px;
}

/* ── KPIs ── */
.kpi-row {
  display: flex;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.kpi-mini {
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px 20px;
  flex: 1;
  min-width: 140px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.kpi-mini.highlight { border-color: var(--primary); background: var(--primary-light); }
.kpi-mini label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  color: var(--gray-light);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin-bottom: 6px;
}
.kpi-mini span { font-size: 20px; font-weight: 800; color: var(--dark); }
.kpi-mini.highlight span { color: var(--primary-dark); }

/* ── Tabla ── */
.table-card {
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  overflow: hidden;
}
.table-wrapper { overflow-x: auto; }
.report-table { width: 100%; border-collapse: collapse; min-width: 1100px; }

.report-table th {
  background: #f6f6f3;
  padding: 11px 13px;
  text-align: left;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--gray);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  border-bottom: 2px solid var(--border);
  white-space: nowrap;
}
.report-table th.sortable { cursor: pointer; user-select: none; }
.report-table th.sortable:hover { background: #eeeee9; color: var(--dark); }
.sort-icon { color: var(--gray-light); font-size: 10px; margin-left: 3px; }

.report-table td {
  padding: 12px 13px;
  border-bottom: 1px solid #f0f0ed;
  font-size: 13px;
  color: var(--gray);
  white-space: nowrap;
}
.report-table tbody tr:hover { background: var(--primary-light); }
.report-table tbody tr:last-child td { border-bottom: none; }

.text-right { text-align: right; }
.bold  { font-weight: 700; color: var(--dark); }
.mono  { font-family: 'Courier New', monospace; }
.text-gray { color: var(--gray-light); }
.primary-val { color: var(--primary-dark); font-weight: 700; }

.marca-tag {
  background: var(--primary-light);
  color: var(--primary-dark);
  border: 1px solid rgba(134,187,37,0.35);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.total-row td {
  background: #f2f2ef;
  font-size: 13px;
  font-weight: 800;
  border-top: 2px solid var(--gray-lighter);
  padding: 13px;
  color: var(--dark);
}

/* ── Paginación ── */
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  margin-top: 14px;
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 10px;
  flex-wrap: wrap;
  gap: 12px;
}
.pag-info {
  font-size: 13px;
  color: var(--gray);
  font-weight: 500;
}
.pag-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pag-select {
  padding: 7px 10px;
  border: 1.5px solid var(--gray-lighter);
  border-radius: 7px;
  font-family: inherit;
  font-size: 13px;
  color: var(--dark);
  background: #fafaf8;
  cursor: pointer;
  outline: none;
  margin-right: 8px;
}
.pag-select:focus { border-color: var(--primary); }
.pag-btn {
  background: var(--white);
  border: 1.5px solid var(--gray-lighter);
  color: var(--gray);
  padding: 7px 12px;
  border-radius: 7px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s;
  font-family: inherit;
  line-height: 1;
}
.pag-btn:hover:not(:disabled) {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.pag-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.pag-current {
  padding: 7px 14px;
  background: var(--primary-light);
  color: var(--primary-dark);
  border-radius: 7px;
  font-size: 13px;
  font-weight: 700;
  border: 1px solid rgba(134,187,37,0.3);
  white-space: nowrap;
}

/* ── Empty state ── */
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--gray-light);
}
.empty-icon { font-size: 48px; display: block; margin-bottom: 12px; }
.empty-state p { font-size: 15px; margin: 0; }
</style>
