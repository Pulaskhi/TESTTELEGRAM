require("dotenv").config();
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");

const TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

// Log de errores reales
bot.on("polling_error", (err) => console.log("ERROR POLLING:", err));

// Cargar test
const data = JSON.parse(fs.readFileSync("test_tema1.json", "utf8"));
const preguntas = data.preguntas;

let usuarios = {};

// -------------------------------------------------------------------
//  INICIO
// -------------------------------------------------------------------
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  usuarios[chatId] = {
    indice: 0,
    aciertos: 0,
  };

  enviarPregunta(chatId);
});

// -------------------------------------------------------------------
//  FORMATEO DE OPCIONES (solo colores, sin textos extra)
// -------------------------------------------------------------------
function formatearOpciones(p, seleccion = null, correcta = null) {
  let out = "";

  for (const [clave, texto] of Object.entries(p.opciones)) {
    let marcador = "";

    if (seleccion !== null) {
      if (clave === seleccion && clave === correcta) {
        // Elegida y correcta → verde
        marcador = "  🟢";
      } else if (clave === seleccion && clave !== correcta) {
        // Elegida y incorrecta → rojo
        marcador = "  🔴";
      } else if (clave === correcta) {
        // No elegida pero correcta → verde
        marcador = "  🟢";
      }
    }

    out += `${clave}) ${texto}${marcador}\n`;
  }

  return out;
}

// -------------------------------------------------------------------
//  ENVÍO DE PREGUNTA
// -------------------------------------------------------------------
function enviarPregunta(chatId) {
  if (!usuarios[chatId]) return;

  const estado = usuarios[chatId];
  const i = estado.indice;

  if (i >= preguntas.length) {
    return bot.sendMessage(
      chatId,
      `🏁 <b>TEST FINALIZADO</b>\n\nAciertos: <b>${estado.aciertos}/${preguntas.length}</b>\n\n🎯 ¡Buen trabajo!`,
      { parse_mode: "HTML" }
    );
  }

  const p = preguntas[i];
  const opciones = formatearOpciones(p);

  const texto =
`<b>Pregunta ${i + 1}/${preguntas.length}</b>
━━━━━━━━━━━━━━━━━━
${p.pregunta}

${opciones}
Selecciona una opción ⬇️`;

  bot.sendMessage(chatId, texto, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "A", callback_data: "A" },
          { text: "B", callback_data: "B" },
          { text: "C", callback_data: "C" }
        ]
      ]
    }
  });
}

// -------------------------------------------------------------------
//  RESPUESTA DEL USUARIO
// -------------------------------------------------------------------
bot.on("callback_query", (cb) => {
  bot.answerCallbackQuery(cb.id);

  const chatId = cb.message.chat.id;
  const seleccion = cb.data;

  // Si no hay estado, no rompemos
  if (!usuarios[chatId]) {
    return bot.sendMessage(chatId, "⚠️ Debes iniciar el test con /start");
  }

  const estado = usuarios[chatId];
  const i = estado.indice;
  const p = preguntas[i];
  const correcta = p.correcta;

  if (seleccion === correcta) estado.aciertos++;

  const opcionesMarcadas = formatearOpciones(p, seleccion, correcta);

  const texto =
`<b>Pregunta ${i + 1}/${preguntas.length}</b>
━━━━━━━━━━━━━━━━━━
${p.pregunta}

${opcionesMarcadas}
<b>Resultado:</b> ${seleccion === correcta ? "🟢 Correcto" : "🔴 Incorrecto"}`;

  bot.editMessageText(texto, {
    chat_id: chatId,
    message_id: cb.message.message_id,
    parse_mode: "HTML"
  });

  estado.indice++;

  setTimeout(() => enviarPregunta(chatId), 800);
});
