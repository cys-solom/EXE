// Convierte un array de objetos a texto CSV simple (para los botones "تصدير" del panel).
function toCsv(rows, columns) {
  const esc = v => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(c => esc(c.label)).join(",");
  const lines = rows.map(row => columns.map(c => esc(typeof c.value === "function" ? c.value(row) : row[c.value])).join(","));
  return [header, ...lines].join("\n");
}

function sendCsv(res, filename, csvText) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // BOM para que Excel detecte UTF-8 correctamente (nombres/textos en arabe).
  res.end("﻿" + csvText);
}

module.exports = { toCsv, sendCsv };
