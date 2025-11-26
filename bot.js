require("dotenv").config();
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const db = require("./db"); // BBDD

// ============================================================
// 📌 CONFIGURACIÓN INICIAL
// ============================================================
const TOKEN = process.env.TELEGRAM_TOKEN;
console.log("TOKEN CARGADO:", TOKEN);
const bot = new TelegramBot(TOKEN, { polling: true });

const CODIGO_ACCESO = "camagrok";

const RUTA_GENERADOS = path.join(__dirname, "generados");
const RUTA_LIBRO_ROJO = path.join(__dirname, "libro_rojo");
if (!fs.existsSync(RUTA_GENERADOS)) fs.mkdirSync(RUTA_GENERADOS);
if (!fs.existsSync(RUTA_LIBRO_ROJO)) fs.mkdirSync(RUTA_LIBRO_ROJO);

let TESTS = {};
let usuarios = {};

// ============================================================
// 📂 CARGA DE TESTS
// ============================================================
function cargarTestsDeCarpeta(rutaCarpeta) {
  let tests = {};
  if (!fs.existsSync(rutaCarpeta)) return tests;
  const archivos = fs.readdirSync(rutaCarpeta).filter(f => f.endsWith(".json"));

  archivos.forEach((nombre) => {
    const contenido = JSON.parse(fs.readFileSync(path.join(rutaCarpeta, nombre), "utf8"));
    const clave = nombre.replace(".json", "");
    tests[clave] = Array.isArray(contenido)
      ? { tema: clave, preguntas: contenido }
      : contenido;
  });
  return tests;
}

TESTS = cargarTestsDeCarpeta(RUTA_GENERADOS);

function listarCarpetas(ruta) {
  return fs.readdirSync(ruta).filter(n => fs.lstatSync(path.join(ruta, n)).isDirectory());
}

// ============================================================
// 🧾 MENÚ PRINCIPAL
// ============================================================
function mostrarMenu(chatId, nombre) {
  bot.sendMessage(chatId, `🔥 Bienvenido, <b>${nombre}</b>

Selecciona una categoría:`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📂 Generados", callback_data: "grupo:generados" }],
        [{ text: "📕 Libro Rojo", callback_data: "grupo:libro_rojo" }],
        [{ text: "📊 Mis estadísticas", callback_data: "stats" }],
        [{ text: "🧠 Mis puntos débiles", callback_data: "debiles" }]
      ]
    }
  });
}

// ============================================================
// 🔐 LOGIN & REGISTRO
// ============================================================
bot.onText(/\/logout/, (msg) => {
  const chatId = msg.chat.id;
  db.run("DELETE FROM usuarios WHERE chatId = ?", [chatId], () => {
    delete usuarios[chatId];
    bot.sendMessage(chatId, "🔄 Registro eliminado. Escribe /start para registrarte otra vez.");
  });
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  db.get("SELECT * FROM usuarios WHERE chatId = ?", [chatId], (err, row) => {
    if (!row) return bot.sendMessage(chatId, "🔐 Bienvenido. Escribe la clave de acceso:");
    if (!row.nombre) return bot.sendMessage(chatId, "📝 ¿Cómo te llamas?");
    mostrarMenu(chatId, row.nombre);
  });
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const texto = (msg.text || "").trim();
  if (!texto || texto.startsWith("/")) return;

  db.get("SELECT * FROM usuarios WHERE chatId = ?", [chatId], (err, row) => {
    if (!row) {
      if (texto === CODIGO_ACCESO) {
        db.run("INSERT INTO usuarios (chatId, autorizado) VALUES (?, 1)", [chatId]);
        bot.sendMessage(chatId, "🔓 Acceso correcto. ¿Cómo te llamas?");
      } else bot.sendMessage(chatId, "❌ Clave incorrecta.");
      return;
    }
    if (!row.nombre) {
      db.run("UPDATE usuarios SET nombre = ? WHERE chatId = ?", [texto, chatId]);
      bot.sendMessage(chatId, `👋 Perfecto, ${texto}. Escribe /start`);
    }
  });
});

// ============================================================
// 📌 FORMATEAR PREGUNTAS
// ============================================================
function formatearOpciones(p, sel = null, correcta = null) {
  let out = "";
  for (const [k, t] of Object.entries(p.opciones)) {
    let marca = "";
    if (sel !== null) {
      if (k === sel && k === correcta) marca = " 🟢";
      else if (k === sel) marca = " 🔴";
      else if (k === correcta) marca = " 🟢";
    }
    out += `${k}) ${t}${marca}\n`;
  }
  return out;
}

// ============================================================
// 💾 GUARDAR RESULTADOS
// ============================================================
function guardarResultados(chatId, estado) {
  const numFallos = estado.fallos.length;

  db.run(`
    UPDATE usuarios 
    SET tests = tests + 1, aciertos = aciertos + ?, fallos = fallos + ?
    WHERE chatId = ?
  `, [estado.aciertos, numFallos, chatId]);

  db.run(`
    INSERT INTO resultados (chatId, tema, aciertos, fallos, fecha)
    VALUES (?, ?, ?, ?, ?)
  `, [chatId, estado.tema, estado.aciertos, numFallos, new Date().toISOString()]);

  estado.fallos.forEach((p) => {
    db.get(`SELECT id, veces_fallada FROM fallo_stats WHERE chatId = ? AND pregunta = ?`,
      [chatId, p.pregunta],
      (err, row) => {
        if (!row) {
          db.run(
            `INSERT INTO fallo_stats (chatId, tema, pregunta, veces_fallada)
            VALUES (?, ?, ?, 1)`,
            [chatId, estado.tema, p.pregunta]
          );
        } else {
          db.run(`UPDATE fallo_stats SET veces_fallada = veces_fallada + 1 WHERE id = ?`,
            [row.id]);
        }
      });
  });
}

// ============================================================
// 📌 ENVIAR PREGUNTA
// ============================================================
function enviarPregunta(chatId) {
  const estado = usuarios[chatId];
  const preguntas = estado.preguntas || TESTS[estado.tema].preguntas;
  const i = estado.indice;

  if (i >= preguntas.length) {
    guardarResultados(chatId, estado);

    if (estado.fallos.length > 0) {
      return bot.sendMessage(chatId, `🏁 TEST ACABADO\nAciertos: ${estado.aciertos}/${preguntas.length}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔁 Repetir fallos", callback_data: "retest" }],
            [{ text: "🏁 Terminar", callback_data: "finish" }]
          ]
        }
      });
    }
    return bot.sendMessage(chatId, "🎉 ¡Buen trabajo!");
  }

  const p = preguntas[i];
  bot.sendMessage(chatId, `
<b>Pregunta ${i + 1}/${preguntas.length}</b>
━━━━━━━━━━━━
${p.pregunta}

${formatearOpciones(p)}
`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        Object.keys(p.opciones).map(k => ({ text: k, callback_data: k }))
      ]
    }
  });
}

// ============================================================
// 🧠 CONSULTA FALLAS
// ============================================================
function consultaFallos(chatId, nivel, isBoss = false) {
  const query = isBoss
    ? `SELECT * FROM fallo_stats WHERE chatId = ? AND veces_fallada >= ? ORDER BY veces_fallada DESC`
    : `SELECT * FROM fallo_stats WHERE chatId = ? AND veces_fallada = ?`;

  db.all(query, [chatId, nivel], (err, rows) => {
    if (!rows || !rows.length) {
      return bot.sendMessage(chatId, "👏 No hay fallos en ese nivel.");
    }

    const lista = rows.map(r => `⚔ ${r.pregunta} → ${r.veces_fallada} fallos`).join("\n\n");
    bot.sendMessage(chatId, `📌<b>FALLOS NIVEL ${nivel}${isBoss ? "+" : ""}</b>\n━━━━━━━━━\n${lista}`,
      { parse_mode: "HTML" });
  });
}

// ============================================================
// ❓ CALLBACKS
// ============================================================
bot.on("callback_query", (cb) => {
  const chatId = cb.message.chat.id;
  const data = cb.data;
  const estado = usuarios[chatId];
  bot.answerCallbackQuery(cb.id);

  if (data === "stats") {
    return db.get("SELECT * FROM usuarios WHERE chatId = ?", [chatId], (err, row) => {
      const tot = row.aciertos + row.fallos;
      const pct = tot > 0 ? ((row.aciertos / tot) * 100).toFixed(1) : 0;
      bot.sendMessage(chatId, `
📊 <b>${row.nombre}</b>
Tests: ${row.tests}
Aciertos: ${row.aciertos}
Fallos: ${row.fallos}
Efectividad: ${pct}%`, { parse_mode: "HTML" });
    });
  }

  if (data === "debiles") {
    return bot.sendMessage(chatId, "🧠 ¿Qué quieres ver?", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📘 Fallos leves (1 vez)", callback_data: "weak1" }],
          [{ text: "⚠ Fallos repetidos (2 veces)", callback_data: "weak2" }],
          [{ text: "😈 Enemigos (3+ veces)", callback_data: "boss" }]
        ]
      }
    });
  }

  if (data === "weak1") return consultaFallos(chatId, 1);
  if (data === "weak2") return consultaFallos(chatId, 2);
  if (data === "boss") return consultaFallos(chatId, 3, true);

  if (data === "finish") {
    delete usuarios[chatId];
    return bot.sendMessage(chatId, "🏁 Test cerrado.");
  }

  if (data === "retest") {
    usuarios[chatId].preguntas = [...estado.fallos];
    usuarios[chatId].indice = 0;
    usuarios[chatId].fallos = [];
    usuarios[chatId].aciertos = 0;
    return enviarPregunta(chatId);
  }

  if (data.startsWith("tema:")) {
    const temaId = data.split(":")[1];
    usuarios[chatId] = { tema: temaId, indice: 0, aciertos: 0, fallos: [] };
    return enviarPregunta(chatId);
  }

  // RESPUESTA PREGUNTA
  const p = (estado?.preguntas || TESTS[estado?.tema]?.preguntas)[estado?.indice];
  if (!p) return;

  if (data === p.correcta) estado.aciertos++;
  else estado.fallos.push(p);

  bot.editMessageText(`${p.pregunta}\n\n${formatearOpciones(p, data, p.correcta)}`, {
    chat_id: chatId,
    message_id: cb.message.message_id,
    parse_mode: "HTML"
  });

  estado.indice++;
  setTimeout(() => enviarPregunta(chatId), 700);
});

console.log("🤖 BOT ACTIVADO");
