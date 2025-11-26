const db = require("./db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS fallos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId TEXT,
      tema TEXT,
      pregunta TEXT,
      correcta TEXT,
      respuesta TEXT,   -- lo que respondió el usuario
      fecha TEXT
    );
  `, (err) => {
    if (err) console.error("❌ Error creando tabla fallos:", err);
    else console.log("✔ Tabla 'fallos' creada");
  });
});

db.close();
