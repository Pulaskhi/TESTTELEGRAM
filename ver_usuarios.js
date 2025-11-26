const db = require("./db");

db.all("SELECT * FROM usuarios", (err, filas) => {
  if (err) {
    console.error("Error al leer usuarios:", err);
  } else {
    console.log("USUARIOS EN BBDD:");
    console.log(filas);
  }
  db.close();
});
