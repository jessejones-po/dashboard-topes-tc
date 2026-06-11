/**
 * generate-ejecutivo.js
 * Genera la vista ejecutiva HTML del Dashboard de Topes TC Davibank.
 * Incluye panel editable de topes con recálculo client-side.
 * Versión CI: lee desde data/ordenes.csv y topes-config.json (relativos al repo).
 */

'use strict';

const fs = require('fs');
const path = require('path');

// --- Rutas relativas al repo ---
const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'topes-config.json');
const CSV_PATH = path.join(ROOT_DIR, 'data', 'ordenes.csv');
const OUTPUT_PATH = path.join(ROOT_DIR, 'ejecutivo', 'index.html');
const FECHA_MINIMA = '2026-06-01';

const CATEGORIAS_VALIDAS = ['BLACK', 'CLASICA', 'EMPRESARIAL', 'INFINITE', 'ORO', 'PLATINUM', 'SIGNATURE'];
const PRODUCTOS_CONOCIDOS = ['Metal', 'Terpel', 'Cencosud', 'Pricesmart'];

// --- Validación ---
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('Error: No se encontró topes-config.json');
  process.exit(1);
}
if (!fs.existsSync(CSV_PATH)) {
  console.error('Error: No se encontró data/ordenes.csv');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

// --- Funciones auxiliares ---

function parseCSV(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') { current += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { current += char; }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ',') { row.push(current.trim()); current = ''; }
      else if (char === '\n' || (char === '\r' && next === '\n')) {
        row.push(current.trim()); current = '';
        if (row.length > 0) rows.push(row); row = [];
        if (char === '\r') i++;
      } else { current += char; }
    }
  }
  if (current.length > 0 || row.length > 0) { row.push(current.trim()); if (row.length > 0) rows.push(row); }
  return rows;
}

function normalizarCategoria(cat) {
  if (!cat) return '';
  return cat.trim().toUpperCase().replace(/^\d+\s*/, '').replace('LIGTH', 'LIGHT');
}

function normalizarProducto(producto) {
  if (!producto) return 'Otras marcas';
  const found = PRODUCTOS_CONOCIDOS.find(p => p.toLowerCase() === producto.trim().toLowerCase());
  return found || 'Otras marcas';
}

function getConfigForDate(fecha) {
  let distribucionAnterior = null;
  for (const p of config.periodos) {
    if (p.distribucion !== 'misma') distribucionAnterior = p.distribucion;
    if (fecha >= p.desde && fecha <= p.hasta) {
      return { topeMensual: p.topeMensual, diasMes: p.diasMes, desde: p.desde, hasta: p.hasta, distribucion: p.distribucion === 'misma' ? distribucionAnterior : p.distribucion };
    }
  }
  return null;
}

function calcularTopeDiario(fecha, producto, categoria) {
  const cfg = getConfigForDate(fecha);
  if (!cfg || !cfg.distribucion) return 0;
  const distProducto = cfg.distribucion[producto];
  if (!distProducto) return 0;
  return Math.floor(Math.floor(cfg.topeMensual * distProducto.pctProducto) * (distProducto.categorias[categoria] || 0) / cfg.diasMes);
}

function calcularTopeDiarioGlobal(fecha) {
  const cfg = getConfigForDate(fecha);
  if (!cfg) return 0;
  return Math.floor(cfg.topeMensual / cfg.diasMes);
}

function getAllProductoCategorias() {
  const combos = [];
  const seen = new Set();
  for (const periodo of config.periodos) {
    if (periodo.distribucion === 'misma') continue;
    for (const [producto, data] of Object.entries(periodo.distribucion)) {
      for (const categoria of Object.keys(data.categorias)) {
        const key = `${producto}|${categoria}`;
        if (!seen.has(key)) { seen.add(key); combos.push({ producto, categoria }); }
      }
    }
  }
  return combos;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Lectura CSV ---
function leerTransacciones() {
  const text = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCSV(text);
  if (rows.length === 0) return [];

  const headers = rows[0];
  const idxFecha = headers.findIndex(h => h.includes('Fecha Solicitud'));
  const idxCategoria = headers.findIndex(h => h.includes('Categor') && h.includes('TC'));
  const idxProducto = headers.findIndex(h => h.includes('Producto TC'));

  if (idxFecha === -1 || idxCategoria === -1 || idxProducto === -1) {
    console.warn('Columnas no encontradas en el CSV.');
    return [];
  }

  const registros = [];
  let fechaAnterior = '', horaAnterior = '00';

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const rawFecha = row[idxFecha] || '';
    let fecha = '', hora = '00';

    const match = rawFecha.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})/);
    if (match) {
      const [, dd, mm, yyyy, hh] = match;
      fecha = `${yyyy}-${mm}-${dd}`;
      hora = hh;
    }

    if (!fecha) { fecha = fechaAnterior; hora = horaAnterior; }
    else { fechaAnterior = fecha; horaAnterior = hora; }

    if (!fecha || fecha < FECHA_MINIMA) continue;

    const categoria = normalizarCategoria(row[idxCategoria]);
    if (!CATEGORIAS_VALIDAS.includes(categoria)) continue;

    registros.push({ fecha, hora, categoria, producto: normalizarProducto(row[idxProducto]) });
  }
  return registros;
}

/**
 * Construye mapa de conteos {producto|categoría|fecha: count} para recálculo client-side.
 * @param {Array} transacciones
 * @returns {Object}
 */
function buildTransactionCounts(transacciones) {
  const counts = {};
  for (const t of transacciones) {
    const key = `${t.producto}|${t.categoria}|${t.fecha}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// --- Generación HTML ---
function generateEjecutivoHTML(tablaData, fechas, transactionCounts) {
  const totalServicios = tablaData.reduce((sum, row) => sum + fechas.reduce((s, f) => s + (row.porFecha[f] ? row.porFecha[f].agendados : 0), 0), 0);

  const topesGlobalesPorFecha = {};
  for (const f of fechas) { topesGlobalesPorFecha[f] = calcularTopeDiarioGlobal(f); }

  let tableRows = '';
  for (const row of tablaData) {
    tableRows += '<tr>';
    tableRows += `<td class="cell-producto">${escapeHtml(row.producto)}</td>`;
    tableRows += `<td class="cell-categoria">${escapeHtml(row.categoria)}</td>`;
    for (const f of fechas) {
      const data = row.porFecha[f] || { tope: 0, agendados: 0, horaTope: null };
      const isAgotado = data.tope > 0 && data.agendados >= data.tope;
      const horaDisplay = data.horaTope !== null
        ? (isAgotado ? `<span class="hora-agotado">${data.horaTope}:00</span>` : `<span class="hora-disponible">✓</span>`)
        : '<span class="hora-na">—</span>';
      tableRows += `<td class="cell-tope">${data.tope}</td>`;
      tableRows += `<td class="cell-agendados ${isAgotado ? 'agotado' : ''}">${data.agendados}</td>`;
      tableRows += `<td class="cell-hora">${horaDisplay}</td>`;
    }
    tableRows += '</tr>';
  }

  let fechaOptions = '<option value="todas">Todas las fechas</option>';
  for (const f of fechas) { const [y, m, d] = f.split('-'); fechaOptions += `<option value="${f}">${d}/${m}/${y}</option>`; }

  let subHeaders = '', fechaHeaders = '', colSubHeaders = '';
  for (const f of fechas) {
    const [y, m, d] = f.split('-');
    fechaHeaders += `<th colspan="3" class="fecha-header" data-fecha="${f}">${d}/${m}/${y}</th>`;
    subHeaders += `<th colspan="3" class="sub-header-tope" data-fecha="${f}">Tope global: ${topesGlobalesPorFecha[f]}/día</th>`;
    colSubHeaders += `<th class="col-sub" data-fecha="${f}">Tope/día</th><th class="col-sub" data-fecha="${f}">Agendados</th><th class="col-sub" data-fecha="${f}">Hora</th>`;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vista Ejecutiva — Dashboard Topes TC Davibank</title>
  <style>
    :root { --primary: #1B5E20; --primary-light: #2E7D32; --bg: #f5f7fa; --white: #fff; --text: #333; --text-light: #666; --border: #e0e0e0; --danger: #c62828; --success: #2E7D32; --warning: #F9A825; --accent: #1565C0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
    .container { max-width: 1400px; margin: 0 auto; padding: 0 16px; }
    .header { background: var(--primary); color: var(--white); padding: 20px 0; margin-bottom: 24px; }
    .header-content { display: flex; align-items: center; gap: 16px; }
    .header-logo { height: 48px; }
    .header-title { font-size: 1.5rem; font-weight: 600; }
    .header-subtitle { font-size: 0.9rem; opacity: 0.85; }
    .info-bar { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between; background: var(--white); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; }
    .kpi-card { display: flex; flex-direction: column; align-items: center; }
    .kpi-label { font-size: 0.8rem; color: var(--text-light); text-transform: uppercase; }
    .kpi-value { font-size: 1.8rem; font-weight: 700; color: var(--primary); }
    .filtro-container { display: flex; align-items: center; gap: 12px; }
    .filtro-container label { font-weight: 600; font-size: 0.9rem; }
    .filtro-container select { padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.9rem; }
    .tabla-wrapper { overflow-x: auto; background: var(--white); border-radius: 8px; border: 1px solid var(--border); margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    th, td { padding: 8px 10px; text-align: center; border-bottom: 1px solid var(--border); }
    th { background: var(--primary); color: var(--white); font-weight: 600; white-space: nowrap; }
    .fecha-header { background: var(--primary-light); }
    .sub-header-tope { background: #E8F5E9; color: var(--primary); font-size: 0.75rem; }
    .col-sub { background: #f1f8e9; color: var(--text); font-size: 0.72rem; }
    .cell-producto, .cell-categoria { text-align: left; font-weight: 500; white-space: nowrap; }
    .cell-tope { color: var(--primary); font-weight: 600; }
    .cell-agendados { font-weight: 600; }
    .cell-agendados.agotado { color: var(--danger); background: #ffebee; }
    .hora-agotado { color: var(--danger); font-weight: 700; }
    .hora-disponible { color: var(--success); font-weight: 700; font-size: 1rem; }
    .hora-na { color: #bdbdbd; }
    tr:nth-child(even) { background: #fafafa; }
    tr:hover { background: #e8f5e9; }
    .leyenda { background: var(--white); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; }
    .leyenda h3 { font-size: 0.9rem; margin-bottom: 8px; color: var(--primary); }
    .leyenda-items { display: flex; flex-wrap: wrap; gap: 20px; font-size: 0.82rem; }
    .leyenda-item { display: flex; align-items: center; gap: 6px; }
    .gen-info { text-align: center; padding: 12px; font-size: 0.75rem; color: var(--text-light); }

    /* --- Panel de Topes --- */
    .topes-panel { background: var(--white); border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); margin-bottom: 24px; overflow: hidden; }
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
      .periodo-meta { flex-direction: column; }
      .form-group input { width: 100%; }
      .dist-table input { width: 55px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="container header-content">
      <img src="../logo_sb_.png" alt="Servicios Bolívar" class="header-logo">
      <div>
        <div class="header-title">Dashboard Topes TC Davibank</div>
        <div class="header-subtitle">Vista Ejecutiva — Control de Servicios Agendados por Tope Diario</div>
      </div>
    </div>
  </div>
  <div class="container">
    <div class="info-bar">
      <div class="kpi-card">
        <span class="kpi-label">Total Servicios Agendados</span>
        <span class="kpi-value" id="kpi-total">${totalServicios}</span>
      </div>
      <div class="filtro-container">
        <label for="filtro-fecha">Filtrar por fecha:</label>
        <select id="filtro-fecha">${fechaOptions}</select>
      </div>
    </div>

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
          <button class="btn btn-primary" onclick="saveTopesConfig()">💾 Guardar y recalcular</button>
        </div>
      </div>
    </div>

    <div class="tabla-wrapper">
      <table id="tabla-ejecutiva">
        <thead>
          <tr><th rowspan="3">Producto</th><th rowspan="3">Categoría TC</th>${fechaHeaders}</tr>
          <tr>${subHeaders}</tr>
          <tr>${colSubHeaders}</tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div class="leyenda">
      <h3>Leyenda</h3>
      <div class="leyenda-items">
        <div class="leyenda-item"><span class="hora-agotado">HH:00</span> Hora de agotamiento</div>
        <div class="leyenda-item"><span class="hora-disponible">✓</span> Disponible</div>
        <div class="leyenda-item"><span class="hora-na">—</span> Sin servicios</div>
        <div class="leyenda-item"><span style="background:#ffebee;padding:2px 6px;border-radius:3px;color:#c62828;font-weight:600;">N</span> Agotado</div>
      </div>
    </div>
    <div class="gen-info">Generado: ${new Date().toLocaleString('es-CO')}</div>
  </div>

  <!-- Toast notification -->
  <div class="toast" id="toast"></div>

  <script>
  (function() {
    'use strict';

    // --- Datos embebidos server-side ---
    var TOPES_CONFIG_DEFAULT = ${JSON.stringify(config)};
    var TRANSACTION_COUNTS = ${JSON.stringify(transactionCounts)};
    var HORA_TOPES = ${JSON.stringify(horaTopes)};
    var FECHAS = ${JSON.stringify(fechas)};
    var TABLA_COMBOS = ${JSON.stringify(tablaData.map(r => ({ producto: r.producto, categoria: r.categoria })))};

    // --- State ---
    var topesConfig = loadTopesConfig();
    var activePeriodoIdx = 0;

    // --- LocalStorage ---
    function loadTopesConfig() {
      var saved = localStorage.getItem('topes-config-davibank');
      if (saved) {
        try { return JSON.parse(saved); } catch(e) { /* fall through */ }
      }
      return JSON.parse(JSON.stringify(TOPES_CONFIG_DEFAULT));
    }

    function saveTopesConfig() {
      localStorage.setItem('topes-config-davibank', JSON.stringify(topesConfig));
      showToast('✅ Configuración guardada — recalculando tabla');
      document.getElementById('saveIndicator').classList.add('visible');
      setTimeout(function() { document.getElementById('saveIndicator').classList.remove('visible'); }, 3000);
      recalculateAndRender();
    }

    function resetDefaults() {
      if (!confirm('¿Resetear a la configuración por defecto? Se perderán los cambios locales.')) return;
      localStorage.removeItem('topes-config-davibank');
      topesConfig = JSON.parse(JSON.stringify(TOPES_CONFIG_DEFAULT));
      activePeriodoIdx = 0;
      renderTopesPanel();
      recalculateAndRender();
      showToast('↺ Configuración reseteada a defaults');
    }

    // --- Cálculo client-side ---
    function getResolvedDist(idx) {
      for (var i = idx; i >= 0; i--) {
        if (topesConfig.periodos[i].distribucion !== 'misma') return topesConfig.periodos[i].distribucion;
      }
      return TOPES_CONFIG_DEFAULT.periodos[0].distribucion;
    }

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
      return Math.floor(Math.floor(cfg.topeMensual * distProducto.pctProducto) * (distProducto.categorias[categoria] || 0) / cfg.diasMes);
    }

    function calcularTopeDiarioGlobalClient(fecha) {
      var cfg = getConfigForDateClient(fecha);
      if (!cfg) return 0;
      return Math.floor(cfg.topeMensual / cfg.diasMes);
    }

    function recalculateAndRender() {
      var table = document.getElementById('tabla-ejecutiva');
      var rows = table.querySelectorAll('tbody tr');
      var totalAgendados = 0;
      var filtro = document.getElementById('filtro-fecha');
      var selected = filtro.value;

      // Update sub-headers (tope global por fecha) and visibility
      var headerCells1 = table.querySelectorAll('thead tr:first-child th[data-fecha]');
      var subHeaderCells = table.querySelectorAll('thead tr:nth-child(2) th[data-fecha]');
      var colSubCells = table.querySelectorAll('thead tr:nth-child(3) th[data-fecha]');

      headerCells1.forEach(function(cell) {
        var f = cell.getAttribute('data-fecha');
        cell.style.display = (selected === 'todas' || f === selected) ? '' : 'none';
      });
      subHeaderCells.forEach(function(cell) {
        var f = cell.getAttribute('data-fecha');
        var tg = calcularTopeDiarioGlobalClient(f);
        cell.textContent = 'Tope global: ' + tg + '/día';
        cell.style.display = (selected === 'todas' || f === selected) ? '' : 'none';
      });
      colSubCells.forEach(function(cell) {
        var f = cell.getAttribute('data-fecha');
        cell.style.display = (selected === 'todas' || f === selected) ? '' : 'none';
      });

      rows.forEach(function(row, rowIdx) {
        var combo = TABLA_COMBOS[rowIdx];
        if (!combo) return;
        var cells = row.querySelectorAll('td');
        var colIdx = 2;

        for (var i = 0; i < FECHAS.length; i++) {
          var f = FECHAS[i];
          var tope = calcularTopeDiarioClient(f, combo.producto, combo.categoria);
          var countKey = combo.producto + '|' + combo.categoria + '|' + f;
          var agendados = TRANSACTION_COUNTS[countKey] || 0;
          var isAgotado = tope > 0 && agendados >= tope;
          var show = (selected === 'todas' || f === selected);

          // Tope cell
          if (cells[colIdx]) {
            cells[colIdx].textContent = tope;
            cells[colIdx].style.display = show ? '' : 'none';
          }
          colIdx++;

          // Agendados cell
          if (cells[colIdx]) {
            cells[colIdx].textContent = agendados;
            cells[colIdx].className = 'cell-agendados' + (isAgotado ? ' agotado' : '');
            cells[colIdx].style.display = show ? '' : 'none';
            if (show) totalAgendados += agendados;
          }
          colIdx++;

          // Hora cell
          if (cells[colIdx]) {
            var horaKey = combo.producto + '|' + combo.categoria + '|' + f;
            if (agendados === 0) {
              cells[colIdx].innerHTML = '<span class="hora-na">—</span>';
            } else if (isAgotado) {
              var horaOriginal = HORA_TOPES[horaKey];
              if (horaOriginal) {
                cells[colIdx].innerHTML = '<span class="hora-agotado">' + horaOriginal + ':00</span>';
              } else {
                cells[colIdx].innerHTML = '<span class="hora-agotado">🔴 Agotado</span>';
              }
            } else {
              cells[colIdx].innerHTML = '<span class="hora-disponible">✓</span>';
            }
            cells[colIdx].style.display = show ? '' : 'none';
          }
          colIdx++;
        }
      });

      document.getElementById('kpi-total').textContent = totalAgendados;
    }

    // --- Panel de Topes: Render ---
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

      html += '<div class="misma-dist">';
      html += '<input type="checkbox" id="mismaCheck" ' + (isMisma ? 'checked' : '') + ' onchange="toggleMisma(this.checked)">';
      html += '<label for="mismaCheck">Usar misma distribución del período anterior</label>';
      html += '</div>';

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
          var cantMesCat = Math.floor(cantMesProd * pctCat);
          var topeDia = Math.floor(cantMesCat / p.diasMes);

          html += '<tr' + (catIdx === 0 ? ' class="producto-row"' : '') + '>';
          if (catIdx === 0) {
            html += '<td rowspan="' + cats.length + '"><strong>' + prod + '</strong></td>';
            html += '<td rowspan="' + cats.length + '"><input type="number" value="' + (info.pctProducto * 100).toFixed(1) + '" step="0.1" min="0" max="100" onchange="updatePctProducto(&quot;' + prod.replace(/'/g, "&#39;") + '&quot;, this.value)"> %</td>';
          }
          html += '<td>' + cat + '</td>';
          html += '<td><input type="number" value="' + (pctCat * 100).toFixed(0) + '" step="1" min="0" max="100" onchange="updatePctCategoria(&quot;' + prod.replace(/'/g, "&#39;") + '&quot;, &quot;' + cat + '&quot;, this.value)"> %</td>';
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

    // --- Panel Actions ---
    function toggleTopesPanel() {
      var body = document.getElementById('topesBody');
      var icon = document.getElementById('toggleIcon');
      body.classList.toggle('open');
      icon.classList.toggle('open');
    }

    function selectPeriodo(idx) {
      activePeriodoIdx = idx;
      renderTopesPanel();
    }

    function updateMeta(field, value) {
      topesConfig.periodos[activePeriodoIdx][field] = value;
      renderPeriodoForm();
    }

    function updatePctProducto(prod, value) {
      topesConfig.periodos[activePeriodoIdx].distribucion[prod].pctProducto = parseFloat(value) / 100;
      renderPeriodoForm();
    }

    function updatePctCategoria(prod, cat, value) {
      topesConfig.periodos[activePeriodoIdx].distribucion[prod].categorias[cat] = parseFloat(value) / 100;
      renderPeriodoForm();
    }

    function toggleMisma(checked) {
      if (checked) {
        topesConfig.periodos[activePeriodoIdx].distribucion = 'misma';
      } else {
        var prevDist = getResolvedDist(activePeriodoIdx - 1);
        topesConfig.periodos[activePeriodoIdx].distribucion = JSON.parse(JSON.stringify(prevDist));
      }
      renderPeriodoForm();
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
      showToast('🗑️ Período eliminado');
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

    // --- Expose to global (onclick handlers) ---
    window.toggleTopesPanel = toggleTopesPanel;
    window.selectPeriodo = selectPeriodo;
    window.updateMeta = updateMeta;
    window.updatePctProducto = updatePctProducto;
    window.updatePctCategoria = updatePctCategoria;
    window.toggleMisma = toggleMisma;
    window.addPeriodo = addPeriodo;
    window.duplicatePeriodo = duplicatePeriodo;
    window.deletePeriodo = deletePeriodo;
    window.saveTopesConfig = saveTopesConfig;
    window.resetDefaults = resetDefaults;

    // --- Filtro de fecha (original) ---
    var filtro = document.getElementById('filtro-fecha');
    filtro.addEventListener('change', function() {
      recalculateAndRender();
    });

    // --- Init ---
    renderTopesPanel();
    recalculateAndRender();

  })();
  </script>
</body>
</html>`;
}

// --- Main ---
function main() {
  console.log('=== Generador Vista Ejecutiva ===');
  const transacciones = leerTransacciones();
  console.log(`Transacciones: ${transacciones.length}`);

  const combos = getAllProductoCategorias();
  const fechasSet = new Set();

  for (const periodo of config.periodos) {
    const desde = new Date(periodo.desde + 'T00:00:00');
    const hasta = new Date(periodo.hasta + 'T00:00:00');
    const hoy = new Date();
    const limite = hasta < hoy ? hasta : hoy;
    let current = new Date(desde);
    while (current <= limite) {
      const f = current.toISOString().slice(0, 10);
      if (f >= FECHA_MINIMA) fechasSet.add(f);
      current.setDate(current.getDate() + 1);
    }
  }
  transacciones.forEach(t => fechasSet.add(t.fecha));
  const fechas = Array.from(fechasSet).sort();

  const tablaData = combos.map(combo => {
    const row = { producto: combo.producto, categoria: combo.categoria, porFecha: {} };
    for (const f of fechas) {
      const tope = calcularTopeDiario(f, combo.producto, combo.categoria);
      const agendados = transacciones.filter(t => t.fecha === f && t.producto === combo.producto && t.categoria === combo.categoria);
      const count = agendados.length;
      let horaTope = null;
      if (count > 0) {
        const sorted = agendados.sort((a, b) => a.hora.localeCompare(b.hora));
        horaTope = tope > 0 && count >= tope ? sorted[Math.min(tope - 1, sorted.length - 1)].hora : sorted[sorted.length - 1].hora;
      }
      row.porFecha[f] = { tope, agendados: count, horaTope };
    }
    return row;
  });

  // Construir mapa de conteos para recálculo client-side
  const transactionCounts = buildTransactionCounts(transacciones);

  // Construir mapa de horas de agotamiento (server-side) para mostrar en recálculo
  const horaTopes = {};
  for (const row of tablaData) {
    for (const f of fechas) {
      const data = row.porFecha[f];
      if (data && data.horaTope !== null) {
        horaTopes[`${row.producto}|${row.categoria}|${f}`] = data.horaTope;
      }
    }
  }

  const html = generateEjecutivoHTML(tablaData, fechas, transactionCounts);
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, html, 'utf-8');
  console.log(`HTML generado: ${OUTPUT_PATH}`);
  console.log(`Combos: ${combos.length} | Fechas: ${fechas.length} | Transacciones indexadas: ${Object.keys(transactionCounts).length}`);
}

main();
