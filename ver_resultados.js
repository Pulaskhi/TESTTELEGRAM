// ver_resultados.js
const db = require("./db");

console.log("📦 BBDD conectada");
db.all("SELECT * FROM resultados", (err, filas) => {
  if (err) {
    console.error("❌ ERROR al leer resultados:", err.message);
  } else {
    console.log("📊 HISTORIAL DE TESTS:");
    console.log(filas);
  }
  db.close();
});
