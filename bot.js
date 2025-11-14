require("dotenv").config();
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");

const TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

// Log de errores reales
bot.on("polling_error", (err) => console.log("ERROR POLLING:", err));

/**
 * MAPA DE TESTS POR TEMA
 * Aquí puedes ir añadiendo más temas en el futuro
 * Ejemplo:
 *  "TEMA-2": JSON.parse(fs.readFileSync("test_tema2.json", "utf8"))
 */
const TESTS = {
  "TEMA-1": JSON.parse(fs.readFileSync("test_tema1.json", "utf8")),
  "TEMA-5": JSON.parse(fs.readFileSync("test_tema5.json", "utf8")),
  "TEMA-8": JSON.parse(fs.readFileSync("test_tema8.json", "utf8")),

  // "TEMA-2": JSON.parse(fs.readFileSync("test_tema2.json", "utf8")),
  
};

let usuarios = {};

// -------------------------------------------------------------------
//  /start → mostrar menú de temas
// -------------------------------------------------------------------
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  const botonesTemas = Object.keys(TESTS).map((tema) => [
    {
      text: tema,                // texto del botón
      callback_data: `tema:${tema}`, // identificador para el callback
    },
  ]);

  const texto =
`Bienvenido al test 🔥

Selecciona el tema que quieres practicar:`;

  bot.sendMessage(chatId, texto, {
    reply_markup: {
      inline_keyboard: botonesTemas,
    },
  });
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
//  ENVIAR PREGUNTA
// -------------------------------------------------------------------
function enviarPregunta(chatId) {
  const estado = usuarios[chatId];
  if (!estado) return; // protección extra

  const preguntas = TESTS[estado.tema].preguntas;
  const i = estado.indice;

  if (i >= preguntas.length) {
    return bot.sendMessage(
      chatId,
      `🏁 <b>TEST FINALIZADO (${estado.tema})</b>\n\nAciertos: <b>${estado.aciertos}/${preguntas.length}</b>\n\n🎯 ¡Buen trabajo!`,
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
          { text: "C", callback_data: "C" },
        ],
      ],
    },
  });
}

// -------------------------------------------------------------------
//  GESTIÓN DE TODOS LOS BOTONES (temas + respuestas)
// -------------------------------------------------------------------
bot.on("callback_query", (cb) => {
  bot.answerCallbackQuery(cb.id);

  const chatId = cb.message.chat.id;
  const data = cb.data;

  // 1) Si el callback es de selección de tema
  if (data.startsWith("tema:")) {
    const tema = data.split(":")[1];

    if (!TESTS[tema]) {
      return bot.sendMessage(chatId, "⚠️ Tema no disponible.");
    }

    // Inicializamos estado del usuario para ese tema
    usuarios[chatId] = {
      tema,
      indice: 0,
      aciertos: 0,
    };

    // Editamos el mensaje del menú para que no queden botones antiguos
    bot.editMessageText(
      `Has seleccionado: <b>${tema}</b>\n\nEmpezamos el test ✅`,
      {
        chat_id: chatId,
        message_id: cb.message.message_id,
        parse_mode: "HTML",
      }
    );

    // Lanzamos la primera pregunta
    return enviarPregunta(chatId);
  }

  // 2) Si el callback es una respuesta (A, B, C)
  const seleccion = data;

  if (!usuarios[chatId]) {
    return bot.sendMessage(chatId, "⚠️ Debes iniciar el test con /start");
  }

  const estado = usuarios[chatId];
  const preguntas = TESTS[estado.tema].preguntas;
  const i = estado.indice;
  const p = preguntas[i];
  const correcta = p.correcta;

  if (seleccion === correcta) estado.aciertos++;

  const opcionesMarcadas = formatearOpciones(p, seleccion, correcta);

  const texto =
`<b>Pregunta ${i + 1}/${preguntas.length} — ${estado.tema}</b>
━━━━━━━━━━━━━━━━━━
${p.pregunta}

${opcionesMarcadas}
<b>Resultado:</b> ${seleccion === correcta ? "🟢 Correcto" : "🔴 Incorrecto"}`;

  bot.editMessageText(texto, {
    chat_id: chatId,
    message_id: cb.message.message_id,
    parse_mode: "HTML",
  });

  estado.indice++;

  setTimeout(() => enviarPregunta(chatId), 800);
});
