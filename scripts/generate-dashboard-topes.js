/**
 * Script para generar el Dashboard HTML de Topes TC Davibank.
 * Versión CI: lee CSV desde data/ordenes.csv (relativo al repo).
 *
 * Insumos:
 *   - topes-config.json (distribución de topes por período)
 *   - data/ordenes.csv (transacciones con hora, producto, categoría)
 *
 * Salida:
 *   - index.html (dashboard principal autocontenido con panel de topes editable)
 */

'use strict';

const path = require('path');
const fs = require('fs');

// --- Configuración de rutas (relativas al repo) ---
const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'topes-config.json');
const CSV_PATH = path.join(ROOT_DIR, 'data', 'ordenes.csv');
const OUTPUT_HTML = path.join(ROOT_DIR, 'index.html');

// --- Validación de archivos requeridos ---
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`Error: No se encontró topes-config.json en ${CONFIG_PATH}`);
  process.exit(1);
}
if (!fs.existsSync(CSV_PATH)) {
  console.error(`Error: No se encontró data/ordenes.csv en ${CSV_PATH}`);
  process.exit(1);
}

// --- Leer configuración de topes ---
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

// --- Constantes ---
const CATEGORIAS_VALIDAS = ['BLACK', 'CLASICA', 'EMPRESARIAL', 'INFINITE', 'ORO', 'PLATINUM', 'SIGNATURE'];
const PRODUCTOS_CONOCIDOS = ['Metal', 'Terpel', 'Cencosud', 'Pricesmart'];
const FECHA_MINIMA = '2026-06-01';

// --- Función para parsear CSV con comillas ---
function parseCSV(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(current.trim());
        current = '';
      } else if (char === '\n' || (char === '\r' && next === '\n')) {
        row.push(current.trim());
        current = '';
        if (row.length > 0) rows.push(row);
        row = [];
        if (char === '\r') i++;
      } else {
        current += char;
      }
    }
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    if (row.length > 0) rows.push(row);
  }

  return rows;
}

/**
 * Normaliza una categoría TC.
 * @param {string} cat - Categoría cruda.
 * @returns {string} Categoría normalizada en uppercase.
 */
function normalizarCategoria(cat) {
  if (!cat) return '';
  return cat.toString().trim().toUpperCase()
    .replace(/^\d+\s*/, '')
    .replace('LIGTH', 'LIGHT');
}

/**
 * Determina el producto normalizado.
 * @param {string} producto - Producto crudo del CSV.
 * @returns {string} Producto normalizado.
 */
function normalizarProducto(producto) {
  if (!producto) return 'Otras marcas';
  const trimmed = producto.trim();
  const found = PRODUCTOS_CONOCIDOS.find(
    (p) => p.toLowerCase() === trimmed.toLowerCase()
  );
  return found || 'Otras marcas';
}

/**
 * Retorna la configuración del período para una fecha.
 * @param {string} fecha - Fecha YYYY-MM-DD.
 * @returns {object|null} Config del período.
 */
function getConfigForDate(fecha) {
  let distribucionAnterior = null;
  for (const p of config.periodos) {
    if (p.distribucion !== 'misma') {
      distribucionAnterior = p.distribucion;
    }
    if (fecha >= p.desde && fecha <= p.hasta) {
      return {
        topeMensual: p.topeMensual,
        diasMes: p.diasMes,
        distribucion: p.distribucion === 'misma' ? distribucionAnterior : p.distribucion
      };
    }
  }
  return null;
}

/**
 * Calcula tope diario para fecha/producto/categoría.
 * @param {string} fecha - Fecha YYYY-MM-DD.
 * @param {string} producto - Nombre del producto.
 * @param {string} categoria - Nombre de la categoría.
 * @returns {number} Tope diario.
 */
function calcularTopeDiario(fecha, producto, categoria) {
  const cfg = getConfigForDate(fecha);
  if (!cfg || !cfg.distribucion) return 0;
  const distProducto = cfg.distribucion[producto];
  if (!distProducto) return 0;
  const pctProducto = distProducto.pctProducto || 0;
  const pctCategoria = distProducto.categorias[categoria] || 0;
  return Math.floor(Math.floor(cfg.topeMensual * pctProducto) * pctCategoria / cfg.diasMes);
}

// --- Leer y procesar CSV ---
console.log('=== Generador Dashboard Topes TC Davibank ===');
console.log(`Config: ${CONFIG_PATH}`);
console.log(`CSV: ${CSV_PATH}`);

const csvText = fs.readFileSync(CSV_PATH, 'utf8');
const csvRows = parseCSV(csvText);
const csvHeader = csvRows[0];

const colFechaSolicitud = csvHeader.findIndex(h => h.toLowerCase().includes('fecha solicitud'));
const colCategoriaTC = csvHeader.findIndex(h => h.toLowerCase().includes('categor') && h.toLowerCase().includes('tc'));
const colProductoTC = csvHeader.findIndex(h => h.toLowerCase().includes('producto tc'));

console.log(`Columnas: Fecha Solicitud=${colFechaSolicitud}, Categoría TC=${colCategoriaTC}, Producto TC=${colProductoTC}`);

const transacciones = [];
let lastFechaStr = null;
let lastHora = 0;

for (let i = 1; i < csvRows.length; i++) {
  const row = csvRows[i];
  if (!row || row.length < 5) continue;

  const fechaSolicitudRaw = row[colFechaSolicitud];
  const categoriaTC = normalizarCategoria(row[colCategoriaTC]);
  const productoTC = normalizarProducto(row[colProductoTC]);

  if (!productoTC || !categoriaTC) continue;

  let fechaStr, hora;
  if (fechaSolicitudRaw && fechaSolicitudRaw.includes('/')) {
    const parts = fechaSolicitudRaw.split(' ');
    const dateParts = parts[0].split('/');
    fechaStr = `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}`;
    hora = parts[1] ? parseInt(parts[1].split(':')[0], 10) : 0;
    lastFechaStr = fechaStr;
    lastHora = hora;
  } else {
    fechaStr = lastFechaStr;
    hora = lastHora;
  }

  if (!fechaStr || fechaStr < FECHA_MINIMA) continue;
  if (!CATEGORIAS_VALIDAS.includes(categoriaTC)) continue;

  transacciones.push({ fecha: fechaStr, hora: isNaN(hora) ? 0 : hora, categoria: categoriaTC, producto: productoTC });
}

console.log(`Transacciones procesadas: ${transacciones.length}`);

// --- Agrupar y calcular métricas ---
const agrupado = {};
transacciones.forEach(t => {
  const key = `${t.producto}|${t.categoria}|${t.fecha}`;
  if (!agrupado[key]) {
    agrupado[key] = { producto: t.producto, categoria: t.categoria, fecha: t.fecha, registrosPorHora: {}, total: 0 };
  }
  if (!agrupado[key].registrosPorHora[t.hora]) agrupado[key].registrosPorHora[t.hora] = 0;
  agrupado[key].registrosPorHora[t.hora]++;
  agrupado[key].total++;
});

const resultados = Object.values(agrupado).map(grupo => {
  const topeDiario = calcularTopeDiario(grupo.fecha, grupo.producto, grupo.categoria);
  let acumulado = 0;
  let horaTope = null;
  const horasOrdenadas = Object.keys(grupo.registrosPorHora).map(Number).sort((a, b) => a - b);
  const acumuladoPorHora = {};

  for (const hora of horasOrdenadas) {
    acumulado += grupo.registrosPorHora[hora];
    acumuladoPorHora[hora] = acumulado;
    if (topeDiario && acumulado >= topeDiario && horaTope === null) {
      horaTope = hora;
    }
  }

  return {
    producto: grupo.producto,
    categoria: grupo.categoria,
    fecha: grupo.fecha,
    totalClientes: grupo.total,
    topeDiario: topeDiario || null,
    horaTope,
    acumuladoPorHora,
    porcentajeConsumo: topeDiario ? Math.round((grupo.total / topeDiario) * 100) : null
  };
});

const fechasUnicas = [...new Set(resultados.map(r => r.fecha))].sort();
const productosUnicos = [...new Set(resultados.map(r => r.producto))].sort();
const categoriasUnicas = [...new Set(resultados.map(r => r.categoria))].sort();

console.log(`Fechas: ${fechasUnicas.join(', ')}`);
console.log(`Productos: ${productosUnicos.join(', ')}`);
console.log(`Categorías: ${categoriasUnicas.join(', ')}`);

const dashboardData = {
  generado: new Date().toISOString(),
  fechas: fechasUnicas,
  productos: productosUnicos,
  categorias: categoriasUnicas,
  resultados,
  transaccionesTotal: transacciones.length
};

// --- Generar HTML autocontenido ---
const html = generateHTML(dashboardData);
fs.writeFileSync(OUTPUT_HTML, html, 'utf8');
console.log(`Dashboard generado: ${OUTPUT_HTML}`);
console.log('=== Generación completada ===');

/**
 * Genera el HTML completo del dashboard con panel de topes editable.
 * @param {object} data - Datos del dashboard.
 * @returns {string} HTML completo.
 */
function generateHTML(data) {
  const generadoDate = new Date(data.generado);
  const generadoStr = generadoDate.toLocaleString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const fechaOptions = data.fechas.map(f => `<option value="${f}">${f}</option>`).join('');
  const productoOptions = data.productos.map(p => `<option value="${p}">${p}</option>`).join('');
  const categoriaOptions = data.categorias.map(c => `<option value="${c}">${c}</option>`).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard Topes TC Davibank</title>
  <style>
    :root {
      --primary: #1B5E20;
      --primary-light: #2E7D32;
      --success: #2E7D32;
      --warning: #F9A825;
      --danger: #c62828;
      --bg: #F5F5F5;
      --card-bg: #ffffff;
      --text: #212121;
      --text-light: #616161;
      --border: #E0E0E0;
      --shadow: 0 2px 8px rgba(0,0,0,0.08);
      --accent: #1565C0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; padding: 24px; }
    .header { background: linear-gradient(135deg, var(--primary), var(--primary-light)); color: white; padding: 24px 32px; border-radius: 12px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 1.5rem; font-weight: 600; }
    .header .meta { font-size: 0.85rem; opacity: 0.85; }
    .filters { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; align-items: flex-end; }
    .filter-group { display: flex; flex-direction: column; gap: 4px; }
    .filter-group label { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-light); }
    select, input[type="number"] { padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; background: white; min-width: 140px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .kpi-card { background: var(--card-bg); padding: 20px; border-radius: 12px; box-shadow: var(--shadow); text-align: center; }
    .kpi-card .value { font-size: 1.8rem; font-weight: 700; color: var(--primary); }
    .kpi-card .label { font-size: 0.78rem; color: var(--text-light); margin-top: 4px; }
    .section-card { background: var(--card-bg); border-radius: 12px; box-shadow: var(--shadow); padding: 24px; margin-bottom: 24px; }
    .section-card h3 { margin-bottom: 16px; color: var(--primary); font-size: 1.1rem; }
    .table-container { background: var(--card-bg); border-radius: 12px; box-shadow: var(--shadow); overflow-x: auto; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    thead { background: var(--primary); color: white; }
    th { padding: 12px 14px; text-align: left; font-weight: 600; white-space: nowrap; }
    td { padding: 10px 14px; border-bottom: 1px solid var(--border); }
    tbody tr:hover { background: #f0f4ff; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; }
    .badge-danger { background: #ffebee; color: var(--danger); }
    .badge-warning { background: #fff3e0; color: var(--warning); }
    .badge-success { background: #e8f5e9; color: var(--success); }
    .progress-bar { width: 100%; height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; }
    .progress-bar .fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
    .resumen-topes-grid { display: grid; grid-template-columns: 180px 100px repeat(auto-fill, minmax(80px, 1fr)); gap: 1px; background: var(--border); border-radius: 8px; overflow: hidden; font-size: 0.8rem; }
    .resumen-topes-grid .cell { background: white; padding: 8px 10px; display: flex; align-items: center; justify-content: center; text-align: center; }
    .resumen-topes-grid .cell-header { background: #f0f2f5; font-weight: 600; color: var(--text); }
    .resumen-topes-grid .cell-label { justify-content: flex-start; font-weight: 500; }
    .hora-badge { display: inline-flex; align-items: center; justify-content: center; width: 100%; padding: 4px; border-radius: 6px; font-weight: 700; font-size: 0.82rem; }
    .chart-container { margin-bottom: 20px; padding: 16px; background: #fafbfc; border-radius: 10px; border: 1px solid var(--border); }
    .chart-title { font-weight: 600; font-size: 0.9rem; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .chart-bar-area { position: relative; height: 120px; display: flex; align-items: flex-end; gap: 3px; padding-left: 40px; border-bottom: 2px solid var(--border); border-left: 1px solid var(--border); }
    .chart-bar { flex: 1; border-radius: 3px 3px 0 0; position: relative; transition: height 0.3s; min-width: 12px; }
    .chart-bar:hover { opacity: 0.85; }
    .chart-bar-label { position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 0.65rem; font-weight: 600; color: var(--text); white-space: nowrap; }
    .chart-tope-line { position: absolute; left: 40px; right: 0; border-top: 2px dashed var(--danger); z-index: 2; }
    .chart-tope-label { position: absolute; left: 0; font-size: 0.65rem; color: var(--danger); font-weight: 700; transform: translateY(-50%); }
    .chart-x-axis { display: flex; gap: 3px; padding-left: 40px; margin-top: 4px; }
    .chart-x-axis span { flex: 1; text-align: center; font-size: 0.65rem; color: var(--text-light); }
    .chart-legend { display: flex; gap: 16px; margin-top: 8px; font-size: 0.75rem; color: var(--text-light); }
    .chart-legend-item { display: flex; align-items: center; gap: 4px; }
    .chart-legend-dot { width: 10px; height: 10px; border-radius: 2px; }
    .header-logo { height: 40px; margin-right: 16px; }

    /* --- Panel de Topes Editable --- */
    .topes-panel { background: var(--card-bg); border-radius: 12px; box-shadow: var(--shadow); margin-bottom: 24px; overflow: hidden; }
    .topes-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; background: #f8fdf8; border-bottom: 1px solid var(--border); cursor: pointer; }
    .topes-header h2 { font-size: 1rem; color: var(--primary); display: flex; align-items: center; gap: 8px; }
    .topes-header .toggle { font-size: 1.2rem; transition: transform 0.2s; }
    .topes-header .toggle.open { transform: rotate(180deg); }
    .topes-body { padding: 20px 24px; display: none; }
    .topes-body.open { display: block; }
    .periodos-tabs { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: 20px; overflow-x: auto; }
    .periodo-tab { padding: 10px 18px; font-size: 0.82rem; font-weight: 500; cursor: pointer; border-bottom: 3px solid transparent; white-space: nowrap; color: var(--text-light); transition: all 0.2s; }
    .periodo-tab:hover { color: var(--primary); background: #f0f7f0; }
    .periodo-tab.active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 700; }
    .periodo-tab .tab-badge { background: var(--primary); color: white; font-size: 0.65rem; padding: 2px 6px; border-radius: 10px; margin-left: 6px; }
    .periodo-form { background: #fafbfc; border: 1px solid var(--border); border-radius: 10px; padding: 20px; }
    .periodo-meta { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 16px; }
    .form-group { display: flex; flex-direction: column; gap: 4px; }
    .form-group label { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; color: var(--text-light); letter-spacing: 0.3px; }
    .form-group input { padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.9rem; width: 130px; }
    .form-group input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 2px rgba(27,94,32,0.1); }
    .form-group input[type="date"] { width: 150px; }
    .tope-global-preview { background: #E8F5E9; border-radius: 8px; padding: 10px 16px; font-size: 0.85rem; color: var(--primary); font-weight: 600; display: inline-flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    .tope-global-preview .formula { font-weight: 400; font-size: 0.78rem; color: var(--text-light); }
    .dist-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    .dist-table th { background: var(--primary); color: white; padding: 10px 12px; text-align: left; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; }
    .dist-table td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
    .dist-table tr:hover { background: #f0f7f0; }
    .dist-table input { width: 70px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 4px; font-size: 0.85rem; text-align: right; }
    .dist-table input:focus { outline: none; border-color: var(--primary); background: #f8fdf8; }
    .dist-table .producto-row { background: #f8fdf8; font-weight: 600; }
    .dist-table .tope-diario { font-weight: 700; color: var(--primary); text-align: center; }
    .dist-table .pct-warning { color: var(--warning); }
    .dist-table .pct-ok { color: var(--success); }
    .dist-table .pct-error { color: var(--danger); }
    .subtotal-row { background: #fff8e1 !important; font-weight: 600; font-size: 0.8rem; }
    .subtotal-row td { border-top: 2px solid var(--warning); }
    .btn { padding: 8px 16px; border: none; border-radius: 6px; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: all 0.15s; }
    .btn-sm { padding: 5px 10px; font-size: 0.75rem; }
    .btn-primary { background: var(--primary); color: white; }
    .btn-primary:hover { background: var(--primary-light); }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
    .btn-outline:hover { background: #f5f5f5; }
    .btn-danger { background: transparent; border: 1px solid #ffcdd2; color: var(--danger); }
    .btn-danger:hover { background: #ffebee; }
    .btn-accent { background: var(--accent); color: white; }
    .btn-accent:hover { background: #1976D2; }
    .actions-bar { display: flex; gap: 10px; margin-top: 16px; align-items: center; flex-wrap: wrap; }
    .actions-bar .spacer { flex: 1; }
    .save-indicator { font-size: 0.78rem; color: var(--success); display: none; }
    .save-indicator.visible { display: inline-flex; align-items: center; gap: 4px; }
    .misma-dist { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #E3F2FD; border-radius: 8px; margin-bottom: 16px; font-size: 0.85rem; color: var(--accent); }
    .misma-dist input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--accent); }
    .toast { position: fixed; bottom: 24px; right: 24px; background: var(--primary); color: white; padding: 14px 20px; border-radius: 10px; font-size: 0.88rem; box-shadow: 0 4px 20px rgba(0,0,0,0.15); display: none; z-index: 1000; animation: slideUp 0.3s; }
    .toast.visible { display: block; }
    @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

    @media (max-width: 768px) {
      body { padding: 12px; }
      .filters { flex-direction: column; }
      .kpi-grid { grid-template-columns: 1fr 1fr; }
      .chart-bar-area { height: 80px; }
      .periodo-meta { flex-direction: column; }
      .form-group input { width: 100%; }
      .dist-table input { width: 55px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div style="display:flex;align-items:center;">
      <img src="logo_sb_.png" alt="Servicios Bolívar" class="header-logo">
      <div>
        <h1>📊 Dashboard Topes TC — Davibank</h1>
        <div class="meta">Análisis de consumo de topes por Producto y Categoría TC</div>
      </div>
    </div>
    <div class="meta">Generado: ${generadoStr}</div>
  </div>

  <div class="filters">
    <div class="filter-group">
      <label>Fecha</label>
      <select id="filterFecha"><option value="all">Todas las fechas</option>${fechaOptions}</select>
    </div>
    <div class="filter-group">
      <label>Producto</label>
      <select id="filterProducto"><option value="all">Todos</option>${productoOptions}</select>
    </div>
    <div class="filter-group">
      <label>Categoría TC</label>
      <select id="filterCategoria"><option value="all">Todas</option>${categoriaOptions}</select>
    </div>
    <div class="filter-group">
      <label>Estado de Tope</label>
      <select id="filterEstado">
        <option value="all">Todos</option>
        <option value="cumplido">Tope cumplido</option>
        <option value="disponible">Con disponibilidad</option>
      </select>
    </div>
  </div>

  <div class="kpi-grid" id="kpiGrid"></div>

  <!-- Panel de Topes Editable -->
  <div class="topes-panel">
    <div class="topes-header" onclick="toggleTopesPanel()">
      <h2><span>⚙️</span> Configuración de Topes y Distribución</h2>
      <div style="display:flex;align-items:center;gap:12px;">
        <span class="save-indicator" id="saveIndicator">✅ Guardado</span>
        <span class="toggle" id="toggleIcon">▼</span>
      </div>
    </div>
    <div class="topes-body" id="topesBody">
      <div class="periodos-tabs" id="periodosTabs"></div>
      <div id="periodoForm"></div>
      <div class="actions-bar">
        <button class="btn btn-accent" onclick="addPeriodo()">+ Agregar período</button>
        <button class="btn btn-outline" onclick="duplicatePeriodo()">📋 Duplicar actual</button>
        <span class="spacer"></span>
        <button class="btn btn-danger" onclick="resetDefaults()">↺ Resetear a defaults</button>
        <button class="btn btn-primary" onclick="saveTopesConfig()">💾 Guardar cambios</button>
      </div>
    </div>
  </div>

  <!-- Resumen visual: hora de tope -->
  <div class="section-card">
    <h3>🕐 Resumen — Hora de agotamiento por Producto / Categoría / Día</h3>
    <p style="font-size:0.8rem;color:var(--text-light);margin-bottom:12px;">Muestra a qué hora se cumplió el tope diario. Rojo = agotado temprano. Verde = disponible todo el día.</p>
    <div id="resumenTopesContainer"></div>
  </div>

  <div class="table-container">
    <table>
      <thead><tr><th>Producto</th><th>Categoría TC</th><th>Fecha</th><th>Clientes</th><th>Tope Diario</th><th>% Consumo</th><th>Hora Tope</th><th>Estado</th></tr></thead>
      <tbody id="tableBody"></tbody>
    </table>
  </div>

  <!-- Gráfico acumulado -->
  <div class="section-card">
    <h3>📈 Consumo acumulado por hora</h3>
    <p style="font-size:0.8rem;color:var(--text-light);margin-bottom:16px;">Barras azules = clientes acumulados por hora. Línea roja punteada = tope diario.</p>
    <div id="chartContainer"></div>
  </div>

  <!-- Toast notification -->
  <div class="toast" id="toast"></div>

  <script>
    'use strict';

    // --- Datos embebidos en build time ---
    var DASHBOARD_DATA = ${JSON.stringify(data)};
    var TOPES_CONFIG_DEFAULT = ${JSON.stringify(config)};

    // --- State ---
    var STORAGE_KEY = 'topes-config-davibank';
    var topesConfig = loadTopesConfig();
    var activePeriodoIdx = 0;

    function loadTopesConfig() {
      try {
        var saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);
      } catch(e) {}
      return JSON.parse(JSON.stringify(TOPES_CONFIG_DEFAULT));
    }

    function saveTopesConfig() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(topesConfig));
      showToast('✅ Configuración guardada en localStorage');
      document.getElementById('saveIndicator').classList.add('visible');
      setTimeout(function() { document.getElementById('saveIndicator').classList.remove('visible'); }, 3000);
      recalculateAndRender();
    }

    function resetDefaults() {
      if (!confirm('¿Resetear a la configuración por defecto? Se perderán los cambios locales.')) return;
      localStorage.removeItem(STORAGE_KEY);
      topesConfig = JSON.parse(JSON.stringify(TOPES_CONFIG_DEFAULT));
      activePeriodoIdx = 0;
      renderTopesPanel();
      recalculateAndRender();
      showToast('↺ Configuración reseteada a defaults');
    }

    // --- Topes panel rendering ---
    function toggleTopesPanel() {
      var body = document.getElementById('topesBody');
      var icon = document.getElementById('toggleIcon');
      body.classList.toggle('open');
      icon.classList.toggle('open');
    }

    function renderTopesPanel() {
      renderTabs();
      renderPeriodoForm();
    }

    function renderTabs() {
      var html = '';
      topesConfig.periodos.forEach(function(p, i) {
        var label = p.desde + ' → ' + p.hasta;
        var badge = p.distribucion === 'misma' ? '<span class="tab-badge">hereda</span>' : '';
        html += '<div class="periodo-tab ' + (i === activePeriodoIdx ? 'active' : '') + '" onclick="selectPeriodo(' + i + ')">' + label + badge + '</div>';
      });
      document.getElementById('periodosTabs').innerHTML = html;
    }

    function renderPeriodoForm() {
      var p = topesConfig.periodos[activePeriodoIdx];
      var isMisma = p.distribucion === 'misma';
      var topeGlobal = Math.floor(p.topeMensual / p.diasMes);

      var html = '<div class="periodo-form">';
      html += '<div class="periodo-meta">';
      html += formGroup('Desde', 'date', p.desde, 'onchange="updateMeta(&#39;desde&#39;, this.value)"');
      html += formGroup('Hasta', 'date', p.hasta, 'onchange="updateMeta(&#39;hasta&#39;, this.value)"');
      html += formGroup('Tope mensual', 'number', p.topeMensual, 'onchange="updateMeta(&#39;topeMensual&#39;, parseInt(this.value))" min="0" step="100"');
      html += formGroup('Días del mes', 'number', p.diasMes, 'onchange="updateMeta(&#39;diasMes&#39;, parseInt(this.value))" min="1" max="31"');
      html += '</div>';
      html += '<div class="tope-global-preview">Tope diario global: ' + topeGlobal + '/día <span class="formula">= FLOOR(' + p.topeMensual + ' / ' + p.diasMes + ')</span></div>';
      html += '<div class="misma-dist"><input type="checkbox" id="mismaCheck" ' + (isMisma ? 'checked' : '') + ' onchange="toggleMisma(this.checked)"><label for="mismaCheck">Usar misma distribución del período anterior</label></div>';

      if (!isMisma) {
        html += renderDistTable(p);
      }

      if (topesConfig.periodos.length > 1) {
        html += '<div style="margin-top:12px;text-align:right;"><button class="btn btn-danger btn-sm" onclick="deletePeriodo()">🗑️ Eliminar período</button></div>';
      }
      html += '</div>';
      document.getElementById('periodoForm').innerHTML = html;
    }

    function renderDistTable(p) {
      var dist = p.distribucion;
      var html = '<table class="dist-table"><thead><tr><th>Producto</th><th>% Producto</th><th>Categoría</th><th>% Categoría</th><th>Tope/día</th></tr></thead><tbody>';
      var totalPctProducto = 0;
      var productos = Object.keys(dist);

      productos.forEach(function(prod) {
        var info = dist[prod];
        totalPctProducto += info.pctProducto;
        var cats = Object.keys(info.categorias);
        var totalPctCat = 0;

        cats.forEach(function(cat, catIdx) {
          var pctCat = info.categorias[cat];
          totalPctCat += pctCat;
          var cantMesProd = Math.floor(p.topeMensual * info.pctProducto);
          var topeDia = Math.floor(Math.floor(cantMesProd * pctCat) / p.diasMes);

          html += '<tr' + (catIdx === 0 ? ' class="producto-row"' : '') + '>';
          if (catIdx === 0) {
            html += '<td rowspan="' + cats.length + '"><strong>' + prod + '</strong></td>';
            html += '<td rowspan="' + cats.length + '"><input type="number" value="' + (info.pctProducto * 100).toFixed(1) + '" step="0.1" min="0" max="100" onchange="updatePctProducto(&quot;' + prod + '&quot;, this.value)"> %</td>';
          }
          html += '<td>' + cat + '</td>';
          html += '<td><input type="number" value="' + (pctCat * 100).toFixed(0) + '" step="1" min="0" max="100" onchange="updatePctCategoria(&quot;' + prod + '&quot;, &quot;' + cat + '&quot;, this.value)"> %</td>';
          html += '<td class="tope-diario">' + topeDia + '</td>';
          html += '</tr>';
        });

        var pctClass = Math.abs(totalPctCat - 1) < 0.02 ? 'pct-ok' : (totalPctCat > 1 ? 'pct-error' : 'pct-warning');
        html += '<tr class="subtotal-row"><td></td><td></td><td style="text-align:right;font-size:0.75rem;">Σ Categorías:</td><td class="' + pctClass + '">' + (totalPctCat * 100).toFixed(0) + '%</td><td></td></tr>';
      });

      var prodClass = Math.abs(totalPctProducto - 1) < 0.02 ? 'pct-ok' : (totalPctProducto > 1 ? 'pct-error' : 'pct-warning');
      html += '<tr style="background:#e8f5e9;font-weight:700;"><td>TOTAL</td><td class="' + prodClass + '">' + (totalPctProducto * 100).toFixed(1) + '%</td><td></td><td></td><td class="tope-diario">' + Math.floor(p.topeMensual / p.diasMes) + '</td></tr>';
      html += '</tbody></table>';
      return html;
    }

    // --- Topes panel actions ---
    function selectPeriodo(idx) { activePeriodoIdx = idx; renderTopesPanel(); }

    function updateMeta(field, value) {
      topesConfig.periodos[activePeriodoIdx][field] = value;
      renderPeriodoForm();
      recalculateAndRender();
    }

    function updatePctProducto(prod, value) {
      topesConfig.periodos[activePeriodoIdx].distribucion[prod].pctProducto = parseFloat(value) / 100;
      renderPeriodoForm();
      recalculateAndRender();
    }

    function updatePctCategoria(prod, cat, value) {
      topesConfig.periodos[activePeriodoIdx].distribucion[prod].categorias[cat] = parseFloat(value) / 100;
      renderPeriodoForm();
      recalculateAndRender();
    }

    function toggleMisma(checked) {
      if (checked) {
        topesConfig.periodos[activePeriodoIdx].distribucion = 'misma';
      } else {
        var prevDist = getResolvedDist(activePeriodoIdx - 1);
        topesConfig.periodos[activePeriodoIdx].distribucion = JSON.parse(JSON.stringify(prevDist));
      }
      renderPeriodoForm();
      recalculateAndRender();
    }

    function getResolvedDist(idx) {
      for (var i = idx; i >= 0; i--) {
        if (topesConfig.periodos[i].distribucion !== 'misma') return topesConfig.periodos[i].distribucion;
      }
      return TOPES_CONFIG_DEFAULT.periodos[0].distribucion;
    }

    function addPeriodo() {
      var last = topesConfig.periodos[topesConfig.periodos.length - 1];
      var newDesde = new Date(last.hasta + 'T12:00:00');
      newDesde.setDate(newDesde.getDate() + 1);
      var newHasta = new Date(newDesde);
      newHasta.setDate(newHasta.getDate() + 29);
      topesConfig.periodos.push({
        desde: newDesde.toISOString().slice(0, 10),
        hasta: newHasta.toISOString().slice(0, 10),
        topeMensual: last.topeMensual,
        diasMes: last.diasMes,
        distribucion: 'misma'
      });
      activePeriodoIdx = topesConfig.periodos.length - 1;
      renderTopesPanel();
      showToast('➕ Período agregado');
    }

    function duplicatePeriodo() {
      var current = JSON.parse(JSON.stringify(topesConfig.periodos[activePeriodoIdx]));
      var newDesde = new Date(current.hasta + 'T12:00:00');
      newDesde.setDate(newDesde.getDate() + 1);
      var newHasta = new Date(newDesde);
      newHasta.setDate(newHasta.getDate() + 29);
      current.desde = newDesde.toISOString().slice(0, 10);
      current.hasta = newHasta.toISOString().slice(0, 10);
      topesConfig.periodos.push(current);
      activePeriodoIdx = topesConfig.periodos.length - 1;
      renderTopesPanel();
      showToast('📋 Período duplicado');
    }

    function deletePeriodo() {
      if (topesConfig.periodos.length <= 1) return;
      if (!confirm('¿Eliminar este período?')) return;
      topesConfig.periodos.splice(activePeriodoIdx, 1);
      activePeriodoIdx = Math.min(activePeriodoIdx, topesConfig.periodos.length - 1);
      renderTopesPanel();
      recalculateAndRender();
      showToast('🗑️ Período eliminado');
    }

    // --- Recalculate dashboard from topes config ---
    function getConfigForDateClient(fecha) {
      var distribucionAnterior = null;
      for (var i = 0; i < topesConfig.periodos.length; i++) {
        var p = topesConfig.periodos[i];
        if (p.distribucion !== 'misma') distribucionAnterior = p.distribucion;
        if (fecha >= p.desde && fecha <= p.hasta) {
          var dist = p.distribucion === 'misma' ? distribucionAnterior : p.distribucion;
          return { topeMensual: p.topeMensual, diasMes: p.diasMes, distribucion: dist };
        }
      }
      return null;
    }

    function calcularTopeDiarioClient(fecha, producto, categoria) {
      var cfg = getConfigForDateClient(fecha);
      if (!cfg || !cfg.distribucion) return 0;
      var distProducto = cfg.distribucion[producto];
      if (!distProducto) return 0;
      var pctProducto = distProducto.pctProducto || 0;
      var pctCategoria = distProducto.categorias[categoria] || 0;
      return Math.floor(Math.floor(cfg.topeMensual * pctProducto) * pctCategoria / cfg.diasMes);
    }

    function recalculateResults() {
      return DASHBOARD_DATA.resultados.map(function(r) {
        var topeDiario = calcularTopeDiarioClient(r.fecha, r.producto, r.categoria) || null;
        var horaTope = null;
        if (topeDiario) {
          var horas = Object.keys(r.acumuladoPorHora).map(Number).sort(function(a,b){return a-b;});
          for (var i = 0; i < horas.length; i++) {
            if (r.acumuladoPorHora[horas[i]] >= topeDiario) { horaTope = horas[i]; break; }
          }
        }
        var porcentajeConsumo = topeDiario ? Math.round((r.totalClientes / topeDiario) * 100) : null;
        return { producto: r.producto, categoria: r.categoria, fecha: r.fecha, totalClientes: r.totalClientes, topeDiario: topeDiario, horaTope: horaTope, acumuladoPorHora: r.acumuladoPorHora, porcentajeConsumo: porcentajeConsumo };
      });
    }

    function recalculateAndRender() {
      renderDashboard();
    }

    // --- Dashboard rendering (KPIs, table, charts) ---
    function renderDashboard() {
      var resultados = recalculateResults();
      var filterFecha = document.getElementById('filterFecha').value;
      var filterProducto = document.getElementById('filterProducto').value;
      var filterCategoria = document.getElementById('filterCategoria').value;
      var filterEstado = document.getElementById('filterEstado').value;

      var filtered = resultados.filter(function(r) {
        if (filterFecha !== 'all' && r.fecha !== filterFecha) return false;
        if (filterProducto !== 'all' && r.producto !== filterProducto) return false;
        if (filterCategoria !== 'all' && r.categoria !== filterCategoria) return false;
        if (filterEstado === 'cumplido' && r.horaTope === null) return false;
        if (filterEstado === 'disponible' && r.horaTope !== null) return false;
        return true;
      });

      // KPIs
      var totalClientes = filtered.reduce(function(s,r){return s+r.totalClientes;},0);
      var conTope = filtered.filter(function(r){return r.horaTope !== null;});
      var sinTope = filtered.filter(function(r){return r.horaTope === null && r.topeDiario;});
      var avgConsumo = filtered.filter(function(r){return r.porcentajeConsumo !== null;});
      var avgPct = avgConsumo.length ? Math.round(avgConsumo.reduce(function(s,r){return s+r.porcentajeConsumo;},0)/avgConsumo.length) : 0;

      var kpiHtml = '';
      kpiHtml += '<div class="kpi-card"><div class="value">' + totalClientes.toLocaleString() + '</div><div class="label">Clientes totales</div></div>';
      kpiHtml += '<div class="kpi-card"><div class="value">' + filtered.length + '</div><div class="label">Combinaciones</div></div>';
      kpiHtml += '<div class="kpi-card"><div class="value" style="color:var(--danger);">' + conTope.length + '</div><div class="label">Topes alcanzados</div></div>';
      kpiHtml += '<div class="kpi-card"><div class="value" style="color:var(--success);">' + sinTope.length + '</div><div class="label">Con disponibilidad</div></div>';
      kpiHtml += '<div class="kpi-card"><div class="value">' + avgPct + '%</div><div class="label">Consumo promedio</div></div>';
      document.getElementById('kpiGrid').innerHTML = kpiHtml;

      // Table
      var tbHtml = '';
      filtered.sort(function(a,b){ return (b.porcentajeConsumo||0) - (a.porcentajeConsumo||0); });
      filtered.forEach(function(r) {
        var pct = r.porcentajeConsumo !== null ? r.porcentajeConsumo : '-';
        var badgeClass = r.horaTope !== null ? 'badge-danger' : (r.porcentajeConsumo && r.porcentajeConsumo >= 80 ? 'badge-warning' : 'badge-success');
        var estado = r.horaTope !== null ? 'Agotado' : (r.porcentajeConsumo && r.porcentajeConsumo >= 80 ? 'Casi agotado' : 'Disponible');
        var horaStr = r.horaTope !== null ? r.horaTope + ':00' : '-';
        tbHtml += '<tr><td>' + r.producto + '</td><td>' + r.categoria + '</td><td>' + r.fecha + '</td><td>' + r.totalClientes + '</td><td>' + (r.topeDiario || '-') + '</td><td>' + pct + '%</td><td>' + horaStr + '</td><td><span class="badge ' + badgeClass + '">' + estado + '</span></td></tr>';
      });
      document.getElementById('tableBody').innerHTML = tbHtml;

      // Resumen de hora tope
      renderResumenTopes(filtered);

      // Charts
      renderCharts(filtered);
    }

    function renderResumenTopes(filtered) {
      var fechas = DASHBOARD_DATA.fechas;
      var grouped = {};
      filtered.forEach(function(r) {
        var key = r.producto + '|' + r.categoria;
        if (!grouped[key]) grouped[key] = {};
        grouped[key][r.fecha] = r.horaTope;
      });

      var cols = fechas.length;
      var style = 'grid-template-columns: 180px 100px repeat(' + cols + ', 1fr)';
      var html = '<div class="resumen-topes-grid" style="' + style + '">';
      html += '<div class="cell cell-header cell-label">Producto / Categoría</div>';
      html += '<div class="cell cell-header">Tope/día</div>';
      fechas.forEach(function(f) { html += '<div class="cell cell-header">' + f.slice(5) + '</div>'; });

      var keys = Object.keys(grouped).sort();
      keys.forEach(function(key) {
        var parts = key.split('|');
        var topeForKey = null;
        for (var i = 0; i < filtered.length; i++) {
          if (filtered[i].producto === parts[0] && filtered[i].categoria === parts[1] && filtered[i].topeDiario) {
            topeForKey = filtered[i].topeDiario; break;
          }
        }
        html += '<div class="cell cell-label">' + parts[0] + ' / ' + parts[1] + '</div>';
        html += '<div class="cell">' + (topeForKey || '-') + '</div>';
        fechas.forEach(function(f) {
          var hora = grouped[key][f];
          if (hora !== undefined && hora !== null) {
            var color = hora < 9 ? '#ffcdd2' : (hora < 14 ? '#fff9c4' : '#c8e6c9');
            html += '<div class="cell"><span class="hora-badge" style="background:' + color + ';">' + hora + ':00</span></div>';
          } else {
            html += '<div class="cell">—</div>';
          }
        });
      });
      html += '</div>';
      document.getElementById('resumenTopesContainer').innerHTML = html;
    }

    function renderCharts(filtered) {
      var top5 = filtered.filter(function(r){return r.topeDiario;}).slice(0, 5);
      var html = '';
      top5.forEach(function(r) {
        var horas = Object.keys(r.acumuladoPorHora).map(Number).sort(function(a,b){return a-b;});
        var maxVal = Math.max(r.topeDiario || 0, r.totalClientes);
        html += '<div class="chart-container">';
        html += '<div class="chart-title">📊 ' + r.producto + ' / ' + r.categoria + ' — ' + r.fecha + '</div>';
        html += '<div class="chart-bar-area">';
        if (r.topeDiario) {
          var topePct = Math.min((r.topeDiario / maxVal) * 100, 100);
          html += '<div class="chart-tope-line" style="bottom:' + topePct + '%;"></div>';
          html += '<div class="chart-tope-label" style="bottom:' + topePct + '%;">T=' + r.topeDiario + '</div>';
        }
        for (var h = 0; h <= 23; h++) {
          var val = r.acumuladoPorHora[h] || 0;
          if (val === 0) { html += '<div class="chart-bar" style="height:0;"></div>'; continue; }
          var pct = (val / maxVal) * 100;
          var barColor = (r.horaTope !== null && h >= r.horaTope) ? 'var(--danger)' : '#42A5F5';
          html += '<div class="chart-bar" style="height:' + pct + '%;background:' + barColor + ';"><span class="chart-bar-label">' + val + '</span></div>';
        }
        html += '</div>';
        html += '<div class="chart-x-axis">';
        for (var h2 = 0; h2 <= 23; h2++) html += '<span>' + h2 + '</span>';
        html += '</div>';
        html += '<div class="chart-legend"><div class="chart-legend-item"><div class="chart-legend-dot" style="background:#42A5F5;"></div>Acumulado</div><div class="chart-legend-item"><div class="chart-legend-dot" style="background:var(--danger);"></div>Post-tope</div></div>';
        html += '</div>';
      });
      document.getElementById('chartContainer').innerHTML = html || '<p style="color:var(--text-light);font-size:0.85rem;">Selecciona filtros para ver gráficos de las combinaciones con tope definido.</p>';
    }

    // --- Helpers ---
    function formGroup(label, type, value, attrs) {
      return '<div class="form-group"><label>' + label + '</label><input type="' + type + '" value="' + value + '" ' + (attrs || '') + '></div>';
    }

    function showToast(msg) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('visible');
      setTimeout(function() { t.classList.remove('visible'); }, 2500);
    }

    // --- Filter event listeners ---
    document.getElementById('filterFecha').addEventListener('change', renderDashboard);
    document.getElementById('filterProducto').addEventListener('change', renderDashboard);
    document.getElementById('filterCategoria').addEventListener('change', renderDashboard);
    document.getElementById('filterEstado').addEventListener('change', renderDashboard);

    // --- Init ---
    renderTopesPanel();
    renderDashboard();
  </script>
</body>
</html>`;
}
