// migrar_fallo_stats.js
const db = require("./db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS fallo_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId TEXT,
      tema TEXT,
      pregunta TEXT,
      veces_fallada INTEGER DEFAULT 1
    )
  `, (err) => {
    if (err) console.error("❌ Error creando tabla fallo_stats:", err);
    else console.log("✔ Tabla 'fallo_stats' creada o ya existe.");
  });
});

db.close();
