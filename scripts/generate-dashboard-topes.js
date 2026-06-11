/**
 * Script para generar el Dashboard HTML de Topes TC Davibank.
 * Versión CI: lee CSV desde data/ordenes.csv (relativo al repo).
 *
 * Insumos:
 *   - topes-config.json (distribución de topes por período)
 *   - data/ordenes.csv (transacciones con hora, producto, categoría)
 *
 * Salida:
 *   - index.html (dashboard principal autocontenido)
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

// --- Generar HTML usando template ---
const templatePath = path.join(ROOT_DIR, 'templates', 'dashboard-template.html');
let html;

if (fs.existsSync(templatePath)) {
  html = fs.readFileSync(templatePath, 'utf8');
  html = html.replace('__DASHBOARD_DATA__', JSON.stringify(dashboardData));
  html = html.replace('__TOPES_CONFIG__', JSON.stringify(config));
} else {
  // Fallback: leer el HTML actual y reemplazar los datos embebidos
  const currentHtml = fs.existsSync(OUTPUT_HTML) ? fs.readFileSync(OUTPUT_HTML, 'utf8') : '';
  if (currentHtml) {
    html = currentHtml.replace(
      /const DASHBOARD_DATA = .*?;/s,
      `const DASHBOARD_DATA = ${JSON.stringify(dashboardData, null, 2)};`
    );
  } else {
    console.error('No se encontró template ni HTML existente. Ejecutar primero con el script original.');
    process.exit(1);
  }
}

fs.writeFileSync(OUTPUT_HTML, html, 'utf8');
console.log(`Dashboard generado: ${OUTPUT_HTML}`);
console.log('=== Generación completada ===');
