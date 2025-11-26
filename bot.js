require("dotenv").config();
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

// ------------------ VERIFICACIÓN DEL TOKEN ------------------
const TOKEN = process.env.TELEGRAM_TOKEN;
console.log("TOKEN CARGADO:", TOKEN);

const bot = new TelegramBot(TOKEN, { polling: true });

bot.on("polling_error", (err) => console.log("ERROR POLLING:", err));
bot.on("message", (msg) => console.log("Mensaje recibido:", msg.text));

// ------------------ CONFIGURACIÓN DE CARPETAS ------------------
const RUTA_GENERADOS = path.join(__dirname, "generados");
const RUTA_LIBRO_ROJO = path.join(__dirname, "libro_rojo");

if (!fs.existsSync(RUTA_GENERADOS)) fs.mkdirSync(RUTA_GENERADOS);
if (!fs.existsSync(RUTA_LIBRO_ROJO)) fs.mkdirSync(RUTA_LIBRO_ROJO);

// Carga todos los archivos JSON en una carpeta sin subcarpetas
function cargarTestsDeCarpeta(rutaCarpeta) {
  let tests = {};
  if (!fs.existsSync(rutaCarpeta)) return tests;

  const archivos = fs.readdirSync(rutaCarpeta).filter(f => f.endsWith(".json"));
  archivos.forEach((nombre) => {
    const contenido = JSON.parse(fs.readFileSync(path.join(rutaCarpeta, nombre), "utf8"));
    const clave = nombre.replace(".json", "");
    tests[clave] = Array.isArray(contenido)
      ? { tema: clave, fecha: new Date().toISOString(), feedback: "", preguntas: contenido }
      : contenido;
  });
  return tests;
}

// Listar SOLO subcarpetas (por tema)
function listarCarpetas(rutaCarpeta) {
  if (!fs.existsSync(rutaCarpeta)) return [];
  return fs.readdirSync(rutaCarpeta).filter(nombre =>
    fs.lstatSync(path.join(rutaCarpeta, nombre)).isDirectory()
  );
}

const TESTS_GENERADOS = cargarTestsDeCarpeta(RUTA_GENERADOS); // tests sueltos
let TESTS = { ...TESTS_GENERADOS }; // tests globales almacenados después

let usuarios = {}; // Estado de cada usuario

// ------------------ MENÚ PRINCIPAL ------------------
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, `🔥 Bienvenido al test interactivo

Selecciona una categoría:`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📂 Generados", callback_data: "grupo:generados" }],
        [{ text: "📕 Libro Rojo", callback_data: "grupo:libro_rojo" }],
      ],
    },
  });
});

// ------------------ FUNCIONES AUXILIARES ------------------
function formatearOpciones(p, seleccion = null, correcta = null) {
  let out = "";
  for (const [clave, texto] of Object.entries(p.opciones)) {
    let marcador = "";
    if (seleccion !== null) {
      if (clave === seleccion && clave === correcta) marcador = "  🟢";
      else if (seleccion === clave && clave !== correcta) marcador = "  🔴";
      else if (clave === correcta) marcador = "  🟢";
    }
    out += `${clave}) ${texto}${marcador}\n`;
  }
  return out;
}

function enviarPregunta(chatId) {
  const estado = usuarios[chatId];
  if (!estado) return;

  const preguntas = TESTS[estado.tema].preguntas;
  const i = estado.indice;

  // Si se acabaron las preguntas
  if (i >= preguntas.length) {
    return bot.sendMessage(
      chatId,
      `🏁 <b>TEST FINALIZADO (${estado.tema})</b>\n\nAciertos: <b>${estado.aciertos}/${preguntas.length}</b>\n\n🎯 ¡Buen trabajo!`,
      { parse_mode: "HTML" }
    );
  }

  const p = preguntas[i];
  const opcionesTexto = formatearOpciones(p);

  const texto = `<b>Pregunta ${i + 1}/${preguntas.length}</b>
━━━━━━━━━━━━━━━━━━
${p.pregunta}

${opcionesTexto}
Selecciona una opción ⬇️`;

  // Botones dinámicos (A/B/C o A/B/C/D)
  const botones = Object.keys(p.opciones).map((clave) => ({
    text: clave,
    callback_data: clave,
  }));

  bot.sendMessage(chatId, texto, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [botones] },
  });
}

// ------------------ CALLBACKS ------------------
bot.on("callback_query", (cb) => {
  bot.answerCallbackQuery(cb.id);
  const chatId = cb.message.chat.id;
  const data = cb.data;

  // 1. ELECCIÓN DE TIPO DE TEST
  if (data.startsWith("grupo:")) {
    const grupo = data.split(":")[1];

    // LIBRO ROJO ➔ listar carpetas
    if (grupo === "libro_rojo") {
      const carpetas = listarCarpetas(RUTA_LIBRO_ROJO);
      if (!carpetas.length) return bot.sendMessage(chatId, "⚠️ No hay temas aún en libro_rojo.");

      const botonesCarpetas = carpetas.map((carpeta) => [
        { text: carpeta.toUpperCase(), callback_data: `subtema:${carpeta}` }
      ]);

      return bot.editMessageText(
        `📕 LIBRO ROJO\n\nSelecciona un tema:`,
        {
          chat_id: chatId,
          message_id: cb.message.message_id,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: botonesCarpetas }
        }
      );
    }

    // GENERADOS ➔ mostrar tests directamente
    if (grupo === "generados") {
      const claves = Object.keys(TESTS_GENERADOS);
      if (!claves.length) return bot.sendMessage(chatId, "⚠️ No hay tests en generados.");

      const botones = claves.map((t) => [{ text: t, callback_data: `tema:${t}` }]);
      return bot.editMessageText(
        `📂 GENERADOS\n\nSelecciona un test:`,
        {
          chat_id: chatId,
          message_id: cb.message.message_id,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: botones }
        }
      );
    }
  }

  // 2. ELECCIÓN DE SUBTEMA (carpeta)
  if (data.startsWith("subtema:")) {
    const carpeta = data.split(":")[1];
    const rutaSub = path.join(RUTA_LIBRO_ROJO, carpeta);

    const archivos = fs.readdirSync(rutaSub).filter(f => f.endsWith(".json"));
    if (!archivos.length) return bot.sendMessage(chatId, "⚠️ No hay tests en esta carpeta.");

    const botonesTests = archivos.map((file) => [
      { text: file.replace(".json", ""), callback_data: `tema:${file.replace(".json", "")}` }
    ]);

    // CARGA SOLO LOS TESTS DE ESTA CARPETA EN TESTS
    archivos.forEach((file) => {
      const contenido = JSON.parse(fs.readFileSync(path.join(rutaSub, file), "utf8"));
      TESTS[file.replace(".json", "")] = contenido;
    });

    return bot.editMessageText(
      `📘 Tema: <b>${carpeta.toUpperCase()}</b>\n\nSelecciona un test:`,
      {
        chat_id: chatId,
        message_id: cb.message.message_id,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: botonesTests }
      }
    );
  }

  // 3. INICIAR TEST SELECCIONADO
  if (data.startsWith("tema:")) {
    const temaId = data.split(":")[1];
    if (!TESTS[temaId]) return bot.sendMessage(chatId, "⚠️ Tema no disponible.");

    usuarios[chatId] = { tema: temaId, indice: 0, aciertos: 0 };
    bot.editMessageText(`Has seleccionado: <b>${temaId}</b>\n\nComenzamos 🧠`, {
      chat_id: chatId,
      message_id: cb.message.message_id,
      parse_mode: "HTML",
    });
    return enviarPregunta(chatId);
  }

  // 4. RESPUESTA DE UNA PREGUNTA
  const estado = usuarios[chatId];
  if (!estado) return bot.sendMessage(chatId, "⚠️ Escribe /start para comenzar.");

  const preguntas = TESTS[estado.tema].preguntas;
  const i = estado.indice;
  const p = preguntas[i];
  const correcta = p.correcta;
  const seleccion = data;

  if (seleccion === correcta) estado.aciertos++;

  const opcionesMarcadas = formatearOpciones(p, seleccion, correcta);

  bot.editMessageText(`<b>Pregunta ${i + 1}/${preguntas.length}</b>
━━━━━━━━━━━━━━━━━━
${p.pregunta}

${opcionesMarcadas}
<b>Resultado:</b> ${seleccion === correcta ? "🟢 Correcto" : "🔴 Incorrecto"}`, {
    chat_id: chatId,
    message_id: cb.message.message_id,
    parse_mode: "HTML",
  });

  estado.indice++;
  setTimeout(() => enviarPregunta(chatId), 900);
});
