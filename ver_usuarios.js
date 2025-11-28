const db = require("./db");

console.log("📊 Leyendo usuarios de la base de datos...\n");

// Esperar a que la base de datos esté lista
setTimeout(() => {
  db.all("SELECT * FROM usuarios", (err, filas) => {
    if (err) {
      console.error("❌ Error al leer usuarios:", err);
    } else {
      if (!filas || filas.length === 0) {
        console.log("⚠️  No hay usuarios registrados aún.");
      } else {
        console.log(`✅ Total de usuarios: ${filas.length}\n`);
        console.table(filas);
      }
    }
    // Cerrar conexión correctamente
    db.close((err) => {
      if (err) console.error("❌ Error cerrando DB:", err);
      else console.log("\n✅ Conexión cerrada.");
    });
  });
}, 1000);
