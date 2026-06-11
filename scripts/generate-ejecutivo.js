/**
 * generate-ejecutivo.js
 * Genera la vista ejecutiva HTML del Dashboard de Topes TC Davibank.
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
  console.error(`Error: No se encontró topes-config.json`);
  process.exit(1);
}
if (!fs.existsSync(CSV_PATH)) {
  console.error(`Error: No se encontró data/ordenes.csv`);
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

// --- Generación HTML ---
function generateEjecutivoHTML(tablaData, fechas) {
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
    :root { --primary: #1B5E20; --primary-light: #2E7D32; --bg: #f5f7fa; --white: #fff; --text: #333; --text-light: #666; --border: #e0e0e0; --danger: #c62828; --success: #2E7D32; }
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
  <script>
    (function() {
      var filtro = document.getElementById('filtro-fecha');
      var table = document.getElementById('tabla-ejecutiva');
      var fechas = ${JSON.stringify(fechas)};

      filtro.addEventListener('change', function() {
        var selected = this.value;
        var headerCells1 = table.querySelectorAll('thead tr:first-child th[data-fecha]');
        var headerCells2 = table.querySelectorAll('thead tr:nth-child(2) th[data-fecha]');
        var headerCells3 = table.querySelectorAll('thead tr:nth-child(3) th[data-fecha]');
        [headerCells1, headerCells2, headerCells3].forEach(function(cells) {
          cells.forEach(function(cell) { cell.style.display = (selected === 'todas' || cell.getAttribute('data-fecha') === selected) ? '' : 'none'; });
        });
        var totalAgendados = 0;
        table.querySelectorAll('tbody tr').forEach(function(row) {
          var cells = row.querySelectorAll('td');
          var colIdx = 2;
          for (var i = 0; i < fechas.length; i++) {
            var show = (selected === 'todas' || fechas[i] === selected);
            for (var j = 0; j < 3; j++) { if (cells[colIdx]) { cells[colIdx].style.display = show ? '' : 'none'; if (show && j === 1) totalAgendados += parseInt(cells[colIdx].textContent) || 0; } colIdx++; }
          }
        });
        document.getElementById('kpi-total').textContent = totalAgendados;
      });
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

  const html = generateEjecutivoHTML(tablaData, fechas);
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, html, 'utf-8');
  console.log(`HTML generado: ${OUTPUT_PATH}`);
}

main();
