const db = require("./db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS resultados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId TEXT,
      tema TEXT,
      aciertos INTEGER,
      fallos INTEGER,
      fecha TEXT
    )
  `, (err) => {
    if (err) console.error("ERROR creando tabla resultados:", err);
    else console.log("Tabla 'resultados' creada o ya existe.");
  });
});

db.close();
