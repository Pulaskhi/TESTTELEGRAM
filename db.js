// db.js
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// 📂 Ruta segura a la base de datos
const db = new sqlite3.Database(
  path.join(__dirname, "data", "bot.db"),
  (err) => {
    if (err) console.error("❌ Error conectando a la base de datos", err);
    else console.log("📦 BBDD conectada");
  }
);

// ⚙️ MODO PRO: evita bloqueos (SQLITE_BUSY)
db.run("PRAGMA journal_mode = WAL");     // Permite lecturas/escrituras simultáneas
db.run("PRAGMA busy_timeout = 3000");    // Espera 3s si está ocupada antes de fallar

// 🧱 Crear tablas si NO existen
db.serialize(() => {

  // Tabla de usuarios
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      chatId TEXT PRIMARY KEY,
      nombre TEXT,
      autorizado INTEGER DEFAULT 0,
      tests INTEGER DEFAULT 0,
      aciertos INTEGER DEFAULT 0,
      fallos INTEGER DEFAULT 0
    );
  `);

  // Tabla de resultados individuales
  db.run(`
    CREATE TABLE IF NOT EXISTS resultados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId TEXT,
      tema TEXT,
      aciertos INTEGER,
      fallos INTEGER,
      total INTEGER,
      fecha TEXT
    );
  `);

  // Tabla de estadísticas por pregunta (puntos débiles)
  db.run(`
    CREATE TABLE IF NOT EXISTS fallo_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId TEXT,
      tema TEXT,
      pregunta TEXT,
      veces_fallada INTEGER DEFAULT 1,
      UNIQUE (chatId, pregunta)  -- ⬅ Evita duplicados
    );
  `);
});

module.exports = db;
