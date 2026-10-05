'use strict';

const FORMAT = 'kv-diagramme';
const VERSION = 1;
const STORAGE_KEY = 'kv-diagramme';

// Feste Maße: jedes Diagramm wird ausschließlich aus diesen Werten aufgebaut.
const CELL = 60;
const PAD = 12;
const BAND = 50; // Platz für Beschriftung auf jeder Seite
const GX = PAD + BAND;
const GY = PAD + BAND;
const FONT = 'Helvetica, Arial, sans-serif';
const INK = '#111111';
const INDEX_INK = '#777777';
const TITLE_SIZE = 20;
const LABEL_SIZE = 16;
const MSB_SIZE = 11;
const LABEL_GAP = 6; // Abstand Balken → Variablenname
const MSB_GAP = 4;
const NAME_LINE = 24; // Länge der 45°-Linie zum Funktionsnamen (je Achse)
const NAME_GAP = 3;
const CODE_GAP_TOP = 12; // Gray-Code über den Spalten
const CODE_GAP_LEFT = 14; // Gray-Code links der Zeilen
const CORNER = { line: 44, rowX: 26, rowY: 8, colX: 16, colY: 34 }; // Diagonale oben links im Gray-Code-Modus
const VALUE_SIZE = 22;
const INDEX_SIZE = 9;
const INDEX_INSET = 14;
const BORDER_W = 2;
const GRID_W = 1;
const BAR_W = 2;
const BAR_GAP = 14;
const GROUP_W = 2.5;
const GROUP_INSETS = [3, 6, 9]; // überlappende Gruppen werden unterschiedlich weit eingerückt
const GROUP_RADIUS = 12;
const GROUP_OVERHANG = 8; // so weit ragen Halbrahmen bei Rand-Umbruch über das Diagramm hinaus
const EXPORT_GAP = 8;
const PNG_SCALE = 3;

const GRAY = [0, 1, 3, 2];
const VALUES = ['', '1', '0', 'X']; // Reihenfolge beim Durchklicken
const DEFAULT_VARS = ['a', 'b', 'c', 'd'];
const PALETTE = ['#d62728', '#1f77b4', '#2ca02c', '#ff7f0e', '#9467bd', '#17becf', '#e377c2', '#8c564b'];

// ---------- Datenmodell ----------

function defaultDiagram() {
  return { name: 'f', vars: [...DEFAULT_VARS], cells: Array(16).fill(''), groups: [] };
}

function defaultState() {
  return {
    format: FORMAT,
    version: VERSION,
    settings: { labelStyle: 'bars', showIndex: true },
    diagrams: [defaultDiagram()],
  };
}

// Prüft importierte Daten und liefert eine saubere Kopie; wirft mit verständlicher Meldung.
function normalize(data) {
  const fail = (msg) => { throw new Error(msg); };
  if (!data || typeof data !== 'object' || data.format !== FORMAT) fail('Das ist keine KV-Diagramm-Datei.');
  if (data.version !== VERSION) fail(`Version ${data.version} wird nicht unterstützt.`);
  if (!Array.isArray(data.diagrams) || !data.diagrams.length) fail('Die Datei enthält keine Diagramme.');
  const settings = data.settings || {};
  return {
    format: FORMAT,
    version: VERSION,
    settings: {
      labelStyle: settings.labelStyle === 'gray' ? 'gray' : 'bars',
      showIndex: settings.showIndex !== false,
    },
    diagrams: data.diagrams.map((d, i) => {
      const where = `Diagramm ${i + 1}`;
      if (!d || typeof d !== 'object') fail(`${where} ist ungültig.`);
      if (!Array.isArray(d.vars) || d.vars.length < 2 || d.vars.length > 4 || !d.vars.every((v) => typeof v === 'string')) {
        fail(`${where}: „vars“ muss 2 bis 4 Namen enthalten.`);
      }
      const size = 1 << d.vars.length;
      if (!Array.isArray(d.cells) || d.cells.length !== size || !d.cells.every((v) => VALUES.includes(v))) {
        fail(`${where}: „cells“ muss ${size} Werte aus "", "0", "1", "X" enthalten.`);
      }
      if (d.groups != null && !Array.isArray(d.groups)) fail(`${where}: „groups“ muss eine Liste sein.`);
      return {
        name: typeof d.name === 'string' ? d.name : '',
        vars: [...d.vars],
        cells: [...d.cells],
        groups: (d.groups || []).map((g, j) => {
          const ok = g && typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color) && Array.isArray(g.cells)
            && g.cells.every((c) => Number.isInteger(c) && c >= 0 && c < size);
          if (!ok) fail(`${where}, Gruppe ${j + 1} ist ungültig.`);
          return { color: g.color.toLowerCase(), cells: [...new Set(g.cells)].sort((a, b) => a - b) };
        }),
      };
    }),
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (err) {
    console.warn('Gespeicherter Stand konnte nicht geladen werden:', err);
  }
  return defaultState();
}

function setVarCount(d, n) {
  const size = 1 << n;
  d.vars = Array.from({ length: n }, (_, i) => d.vars[i] ?? DEFAULT_VARS[i]);
  d.cells = Array.from({ length: size }, (_, i) => d.cells[i] ?? '');
  d.groups.forEach((g) => { g.cells = g.cells.filter((c) => c < size); });
}

function hasContent(d) {
  return d.cells.some(Boolean) || d.groups.length > 0;
}

// ---------- Diagramm-Geometrie ----------

// Variablen wechseln sich ab: x1, x3 auf den Spalten, x2, x4 auf den Zeilen (Positionen in diagram.vars).
function layout(n) {
  const colPos = [0, 2].filter((v) => v < n);
  const rowPos = [1, 3].filter((v) => v < n);
  return { colPos, rowPos, rows: 1 << rowPos.length, cols: 1 << colPos.length };
}

// Ist die j-te Variable einer Achse an Position i gesetzt? Ergibt die Folge 00, 10, 11, 01.
function axisBit(i, j) {
  return (GRAY[i] >> j) & 1;
}

// Einzige Stelle, die Zeile/Spalte auf die Minterm-Nummer abbildet (erste Variable = MSB).
function cellIndex(row, col, n) {
  const { colPos, rowPos } = layout(n);
  let idx = 0;
  colPos.forEach((v, j) => { if (axisBit(col, j)) idx |= 1 << (n - 1 - v); });
  rowPos.forEach((v, j) => { if (axisBit(row, j)) idx |= 1 << (n - 1 - v); });
  return idx;
}

// Erste und letzte Zeile/Spalte, in der die j-te Achsenvariable gesetzt ist.
function bitRun(count, j) {
  const on = [];
  for (let i = 0; i < count; i++) {
    if (axisBit(i, j)) on.push(i);
  }
  return [on[0], on[on.length - 1]];
}

function allIn(from, to, fn) {
  for (let i = from; i <= to; i++) if (!fn(i)) return false;
  return true;
}

// Zerlegt eine Zellmenge in Rechtecke (gleiche Läufe in aufeinanderfolgenden Zeilen werden zusammengefasst).
function groupRects(member, rows, cols) {
  const rects = [];
  let previous = [];
  for (let r = 0; r < rows; r++) {
    const current = [];
    for (let c = 0; c < cols; c++) {
      if (!member(r, c)) continue;
      let c1 = c;
      while (c1 + 1 < cols && member(r, c1 + 1)) c1++;
      let rect = previous.find((q) => q.c0 === c && q.c1 === c1);
      if (rect) rect.r1 = r;
      else rects.push(rect = { r0: r, r1: r, c0: c, c1 });
      current.push(rect);
      c = c1;
    }
    previous = current;
  }
  return rects;
}

// Rahmen mit abgerundeten Ecken; offene Seiten werden ausgelassen.
function framePath(x0, y0, x1, y1, open) {
  const r = Math.min(GROUP_RADIUS, (x1 - x0) / 2, (y1 - y0) / 2);
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const closed = [!open.top, !open.right, !open.bottom, !open.left];
  let d = '';
  for (let i = 0; i < 4; i++) {
    if (!closed[i]) continue;
    const j = (i + 1) % 4;
    const [ax, ay] = corners[i];
    const [bx, by] = corners[j];
    const [dx, dy] = dirs[i];
    const start = closed[(i + 3) % 4] ? r : 0;
    const end = closed[j] ? r : 0;
    d += `M${ax + dx * start} ${ay + dy * start}L${bx - dx * end} ${by - dy * end}`;
    if (closed[j]) d += `A${r} ${r} 0 0 1 ${bx + dirs[j][0] * r} ${by + dirs[j][1] * r}`;
  }
  return d;
}

// ---------- SVG-Grundlagen ----------

const SVG_NS = 'http://www.w3.org/2000/svg';

function setAttrs(node, attrs) {
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function el(tag, attrs = {}, text) {
  const node = setAttrs(document.createElementNS(SVG_NS, tag), attrs);
  if (text != null) node.textContent = text;
  return node;
}

function line(x1, y1, x2, y2, width) {
  return el('line', { x1, y1, x2, y2, stroke: INK, 'stroke-width': width });
}

// "x_1" bzw. "x_{10}" → Teile mit Tiefstellung.
function splitSubscripts(name) {
  const parts = [];
  const re = /_(\{[^}]*\}|[A-Za-z0-9]+)/g;
  let last = 0;
  let m;
  while ((m = re.exec(name))) {
    if (m.index > last) parts.push({ str: name.slice(last, m.index), sub: false });
    const sub = m[1].replace(/^\{|\}$/g, '');
    if (sub) parts.push({ str: sub, sub: true });
    last = re.lastIndex;
  }
  if (last < name.length) parts.push({ str: name.slice(last), sub: false });
  return parts;
}

// Setzt LaTeX mit MathJax; die Glyphen sind Pfade, damit SVG- und PNG-Export ohne Schriften auskommen.
// Liefert Maße in px und place(x, grundlinie) für die linke Kante.
function tex(source, size) {
  if (window.MathJax?.tex2svg) {
    try {
      const math = MathJax.tex2svg(source, { display: false }).querySelector('svg');
      const [, minY, vw, vh] = math.getAttribute('viewBox').split(' ').map(Number);
      const k = size / 1000; // MathJax rechnet in 1/1000 em
      for (const attr of ['style', 'role', 'focusable']) math.removeAttribute(attr);
      return {
        width: vw * k,
        ascent: -minY * k,
        descent: (vh + minY) * k,
        place: (x, baseline) => setAttrs(math, {
          x, y: baseline + minY * k, width: vw * k, height: vh * k, overflow: 'visible', color: INK,
        }),
      };
    } catch (err) {
      console.warn('LaTeX konnte nicht gesetzt werden:', err);
    }
  }
  return plainTex(source, size);
}

// Ersatz ohne MathJax (z. B. offline): versteht nur Tiefstellungen wie "x_1" und "x_{10}".
function plainTex(source, size) {
  const parts = splitSubscripts(source.replace(/\\,/g, ' '));
  const shift = size * 0.25;
  return {
    width: parts.reduce((sum, part) => sum + part.str.length * size * (part.sub ? 0.7 : 1) * 0.55, 0),
    ascent: size * 0.75,
    descent: size * 0.3,
    place(x, baseline) {
      const text = el('text', { x, y: baseline, 'font-size': size, fill: INK });
      let lowered = false;
      for (const part of parts) {
        const span = el('tspan', {}, part.str);
        if (part.sub) span.setAttribute('font-size', size * 0.7);
        if (part.sub !== lowered) span.setAttribute('dy', part.sub ? shift : -shift);
        lowered = part.sub;
        text.appendChild(span);
      }
      return text;
    },
  };
}

// ---------- Diagramm zeichnen ----------

// Gemeinsamer Zustand der draw…-Funktionen. Der sichtbare Bereich (bounds) wächst mit allem, was als LaTeX gesetzt wird.
function diagramContext(n) {
  const { colPos, rowPos, rows, cols } = layout(n);
  const w = cols * CELL;
  const h = rows * CELL;
  const svg = el('svg', { 'font-family': FONT });
  const background = svg.appendChild(el('rect', { fill: '#ffffff' }));
  const bounds = { x0: 0, y0: 0, x1: GX + w + BAND + PAD, y1: GY + h + BAND + PAD };
  const cellAt = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => cellIndex(r, c, n)));
  return {
    colPos, rowPos, rows, cols, w, h, svg, background, bounds, cellAt,
    add: (node) => svg.appendChild(node),
    eachCell: (fn) => cellAt.forEach((row, r) => row.forEach((idx, c) => fn(idx, GX + c * CELL, GY + r * CELL))),
    put(m, x, baseline) {
      svg.appendChild(m.place(x, baseline));
      bounds.x0 = Math.min(bounds.x0, x - PAD);
      bounds.y0 = Math.min(bounds.y0, baseline - m.ascent - PAD);
      bounds.x1 = Math.max(bounds.x1, x + m.width + PAD);
      bounds.y1 = Math.max(bounds.y1, baseline + m.descent + PAD);
    },
  };
}

function drawHighlight(ctx, group) {
  const cells = new Set(group.cells);
  ctx.eachCell((idx, x, y) => {
    if (cells.has(idx)) ctx.add(el('rect', { x, y, width: CELL, height: CELL, fill: group.color, 'fill-opacity': 0.15 }));
  });
}

function drawGrid({ add, rows, cols, w, h }) {
  for (let c = 1; c < cols; c++) add(line(GX + c * CELL, GY, GX + c * CELL, GY + h, GRID_W));
  for (let r = 1; r < rows; r++) add(line(GX, GY + r * CELL, GX + w, GY + r * CELL, GRID_W));
  add(el('rect', { x: GX, y: GY, width: w, height: h, fill: 'none', stroke: INK, 'stroke-width': BORDER_W }));
}

function drawCells(ctx, values, showIndex) {
  ctx.eachCell((idx, x, y) => {
    if (values[idx]) {
      ctx.add(el('text', {
        x: x + CELL / 2, y: y + CELL / 2 + VALUE_SIZE * 0.35, 'text-anchor': 'middle', 'font-size': VALUE_SIZE, fill: INK,
      }, values[idx]));
    }
    if (showIndex) {
      ctx.add(el('text', {
        x: x + CELL - INDEX_INSET, y: y + CELL - INDEX_INSET, 'text-anchor': 'end', 'font-size': INDEX_SIZE, fill: INDEX_INK,
      }, idx));
    }
  });
}

// Funktionsname: abgesetzt von der rechten oberen Ecke, mit 45°-Linie verbunden.
function drawName(ctx, name) {
  if (!name.trim()) return;
  const ex = GX + ctx.w + NAME_LINE;
  const ey = GY - NAME_LINE;
  ctx.add(line(GX + ctx.w, GY, ex, ey, GRID_W));
  const m = tex(name, TITLE_SIZE);
  ctx.put(m, ex + NAME_GAP, ey - NAME_GAP - m.descent);
}

// Balken über den Zeilen/Spalten, in denen die Variable 1 ist: erste Variable oben/links, zweite unten/rechts.
function drawBarLabels(ctx, vars) {
  const { add, put, rows, cols, w, h } = ctx;
  ctx.colPos.forEach((v, bit) => {
    const [a, b] = bitRun(cols, bit);
    const xa = GX + a * CELL;
    const xb = GX + (b + 1) * CELL;
    const top = bit === 0;
    const y = top ? GY - BAR_GAP : GY + h + BAR_GAP;
    add(line(xa, y, xb, y, BAR_W));
    const m = tex(vars[v], LABEL_SIZE);
    const baseline = top ? y - LABEL_GAP - m.descent : y + LABEL_GAP + m.ascent;
    let x = (xa + xb) / 2 - m.width / 2;
    // Die erste Variable ist immer die oberste Spalte; der Zusatz darf nicht in die Linie zum Funktionsnamen ragen.
    if (top) {
      const msb = tex('\\text{(MSB)}', MSB_SIZE);
      x = Math.min(x, GX + w - m.width - MSB_GAP - msb.width);
      put(msb, x + m.width + MSB_GAP, baseline);
    }
    put(m, x, baseline);
  });
  ctx.rowPos.forEach((v, bit) => {
    const [a, b] = bitRun(rows, bit);
    const ya = GY + a * CELL;
    const yb = GY + (b + 1) * CELL;
    const left = bit === 0;
    const x = left ? GX - BAR_GAP : GX + w + BAR_GAP;
    add(line(x, ya, x, yb, BAR_W));
    const m = tex(vars[v], LABEL_SIZE);
    put(m, left ? x - LABEL_GAP - m.width : x + LABEL_GAP, (ya + yb) / 2 + (m.ascent - m.descent) / 2);
  });
}

// Gray-Code an jeder Zeile/Spalte, Variablennamen an der Diagonale oben links.
function drawGrayLabels(ctx, vars) {
  const { add, put, rows, cols, colPos, rowPos } = ctx;
  const code = (count, i) => Array.from({ length: count }, (_, j) => axisBit(i, j)).join('');
  const text = (attrs, content) => add(el('text', { 'font-size': LABEL_SIZE, fill: INK, ...attrs }, content));
  for (let c = 0; c < cols; c++) {
    text({ x: GX + c * CELL + CELL / 2, y: GY - CODE_GAP_TOP, 'text-anchor': 'middle' }, code(colPos.length, c));
  }
  for (let r = 0; r < rows; r++) {
    text({ x: GX - CODE_GAP_LEFT, y: GY + r * CELL + CELL / 2 + LABEL_SIZE * 0.35, 'text-anchor': 'end' }, code(rowPos.length, r));
  }
  add(line(GX - CORNER.line, GY - CORNER.line, GX, GY, GRID_W));
  const rowLabel = tex(rowPos.map((v) => vars[v]).join('\\,'), LABEL_SIZE);
  put(rowLabel, GX - CORNER.rowX - rowLabel.width, GY - CORNER.rowY);
  put(tex(colPos.map((v) => vars[v]).join('\\,'), LABEL_SIZE), GX - CORNER.colX, GY - CORNER.colY);
}

// Jede Gruppe bekommt die kleinste Einrückung, die keine frühere Gruppe mit gemeinsamer Zelle schon nutzt.
function drawGroups(ctx, groups) {
  const { rows, cols, w, h, cellAt } = ctx;
  const levels = [];
  groups.forEach((group, gi) => {
    const cells = new Set(group.cells);
    const taken = new Set(levels.filter((_, k) => groups[k].cells.some((c) => cells.has(c))));
    const free = GROUP_INSETS.findIndex((_, level) => !taken.has(level));
    levels.push(free === -1 ? gi % GROUP_INSETS.length : free);
    const inset = GROUP_INSETS[levels[gi]];
    const member = (r, c) => cells.has(cellAt[r][c]);
    let d = '';
    for (const q of groupRects(member, rows, cols)) {
      // Seite bleibt offen, wenn die Gruppe am gegenüberliegenden Rand weitergeht.
      const open = {
        left: q.c0 === 0 && q.c1 < cols - 1 && allIn(q.r0, q.r1, (r) => member(r, cols - 1)),
        right: q.c1 === cols - 1 && q.c0 > 0 && allIn(q.r0, q.r1, (r) => member(r, 0)),
        top: q.r0 === 0 && q.r1 < rows - 1 && allIn(q.c0, q.c1, (c) => member(rows - 1, c)),
        bottom: q.r1 === rows - 1 && q.r0 > 0 && allIn(q.c0, q.c1, (c) => member(0, c)),
      };
      d += framePath(
        open.left ? GX - GROUP_OVERHANG : GX + q.c0 * CELL + inset,
        open.top ? GY - GROUP_OVERHANG : GY + q.r0 * CELL + inset,
        open.right ? GX + w + GROUP_OVERHANG : GX + (q.c1 + 1) * CELL - inset,
        open.bottom ? GY + h + GROUP_OVERHANG : GY + (q.r1 + 1) * CELL - inset,
        open,
      );
    }
    if (d) ctx.add(el('path', { d, fill: 'none', stroke: group.color, 'stroke-width': GROUP_W, 'stroke-linecap': 'round' }));
  });
}

function drawHitAreas(ctx) {
  ctx.eachCell((idx, x, y) => {
    ctx.add(el('rect', {
      x, y, width: CELL, height: CELL, fill: 'none', 'pointer-events': 'all', 'data-idx': idx, style: 'cursor:pointer',
    }));
  });
}

// opts.interactive: Klickflächen pro Zelle; opts.highlight: Gruppe, deren Zellen im Editor hinterlegt werden.
function renderDiagramSVG(diagram, settings, opts = {}) {
  const ctx = diagramContext(diagram.vars.length);
  if (opts.highlight) drawHighlight(ctx, opts.highlight);
  drawGrid(ctx);
  drawCells(ctx, diagram.cells, settings.showIndex);
  drawName(ctx, diagram.name);
  if (settings.labelStyle === 'gray') drawGrayLabels(ctx, diagram.vars);
  else drawBarLabels(ctx, diagram.vars);
  drawGroups(ctx, diagram.groups);
  if (opts.interactive) drawHitAreas(ctx);

  const { x0, y0, x1, y1 } = ctx.bounds;
  const box = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  setAttrs(ctx.background, box);
  return setAttrs(ctx.svg, { width: box.width, height: box.height, viewBox: `${box.x} ${box.y} ${box.width} ${box.height}` });
}

// Sichtbarer Bereich eines Diagramm-SVGs (beginnt wegen langer Beschriftungen evtl. im Negativen).
function viewBox(svg) {
  const [x, y, width, height] = svg.getAttribute('viewBox').split(' ').map(Number);
  return { x, y, width, height };
}

// Alle Diagramme nebeneinander in einem SVG; die Raster stehen auf gleicher Höhe.
function renderAllSVG() {
  const parts = state.diagrams.map((d) => renderDiagramSVG(d, state.settings));
  const boxes = parts.map(viewBox);
  const top = Math.max(...boxes.map((b) => -b.y));
  const H = top + Math.max(...boxes.map((b) => b.y + b.height));
  const W = boxes.reduce((sum, b) => sum + b.width, 0) + EXPORT_GAP * (parts.length - 1);
  const out = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'font-family': FONT });
  out.appendChild(el('rect', { width: W, height: H, fill: '#ffffff' }));
  let x = 0;
  parts.forEach((svg, i) => {
    const g = el('g', { transform: `translate(${x - boxes[i].x} ${top})` });
    g.append(...svg.childNodes);
    out.appendChild(g);
    x += boxes[i].width + EXPORT_GAP;
  });
  return out;
}

// ---------- Export ----------

function serialize(svg) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
}

function svgBlob(svg) {
  return new Blob([serialize(svg)], { type: 'image/svg+xml' });
}

function pngBlob(svg) {
  return new Promise((resolve, reject) => {
    const failed = () => reject(new Error('PNG konnte nicht erzeugt werden.'));
    const url = URL.createObjectURL(svgBlob(svg));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Number(svg.getAttribute('width')) * PNG_SCALE;
      canvas.height = Number(svg.getAttribute('height')) * PNG_SCALE;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : failed()), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      failed();
    };
    img.src = url;
  });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// LaTeX-Befehle fallen weg: "\overline{y}" → "y", "f_1(x_1,x_2)" → "f_1_x_1_x_2".
function fileName(diagram, ext) {
  const base = diagram.name.replace(/\\[a-zA-Z]+/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
  return `kv-${base || 'diagramm'}.${ext}`;
}

function exportSvg(svg, filename) {
  download(svgBlob(svg), filename);
}

function exportPng(svg, filename) {
  pngBlob(svg).then((blob) => download(blob, filename)).catch((err) => notify(err.message, true));
}

// ---------- Bausteine der Oberfläche ----------

// Lucide-Icons (ISC-Lizenz), 24er-Raster.
const ICONS = {
  plus: ['M5 12h14', 'M12 5v14'],
  'arrow-up': ['m5 12 7-7 7 7', 'M12 19V5'],
  'arrow-down': ['M12 5v14', 'm19 12-7 7-7-7'],
  copy: ['M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'],
  trash: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2', 'M10 11v6', 'M14 11v6'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  pencil: ['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z', 'm15 5 4 4'],
  check: ['M20 6 9 17l-5-5'],
};

function icon(name, size = 16) {
  const svg = el('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon',
  });
  for (const d of ICONS[name]) svg.appendChild(el('path', { d }));
  return svg;
}

// Nicht gesetzte (undefined) Eigenschaften werden übersprungen.
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) if (value !== undefined) node[key] = value;
  node.append(...children.filter((child) => child != null));
  return node;
}

// variant: primary | outline | ghost; size: icon. Reine Icon-Buttons brauchen title.
function button(label, { variant = 'outline', size, icon: iconName, title, onClick, disabled } = {}) {
  const className = ['btn', `btn--${variant}`, size && `btn--${size}`].filter(Boolean).join(' ');
  const node = h('button', { type: 'button', className, title, onclick: onClick, disabled });
  if (!label) node.setAttribute('aria-label', title);
  if (iconName) node.append(icon(iconName));
  if (label) node.append(label);
  return node;
}

function buttonGroup(...buttons) {
  return h('div', { className: 'btn-group' }, ...buttons);
}

let segmentedCount = 0;

// Umschalter aus Radiobuttons; gleiche Struktur wie die Beschriftungswahl in index.html.
function segmented(label, options, value, onChange) {
  const name = `segmented-${++segmentedCount}`;
  return h('div', { className: 'segmented', role: 'radiogroup', ariaLabel: label }, ...options.map((option) => h('label', {},
    h('input', { type: 'radio', name, value: option, checked: option === value, onchange: () => onChange(option) }),
    h('span', {}, option))));
}

// Eine Zeile im .form-Raster: Beschriftung links, Inhalt (untereinander) rechts.
function row(label, ...children) {
  return [h('span', { className: 'label' }, label), h('div', { className: 'form-cell' }, ...children)];
}

// ---------- Oberfläche ----------

let state = loadState();
let editing = null; // { diagram, group } während Zellen einer Gruppe gewählt werden

const list = document.getElementById('diagrams');
const message = document.getElementById('message');
const fileInput = document.getElementById('file');
let messageTimer;

function notify(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('error', isError);
  message.hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => { message.hidden = true; }, 6000);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Speichern im Browser nicht möglich:', err);
  }
}

function update() {
  save();
  renderAll();
}

function renderAll() {
  list.replaceChildren(...state.diagrams.map(renderCard));
  for (const radio of document.querySelectorAll('input[name="labelStyle"]')) {
    radio.checked = radio.value === state.settings.labelStyle;
  }
  document.getElementById('showIndex').checked = state.settings.showIndex;
}

function nextColor(diagram) {
  const used = new Set(diagram.groups.map((g) => g.color));
  return PALETTE.find((color) => !used.has(color)) || PALETTE[diagram.groups.length % PALETTE.length];
}

function renderCard(d, di) {
  const activeGroup = editing && editing.diagram === d ? editing.group : null;
  const card = h('section', { className: activeGroup ? 'card editing' : 'card' });
  if (activeGroup) card.style.setProperty('--group', activeGroup.color);

  const canvas = h('div', { className: 'canvas' });
  // Bei Texteingaben wird nur das SVG neu gezeichnet, damit das Eingabefeld den Fokus behält.
  const draw = () => canvas.replaceChildren(renderDiagramSVG(d, state.settings, { interactive: true, highlight: activeGroup }));
  const redraw = () => { draw(); save(); };
  draw();

  canvas.addEventListener('click', (e) => {
    const attr = e.target.getAttribute('data-idx');
    if (attr == null) return;
    const idx = Number(attr);
    if (activeGroup) {
      activeGroup.cells = activeGroup.cells.includes(idx)
        ? activeGroup.cells.filter((c) => c !== idx)
        : [...activeGroup.cells, idx].sort((a, b) => a - b);
    } else {
      d.cells[idx] = VALUES[(VALUES.indexOf(d.cells[idx]) + 1) % VALUES.length];
    }
    update();
  });

  card.append(canvas, h('div', { className: 'panel' },
    cardHead(d, di, activeGroup),
    h('div', { className: 'form' },
      ...cardFields(d, redraw),
      ...cardGroups(d, card, activeGroup, redraw),
      ...cardExport(d))));
  return card;
}

function cardHead(d, di, activeGroup) {
  const move = (to) => {
    state.diagrams.splice(di, 1);
    state.diagrams.splice(to, 0, d);
    update();
  };
  const remove = () => {
    if (hasContent(d) && !confirm(`Diagramm ${di + 1} wirklich löschen?`)) return;
    state.diagrams.splice(di, 1);
    if (!state.diagrams.length) state.diagrams.push(defaultDiagram());
    if (activeGroup) editing = null;
    update();
  };
  const duplicate = () => {
    state.diagrams.splice(di + 1, 0, JSON.parse(JSON.stringify(d)));
    update();
  };
  return h('div', { className: 'panel-head' },
    h('h2', {}, `Diagramm ${di + 1}`),
    button(null, { variant: 'ghost', size: 'icon', icon: 'arrow-up', title: 'Nach oben', disabled: di === 0, onClick: () => move(di - 1) }),
    button(null, {
      variant: 'ghost', size: 'icon', icon: 'arrow-down', title: 'Nach unten', disabled: di === state.diagrams.length - 1, onClick: () => move(di + 1),
    }),
    button(null, { variant: 'ghost', size: 'icon', icon: 'copy', title: 'Duplizieren', onClick: duplicate }),
    button(null, { variant: 'ghost', size: 'icon', icon: 'trash', title: 'Löschen', onClick: remove }),
  );
}

function cardFields(d, redraw) {
  const input = (value, onInput, attrs = {}) => h('input', {
    type: 'text', className: 'input', value, spellcheck: false, oninput: (e) => { onInput(e.target.value); redraw(); }, ...attrs,
  });
  return [
    ...row('Name', input(d.name, (v) => { d.name = v; }, { className: 'input input--name', ariaLabel: 'Funktionsname' })),
    ...row('Variablen',
      h('div', { className: 'inline' },
        segmented('Anzahl Variablen', ['2', '3', '4'], String(d.vars.length), (n) => {
          setVarCount(d, Number(n));
          update();
        }),
        ...d.vars.map((name, i) => input(name, (v) => { d.vars[i] = v; }, {
          className: 'input input--var', ariaLabel: `Variable ${i + 1} von ${d.vars.length}`,
        }))),
      h('p', { className: 'hint' }, 'MSB → LSB, als LaTeX gesetzt, z. B. x_1 oder \\overline{y}.')),
  ];
}

function cardGroups(d, card, activeGroup, redraw) {
  const items = d.groups.map((g, gi) => {
    const active = g === activeGroup;
    const item = h('li', { className: active ? 'group active' : 'group' },
      h('div', { className: 'group-row' },
        h('span', { className: 'dot' }),
        h('span', { className: 'info' }, `Gruppe ${gi + 1}`),
        button(null, {
          variant: 'ghost',
          size: 'icon',
          icon: active ? 'check' : 'pencil',
          title: active ? 'Fertig' : 'Bearbeiten',
          onClick: () => { editing = active ? null : { diagram: d, group: g }; renderAll(); },
        }),
        button(null, {
          variant: 'ghost',
          size: 'icon',
          icon: 'x',
          title: 'Gruppe löschen',
          onClick: () => {
            d.groups.splice(gi, 1);
            if (active) editing = null;
            update();
          },
        })));
    item.style.setProperty('--group', g.color);
    if (active) item.append(groupEditor(g, item, card, redraw));
    return item;
  });

  const add = () => {
    const group = { color: nextColor(d), cells: [] };
    d.groups.push(group);
    editing = { diagram: d, group };
    update();
  };
  return row('Gruppen',
    items.length ? h('ul', { className: 'groups' }, ...items) : null,
    button('Gruppe', { icon: 'plus', onClick: add }));
}

// Farbauswahl der aktiven Gruppe: feste Palette plus eigene Farbe (letztes Feld).
function groupEditor(g, item, card, redraw) {
  const custom = !PALETTE.includes(g.color);
  const picker = h('label', { className: custom ? 'swatch selected' : 'swatch', title: 'Eigene Farbe' },
    custom ? null : icon('plus', 12),
    h('input', {
      type: 'color',
      value: g.color,
      ariaLabel: 'Eigene Farbe',
      oninput: (e) => {
        g.color = e.target.value;
        item.style.setProperty('--group', g.color);
        card.style.setProperty('--group', g.color);
        redraw();
      },
      onchange: update,
    }));
  if (custom) picker.style.background = g.color;
  return h('div', { className: 'form-cell group-editor' },
    h('div', { className: 'swatches' }, ...PALETTE.map((color) => {
      const swatch = h('button', {
        type: 'button',
        className: color === g.color ? 'swatch selected' : 'swatch',
        title: color,
        onclick: () => { g.color = color; update(); },
      });
      swatch.style.background = color;
      return swatch;
    }), picker),
    h('p', { className: 'hint' }, 'Zellen im Diagramm anklicken, um sie hinzuzufügen oder zu entfernen. Esc beendet.'));
}

function cardExport(d) {
  const svg = () => renderDiagramSVG(d, state.settings);
  return row('Export', buttonGroup(
    button('SVG', { onClick: () => exportSvg(svg(), fileName(d, 'svg')) }),
    button('PNG', { onClick: () => exportPng(svg(), fileName(d, 'png')) }),
  ));
}

// ---------- Kopfleiste ----------

for (const node of document.querySelectorAll('[data-icon]')) node.prepend(icon(node.dataset.icon));

document.getElementById('add').addEventListener('click', () => {
  state.diagrams.push(defaultDiagram());
  update();
  list.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

for (const radio of document.querySelectorAll('input[name="labelStyle"]')) {
  radio.addEventListener('change', () => {
    state.settings.labelStyle = radio.value;
    update();
  });
}

document.getElementById('showIndex').addEventListener('change', (e) => {
  state.settings.showIndex = e.target.checked;
  update();
});

document.getElementById('allSvg').addEventListener('click', () => exportSvg(renderAllSVG(), 'kv-diagramme.svg'));
document.getElementById('allPng').addEventListener('click', () => exportPng(renderAllSVG(), 'kv-diagramme.png'));

document.getElementById('exportJson').addEventListener('click', () => {
  download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), 'kv-diagramme.json');
});

document.getElementById('importJson').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  try {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error('Die Datei enthält kein gültiges JSON.');
    }
    const next = normalize(data);
    if (state.diagrams.some(hasContent) && !confirm('Aktuelle Diagramme durch die importierte Datei ersetzen?')) return;
    state = next;
    editing = null;
    update();
    notify(`${next.diagrams.length} ${next.diagrams.length === 1 ? 'Diagramm' : 'Diagramme'} importiert.`);
  } catch (err) {
    notify(`Import fehlgeschlagen: ${err.message}`, true);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && editing) {
    editing = null;
    renderAll();
  }
});

renderAll();
// Sobald MathJax geladen ist, Beschriftungen als LaTeX neu setzen (bis dahin bzw. offline: einfache Ersatzdarstellung).
window.MathJax?.startup?.promise?.then(renderAll);
