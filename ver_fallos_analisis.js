// ver_fallos_analisis.js
const db = require("./db");

db.all(`
  SELECT chatId, tema, pregunta, veces_fallada
  FROM fallo_stats
  ORDER BY veces_fallada DESC
`, [], (err, rows) => {
  if (err) {
    console.error("❌ Error al leer 'fallo_stats':", err);
  } else {
    console.log("📉 ANALISIS DE FALLOS:");
    console.table(rows);
  }
  db.close();
});
