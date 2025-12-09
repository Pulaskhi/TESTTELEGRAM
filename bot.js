// ===========================================
// 📦 DEPENDENCIAS
// ===========================================
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const db = require("./db"); // BBDD
const versus = require("./versus");

// ===========================================
// 🧠 CONFIG INICIAL
// ===========================================
const TOKEN = process.env.TELEGRAM_TOKEN;
const CODIGO_ACCESO = "camagrok";
const bot = new TelegramBot(TOKEN, { polling: true });

// registrar comando fonético (asignar números→letras y generar palabras)
let phonetic = null;
try {
  phonetic = require("./phonetic");
  if (phonetic && phonetic.registerPhonetic) {
    phonetic.registerPhonetic(bot);
    console.log('✅ Phonetic module registered');
  }
} catch (e) {
  console.warn('⚠️ No se pudo registrar phonetic module:', e);  // Ver mensaje de error
}

const RUTA_GENERADOS = path.join(__dirname, "generados");
const RUTA_LIBRO_ROJO = path.join(__dirname, "libro_rojo");
const RUTA_FLASHCARDS = path.join(__dirname, "flashcards");

if (!fs.existsSync(RUTA_GENERADOS)) fs.mkdirSync(RUTA_GENERADOS);
if (!fs.existsSync(RUTA_LIBRO_ROJO)) fs.mkdirSync(RUTA_LIBRO_ROJO);
if (!fs.existsSync(RUTA_FLASHCARDS)) fs.mkdirSync(RUTA_FLASHCARDS);

let TESTS = {};
let usuarios = {};

// ===========================================
// 📂 CARGA TESTS
// ===========================================
function cargarTestsDeCarpeta(rutaCarpeta) {
  let tests = {};
  if (!fs.existsSync(rutaCarpeta)) return tests;
  let archivos = [];
  try {
    archivos = fs.readdirSync(rutaCarpeta).filter(f => f.endsWith(".json"));
  } catch (e) {
    console.error('ERROR leyendo carpeta de tests:', rutaCarpeta, e);
    return tests;
  }

  archivos.forEach(nombre => {
    const rutaArchivo = path.join(rutaCarpeta, nombre);
    try {
      const contenidoStr = fs.readFileSync(rutaArchivo, "utf8");
      const contenido = JSON.parse(contenidoStr);
      const clave = nombre.replace(".json", "");
      tests[clave] = Array.isArray(contenido) ? { tema: clave, preguntas: contenido } : contenido;
    } catch (e) {
      console.error('ERROR parseando o leyendo JSON:', rutaArchivo, e.message || e);
    }
  });
  return tests;
}

TESTS = { ...cargarTestsDeCarpeta(RUTA_GENERADOS) };

function listarCarpetas(ruta) {
  return fs.readdirSync(ruta).filter(n => fs.lstatSync(path.join(ruta, n)).isDirectory());
}

// ===========================================
// 📌 MENÚ PRINCIPAL
// ===========================================
function mostrarMenu(chatId, nombre) {
  // Añadir sección de tests en curso si hay archivos en test_en_curso
  let teclado = [
    [{ text: "🧪 Tests en curso", callback_data: "grupo:test_en_curso" }],
    [{ text: "📂 Generados", callback_data: "grupo:generados" }],
    [{ text: "📕 Libro Rojo", callback_data: "grupo:libro_rojo" }],
    [{ text: "📸 Flashcards", callback_data: "grupo:flashcards" }],
    [{ text: "📡 Código fonético", callback_data: "grupo:fonetico" }],
    [{ text: "📊 Mis estadísticas", callback_data: "stats" }],
    [{ text: "🧠 Mis puntos débiles", callback_data: "debiles" }]
  ];
  bot.sendMessage(chatId, `🔥 Bienvenido, <b>${nombre}</b>`, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: teclado }
  });
}
// Handler para la sección de tests en curso
bot.on("callback_query", async cb => {
  const chatId = String(cb.message.chat.id);
  const data = cb.data;
  if (data === "grupo:test_en_curso") {
    // Listar los tests en curso del usuario
    const testDir = path.join(__dirname, "test_en_curso");
    let archivos = [];
    try {
      archivos = fs.readdirSync(testDir).filter(f => f.endsWith(".json"));
    } catch (e) {
      return bot.sendMessage(chatId, "⚠️ No se pudo acceder a los tests en curso.");
    }
    // Filtrar solo los del usuario actual
    const propios = archivos.filter(f => f.startsWith(`${chatId}`));
    if (!propios.length) return bot.sendMessage(chatId, "🧪 No tienes tests en curso.");
    // Mostrar lista de tests a medias
    let botones = propios.map(f => {
      let tema = "(sin tema)";
      try {
        const test = JSON.parse(fs.readFileSync(path.join(testDir, f), "utf8"));
        tema = test.tema || tema;
      } catch (e) {}
      return [{ text: `Test: ${tema}`, callback_data: `testEnCurso:${f}` }];
    });
    bot.sendMessage(chatId, "🧪 Tests en curso:", {
      reply_markup: { inline_keyboard: botones }
    });
    return;
  }
  if (data.startsWith("testEnCurso:")) {
    // Recuperar el test seleccionado y cargarlo en memoria
    const archivo = data.split(":")[1];
    const testPath = path.join(__dirname, "test_en_curso", archivo);
    try {
      const testData = JSON.parse(fs.readFileSync(testPath, "utf8"));
      usuarios[chatId] = testData;
      bot.sendMessage(chatId, `🧪 Test cargado: <b>${testData.tema}</b>`, { parse_mode: "HTML" });
      enviarPregunta(chatId);
    } catch (e) {
      bot.sendMessage(chatId, "❌ Error cargando el test en curso.");
    }
    return;
  }
  // ...existing code...
});
// Handler para el botón de test en curso
bot.on("callback_query", async cb => {
  const chatId = String(cb.message.chat.id);
  const data = cb.data;
  if (data === "testEnCurso") {
    const estado = usuarios[chatId];
    if (!estado || estado.tipo !== "test") {
      return bot.sendMessage(chatId, "⚠️ No tienes un test en curso.");
    }
    // Mostrar opciones para continuar, finalizar o guardar
    let msg = `🧪 Test en curso: <b>${estado.tema}</b>\nPreguntas respondidas: ${estado.indice} / ${estado.preguntas.length}`;
    bot.sendMessage(chatId, msg, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶ Continuar test", callback_data: "continuarTest" }],
          [{ text: "💾 Guardar test", callback_data: "guardarTest" }],
          [{ text: "🏁 Finalizar test", callback_data: "finish" }]
        ]
      }
    });
    return;
  }
  if (data === "guardarTest") {
    const estado = usuarios[chatId];
    if (!estado || estado.tipo !== "test") return bot.sendMessage(chatId, "⚠️ No hay test para guardar.");
    // Guardar historial en la base de datos (o archivo)
    db.run("INSERT INTO test_historial (chatId, tema, aciertos, fallos, total, fecha) VALUES (?, ?, ?, ?, ?, datetime('now'))", [
      chatId,
      estado.tema,
      estado.aciertos,
      estado.fallos.length,
      estado.preguntas.length
    ], err => {
      if (err) return bot.sendMessage(chatId, `❌ Error guardando test: ${err.message}`);
      bot.sendMessage(chatId, "💾 Test guardado en historial.");
      // Eliminar test en curso y archivo
      delete usuarios[chatId];
      // Eliminar todos los archivos de test_en_curso del usuario
      const testDir = path.join(__dirname, "test_en_curso");
      try {
        fs.readdirSync(testDir).filter(f => f.startsWith(`${chatId}`) && f.endsWith('.json')).forEach(f => {
          fs.unlinkSync(path.join(testDir, f));
        });
      } catch (e) {}
    });
    return;
  }
  // ...existing code...
});

// ===========================================
// 🔐 LOGIN & REGISTRO
// ===========================================
bot.onText(/\/logout/, msg => {
  const chatId = String(msg.chat.id);
  db.run("DELETE FROM usuarios WHERE chatId = ?", [chatId], function(err) {
    if (err) {
      console.error("❌ Error eliminando usuario:", err);
      return bot.sendMessage(chatId, "❌ Error al eliminar registro.");
    }
    delete usuarios[chatId];
    console.log(`✅ Usuario ${chatId} eliminado de la BBDD`);
    bot.sendMessage(chatId, "🔄 Registro eliminado. Escribe /start para registrarte otra vez.");
  });
});

bot.onText(/\/start/, msg => {
  const chatId = String(msg.chat.id);
  db.get("SELECT * FROM usuarios WHERE chatId = ?", [chatId], (err, row) => {
    if (!row) return bot.sendMessage(chatId, "🔐 Bienvenido. Escribe la clave de acceso:");
    if (!row.nombre) return bot.sendMessage(chatId, "📝 ¿Cómo te llamas?");
    mostrarMenu(chatId, row.nombre);
  });
});

bot.on("message", msg => {
  const chatId = String(msg.chat.id);
  const texto = (msg.text || "").trim();
  if (!texto || texto.startsWith("/")) return;

  db.get("SELECT * FROM usuarios WHERE chatId = ?", [chatId], (err, row) => {
    if (!row) {
      if (texto === CODIGO_ACCESO) {
        db.run("INSERT INTO usuarios (chatId, autorizado) VALUES (?, 1)", [chatId], function(err) {
          if (err) {
            console.error("❌ Error insertando usuario:", err);
            return bot.sendMessage(chatId, "❌ Error al registrarse.");
          }
          console.log(`✅ Usuario ${chatId} registrado exitosamente en BBDD`);
          bot.sendMessage(chatId, "🔓 Acceso correcto. ¿Cómo te llamas?");
        });
      } else bot.sendMessage(chatId, "❌ Clave incorrecta.");
      return;
    }
    if (row.autorizado === 1 && !row.nombre) {
      db.run("UPDATE usuarios SET nombre = ? WHERE chatId = ?", [texto, chatId], function(err) {
        if (err) {
          console.error("❌ Error actualizando nombre:", err);
          return bot.sendMessage(chatId, "❌ Error al guardar nombre.");
        }
        console.log(`✅ Nombre '${texto}' guardado para usuario ${chatId} en BBDD`);
        bot.sendMessage(chatId, `👋 Perfecto, ${texto}. Escribe /start`);
      });
    }
    else {
      // Si el usuario ya está registrado y tiene nombre, comprobar estados interactivos
      const estado = usuarios[chatId];
      if (estado && estado.tipo === 'phonetic_setup') {
        // Tomar el texto como letra para el número actual
        const letra = texto.toUpperCase().slice(0,1);
        const numero = estado.numbersToMap[estado.nextIndex];
        db.run(`INSERT OR REPLACE INTO phonetic_mappings (chatId, numero, letra) VALUES (?, ?, ?)`, [chatId, numero, letra], (err) => {
          if (err) return bot.sendMessage(chatId, `❌ Error guardando mapping: ${err.message}`);
          estado.nextIndex++;
          if (estado.nextIndex >= estado.numbersToMap.length) {
            delete usuarios[chatId];
            return bot.sendMessage(chatId, `✅ Configuración completada. Ahora puedes usar Código fonético desde el menú (📡 Código fonético).`);
          }
          const nextNum = estado.numbersToMap[estado.nextIndex];
          return bot.sendMessage(chatId, `Introduce la letra para el número ${nextNum}:`);
        });
        return;
      }

      if (estado && estado.tipo === 'phonetic_use') {
        // Validar longitud máxima: 10 caracteres
        if (texto.length > 10) {
          return bot.sendMessage(chatId, '❌ Límite: máximo 10 caracteres. Envía una secuencia más corta (ej: 1234567890).');
        }

        // Usar la secuencia introducida
        delete usuarios[chatId];
          // attempt to reload phonetic module if missing (recover from transient require failures)
          if (!(phonetic && phonetic.generateWordsForSequence)) {
            try {
              phonetic = require("./phonetic");
              console.log('DEBUG phonetic: reloaded module on demand');
            } catch (e) {
              console.error('ERROR reloading phonetic module:', e && e.message ? e.message : e);
            }
          }
          if (phonetic && phonetic.generateWordsForSequence) {
            return phonetic.generateWordsForSequence(chatId, texto, bot);
          }
          return bot.sendMessage(chatId, '❌ Módulo fonético no disponible. Pide al administrador que revise los logs.');
      }
    }
  });
});

// ===========================================
// ⚔️ VERSUS: comandos públicos
// ===========================================
bot.onText(/\/versus/, msg => {
  const chatId = String(msg.chat.id);
  db.get("SELECT nombre FROM usuarios WHERE chatId = ?", [chatId], (err, row) => {
    if (!row || !row.nombre) {
      return bot.sendMessage(chatId, "⚠️ Primero debes estar registrado. Escribe /start");
    }
    versus.iniciarVersus(bot, chatId, row.nombre);
  });
});

bot.onText(/\/invitar (.+)/, (msg, match) => {
  const retadorId = String(msg.chat.id);
  const nombreRival = match[1].trim();
  db.get("SELECT nombre FROM usuarios WHERE chatId = ?", [retadorId], (err, row) => {
    if (!row || !row.nombre) {
      return bot.sendMessage(retadorId, "⚠️ Primero debes estar registrado. Escribe /start");
    }
    db.get("SELECT chatId FROM usuarios WHERE nombre = ?", [nombreRival], (err, rivalRow) => {
      if (!rivalRow) {
        return bot.sendMessage(retadorId, `⚠️ No encontré un usuario con nombre "${nombreRival}"`);
      }
      versus.invitar(bot, retadorId, rivalRow.chatId, row.nombre, nombreRival);
    });
  });
});

bot.onText(/\/aceptar (.+)/, (msg, match) => {
  const rivalId = String(msg.chat.id);
  const nombreRetador = match[1].trim();
  db.get("SELECT nombre FROM usuarios WHERE chatId = ?", [rivalId], (err, row) => {
    if (!row || !row.nombre) {
      return bot.sendMessage(rivalId, "⚠️ Primero debes estar registrado. Escribe /start");
    }
    db.get("SELECT chatId FROM usuarios WHERE nombre = ?", [nombreRetador], (err, retadorRow) => {
      if (!retadorRow) {
        return bot.sendMessage(rivalId, `⚠️ No encontré un usuario con nombre "${nombreRetador}"`);
      }
      versus.aceptar(bot, rivalId, retadorRow.chatId, TESTS, row.nombre, nombreRetador);
    });
  });
});

// ⚔️ DUELOS GRUPALES
bot.onText(/\/invitar_grupo (.+)/, (msg, match) => {
  const creadorId = String(msg.chat.id);
  const nombresTexto = match[1];
  // Parse: /invitar_grupo nombre1 nombre2 nombre3
  const nombresRivales = nombresTexto.split(/\s+/).map(x => x.trim()).filter(x => x);
  
  if (nombresRivales.length === 0) {
    return bot.sendMessage(creadorId, "⚠️ Uso: /invitar_grupo NOMBRE1 NOMBRE2 NOMBRE3 ...\nEjemplo: /invitar_grupo Marco Juan Pedro");
  }
  
  db.get("SELECT nombre FROM usuarios WHERE chatId = ?", [creadorId], (err, creadorRow) => {
    if (!creadorRow || !creadorRow.nombre) {
      return bot.sendMessage(creadorId, "⚠️ Primero debes estar registrado. Escribe /start");
    }
    
    // Buscar todos los usuarios por nombre
    let idsRivales = [];
    let encontrados = 0;
    
    nombresRivales.forEach((nombre, idx) => {
      db.get("SELECT chatId FROM usuarios WHERE nombre = ?", [nombre], (err, row) => {
        if (!row) {
          console.log(`⚠️ No encontrado: ${nombre}`);
        } else {
          idsRivales.push(row.chatId);
          encontrados++;
        }
        
        // Cuando procesamos todos
        if (idx === nombresRivales.length - 1) {
          setTimeout(() => {
            if (idsRivales.length === 0) {
              return bot.sendMessage(creadorId, `⚠️ No encontré ninguno de los usuarios: ${nombresRivales.join(", ")}`);
            }
            if (idsRivales.length < nombresRivales.length) {
              const noEncontrados = nombresRivales.filter(n => !idsRivales.includes(n)).join(", ");
              bot.sendMessage(creadorId, `⚠️ No encontré: ${noEncontrados}`);
            }
            
            console.log(`📢 /invitar_grupo llamado. TESTS disponibles: ${Object.keys(TESTS).length}`);
            versus.invitarGrupo(bot, creadorId, idsRivales, creadorRow.nombre, TESTS, 60000);
          }, 100);
        }
      });
    });
  });
});

bot.onText(/\/aceptar_grupo (.+)/, (msg, match) => {
  const usuarioId = String(msg.chat.id);
  const grupoId = match[1];
  
  db.get("SELECT nombre FROM usuarios WHERE chatId = ?", [usuarioId], (err, row) => {
    if (!row || !row.nombre) {
      return bot.sendMessage(usuarioId, "⚠️ Primero debes estar registrado. Escribe /start");
    }
    versus.aceptarGrupoUsuario(bot, grupoId, usuarioId, row.nombre);
  });
});

bot.onText(/\/rechazar_grupo (.+)/, (msg, match) => {
  const usuarioId = String(msg.chat.id);
  const grupoId = match[1];
  
  db.get("SELECT nombre FROM usuarios WHERE chatId = ?", [usuarioId], (err, row) => {
    if (!row || !row.nombre) {
      return bot.sendMessage(usuarioId, "⚠️ Primero debes estar registrado. Escribe /start");
    }
    versus.rechazarGrupo(bot, grupoId, usuarioId, row.nombre);
  });
});


// ===========================================
// 📌 FORMATEAR OPCIONES
// ===========================================
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

// ===========================================
// 💾 GUARDAR RESULTADOS + FALLOS
// ===========================================
function guardarResultados(chatId, estado) {
  const numFallos = estado.fallos.length;
  db.run(`
    UPDATE usuarios 
    SET tests = tests + 1,
        aciertos = aciertos + ?,
        fallos = fallos + ?
    WHERE chatId = ?
  `, [estado.aciertos, numFallos, chatId]);

  db.run(`
    INSERT INTO resultados (chatId, tema, aciertos, fallos, fecha)
    VALUES (?, ?, ?, ?, ?)
  `, [chatId, estado.tema, estado.aciertos, numFallos, new Date().toISOString()]);

  estado.fallos.forEach(p => {
    db.get(
      `SELECT id, veces_fallada FROM fallo_stats WHERE chatId = ? AND pregunta = ?`,
      [chatId, p.pregunta],
      (err, row) => {
        if (!row) {
          db.run(`INSERT INTO fallo_stats (chatId, tema, pregunta, veces_fallada) VALUES (?, ?, ?, 1)`,
            [chatId, estado.tema, p.pregunta]);
        } else {
          db.run(`UPDATE fallo_stats SET veces_fallada = veces_fallada + 1 WHERE id = ?`,
            [row.id]);
        }
      }
    );
  });
}

// ===========================================
// 📌 ENVIAR PREGUNTA
// ===========================================
function enviarPregunta(chatId) {
  const estado = usuarios[chatId];
  const preguntas = estado.preguntas;
  const i = estado.indice;

  if (i >= preguntas.length) {
    guardarResultados(chatId, estado);
    let txt = `🏁 FINALIZADO (${estado.tema})\nAciertos: ${estado.aciertos}/${preguntas.length}`;
    if (estado.fallos.length > 0) {
      return bot.sendMessage(chatId, txt, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔁 Repetir fallos", callback_data: "retest" }],
            [{ text: "🏁 Terminar", callback_data: "finish" }]
          ]
        }
      });
    }
    return bot.sendMessage(chatId, txt + "\n🎯 ¡Muy bien!");
  }

  const p = preguntas[i];
  bot.sendMessage(chatId, `
<b>Pregunta ${i + 1}/${preguntas.length}</b>
━━━━━━━━━━━
${p.pregunta}

${formatearOpciones(p)}
`, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [Object.keys(p.opciones).map(k => ({ text: k, callback_data: k }))] }
  });
}

// ===========================================
// 📸 ENVIAR FLASHCARD
// ===========================================
function enviarFlashcard(chatId) {
  const estado = usuarios[chatId];
  const t = estado.tarjetas[estado.indice];

  if (!t) {
    delete usuarios[chatId];
    return bot.sendMessage(chatId, "🎉 Flashcards completadas.");
  }

  bot.sendMessage(chatId, `
<b>${t.titulo}</b>
━━━━━━━━━━━
${t.explicacion}
<b>❓ Pregunta rápida:</b> ${t.pregunta_rapida}
<b>✔ Respuesta:</b> ${t.respuesta_corta}
`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[{ text: "➡ Siguiente", callback_data: "flash_next" }]]
    }
  });
}

// ===========================================
// 🧠 MOSTRAR FALLOS POR TEMA
// ===========================================
function mostrarFallosPorTema(chatId) {
  db.all(
    `SELECT tema, COUNT(*) as total 
     FROM fallo_stats 
     WHERE chatId = ?
     GROUP BY tema
     ORDER BY total DESC`,
    [chatId],
    (err, rows) => {
      if (!rows || !rows.length) {
        return bot.sendMessage(chatId, "👏 No tienes fallos registrados todavía.");
      }

      let respuesta = "🧠 <b>PUNTOS DÉBILES POR TEMA</b>\n━━━━━━━━━━━━━━\n";
      rows.forEach(r => respuesta += `📌 <b>${r.tema}</b> → ${r.total} fallos\n`);

      bot.sendMessage(chatId, respuesta, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: rows.map(r => [
            { text: `🔁 Repasar ${r.tema}`, callback_data: `retestTema:${r.tema}` }
          ])
        }
      });
    }
  );
}

// ===========================================
// 🚀 CALLBACK QUERY  (ORDEN CORRECTO)
// ===========================================
bot.on("callback_query", cb => {
  const chatId = String(cb.message.chat.id);
  const data = cb.data;
  console.log('DEBUG callback_query from', chatId, 'data=', data);
  bot.answerCallbackQuery(cb.id);

  // ⚔️ VERSUS
  const enDuelo = Object.keys(versus.duelos || {}).some(
    d => d === chatId || (versus.duelos[d] && String(versus.duelos[d].rivalId) === chatId)
  );
  if (enDuelo) return versus.respuestaVersus(bot, chatId, data);

  // ⚔️ DUELOS GRUPALES
  if (data.startsWith("grupo:")) {
    const partes = data.split(":");
    // solo tratar como respuesta grupal si contiene 3 partes: "grupo:<grupoId>:<respuesta>"
    if (partes.length >= 3) {
      const grupoId = partes[1];
      const respuesta = partes[2];
      return versus.respuestaGrupo(bot, chatId, grupoId, respuesta);
    }
    // si no tiene 3 partes, dejar que los handlers específicos (p.ej. grupo:generados)
    // sigan procesando el callback más abajo
  }

  // 📊 ESTADÍSTICAS
  if (data === "stats") {
    return db.get("SELECT * FROM usuarios WHERE chatId = ?", [chatId], (err, row) => {
      if (!row) return bot.sendMessage(chatId, "⚠ No estás registrado.");
      const tot = row.aciertos + row.fallos;
      const pct = tot > 0 ? ((row.aciertos / tot) * 100).toFixed(1) : 0;
      bot.sendMessage(chatId, `
📊 ESTADÍSTICAS DE <b>${row.nombre}</b>
Tests: ${row.tests}
Aciertos: ${row.aciertos}
Fallos: ${row.fallos}
Efectividad: ${pct}%`, { parse_mode: "HTML" });
    });
  }

  // 🧠 PUNTOS DÉBILES
  if (data === "debiles") {
    return mostrarFallosPorTema(chatId);
  }

  // 🔁 REPASAR TEMA DESDE PUNTOS DÉBILES
  if (data.startsWith("retestTema:")) {
    const tema = data.split(":")[1];
    db.all(`SELECT pregunta FROM fallo_stats WHERE chatId = ? AND tema = ?`, [chatId, tema], (err, rows) => {
      if (!rows || !rows.length) return bot.sendMessage(chatId, "⚠ No pude recuperar las preguntas.");
      let preguntasFalladas = [];

      for (const t in TESTS) {
        rows.forEach(r => {
          let original = TESTS[t].preguntas?.find(p => p.pregunta === r.pregunta);
          if (original) preguntasFalladas.push(original);
        });
      }

      usuarios[chatId] = {
        tipo: "retest",
        tema,
        preguntas: preguntasFalladas,
        indice: 0,
        aciertos: 0,
        fallos: []
      };
      bot.sendMessage(chatId, `📘 Repasando <b>${tema}</b> (${preguntasFalladas.length} preguntas)`, { parse_mode: "HTML" });
      return enviarPregunta(chatId);
    });
  }

  // 📂 GENERADOS
  if (data === "grupo:generados") {
    TESTS = { ...cargarTestsDeCarpeta(RUTA_GENERADOS) };
    const claves = Object.keys(TESTS);
    console.log('DEBUG grupo:generados -> found', claves.length, 'tests');
    if (!claves.length) return bot.sendMessage(chatId, "⚠️ No hay tests en /generados");
    return bot.sendMessage(chatId, "📂 Selecciona un test:", {
      reply_markup: { inline_keyboard: claves.map(t => [{ text: t, callback_data: `tema:${t}` }]) }
    });
  }

  // 📕 LIBRO ROJO
  if (data === "grupo:libro_rojo") {
    let carpetas = [];
    try {
      carpetas = listarCarpetas(RUTA_LIBRO_ROJO);
    } catch (e) {
      console.error('ERROR listing libro_rojo:', e);
      return bot.sendMessage(chatId, "❌ Error accediendo a /libro_rojo");
    }
    console.log('DEBUG grupo:libro_rojo -> carpetas=', carpetas);
    if (!carpetas.length) return bot.sendMessage(chatId, "⚠️ No hay carpetas en /libro_rojo");
    return bot.sendMessage(chatId, "📕 Selecciona un tema:", {
      reply_markup: { inline_keyboard: carpetas.map(c => [{ text: c.toUpperCase(), callback_data: `subtema:${c}` }]) }
    });
  }

  // 📕 CARGAR TESTS REALES DE LIBRO ROJO
  if (data.startsWith("subtema:")) {
    const carpeta = data.split(":")[1];
    const rutaSub = path.join(RUTA_LIBRO_ROJO, carpeta);
    if (!fs.existsSync(rutaSub)) {
      console.warn('WARN subtema ruta no existe:', rutaSub);
      return bot.sendMessage(chatId, "⚠️ No pude encontrar ese subtema en /libro_rojo");
    }

    let archivos = [];
    try {
      archivos = fs.readdirSync(rutaSub).filter(f => f.endsWith(".json"));
    } catch (e) {
      console.error('ERROR leyendo rutaSub', rutaSub, e);
      return bot.sendMessage(chatId, "❌ Error leyendo los tests del subtema");
    }

    const added = [];
    archivos.forEach(file => {
      try {
        const contenido = JSON.parse(fs.readFileSync(path.join(rutaSub, file), "utf8"));
        TESTS[file.replace(".json", "")] = Array.isArray(contenido)
          ? { tema: file.replace(".json", ""), preguntas: contenido }
          : contenido;
        added.push(file);
      } catch (e) {
        console.error('ERROR parseando JSON en', file, e);
      }
    });

    console.log('DEBUG subtema loaded files:', added);
    if (!added.length) return bot.sendMessage(chatId, `⚠️ No hay tests válidos en ${carpeta}`);

    return bot.sendMessage(chatId, `📘 Test disponibles en ${carpeta}:`, {
      reply_markup: { inline_keyboard: added.map(f => [{ text: f.replace(".json", ""), callback_data: `tema:${f.replace(".json", "")}` }]) }
    });
  }

  // 📌 FLASHCARDS (IGUAL QUE TENÍAS)
  if (data === "grupo:flashcards") {
    let carpetas = [];
    try {
      carpetas = listarCarpetas(RUTA_FLASHCARDS);
    } catch (e) {
      console.error('ERROR listing flashcards:', e);
      return bot.sendMessage(chatId, "❌ Error accediendo a /flashcards");
    }
    if (!carpetas.length) return bot.sendMessage(chatId, "⚠️ No hay flashcards disponibles");
    return bot.sendMessage(chatId, "📸 Selecciona un tema general:", {
      reply_markup: { inline_keyboard: carpetas.map(c => [{ text: c.toUpperCase(), callback_data: `flash_subtema:${c}` }]) }
    });
  }

  // 📡 CÓDIGO FONÉTICO (interactivo)
  if (data === "grupo:fonetico") {
    // comprobar mappings existentes
    db.all(`SELECT numero FROM phonetic_mappings WHERE chatId = ?`, [chatId], (err, rows) => {
      if (err) {
        console.error('ERROR leyendo phonetic_mappings', err);
        return bot.sendMessage(chatId, "❌ Error accediendo a tu configuración fonética.");
      }
      const mapped = new Set((rows || []).map(r => String(r.numero)));
      // Pedimos los números en orden 1..9, luego 0 (para que la primera pregunta sea el número 1)
      const allNumbers = ["1","2","3","4","5","6","7","8","9","0"];
      const missing = allNumbers.filter(n => !mapped.has(n));
      if (missing.length > 0) {
        usuarios[chatId] = { tipo: 'phonetic_setup', numbersToMap: missing, nextIndex: 0 };
        return bot.sendMessage(chatId, `🔧 Vamos a configurar tu código fonético.\nIntroduce la letra para el número ${missing[0]}:`);
      }

      return bot.sendMessage(chatId, `📡 Código fonético — opciones:`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔢 Usar calculadora', callback_data: 'fonetico:calc' }],
            [{ text: '🔧 Reconfigurar mapeo', callback_data: 'fonetico:reconfig' }]
          ]
        }
      });
    });
    return;
  }

  if (data === 'fonetico:reconfig') {
    // borrar mappings y empezar desde 0
    db.run(`DELETE FROM phonetic_mappings WHERE chatId = ?`, [chatId], (err) => {
      if (err) console.error('ERROR borrando mappings', err);
      const seq = ["1","2","3","4","5","6","7","8","9","0"];
      usuarios[chatId] = { tipo: 'phonetic_setup', numbersToMap: seq, nextIndex: 0 };
      bot.sendMessage(chatId, `🔧 Reconfigurando código fonético.\nIntroduce la letra para el número ${seq[0]}:`);
    });
    return;
  }

  if (data === 'fonetico:calc') {
    usuarios[chatId] = { tipo: 'phonetic_use' };
    bot.sendMessage(chatId, '🔢 Introduce la secuencia de números (ej: 123):');
    return;
  }

  // Volver a pedir secuencia tras generación fonética
  if (data === 'fonetico:again') {
    usuarios[chatId] = { tipo: 'phonetic_use' };
    return bot.sendMessage(chatId, '🔢 Introduce la secuencia de números (ej: 123):');
  }

  // Volver al menú principal
  if (data === 'fonetico:menu') {
    db.get("SELECT nombre FROM usuarios WHERE chatId = ?", [chatId], (err, row) => {
      const nombre = (row && row.nombre) ? row.nombre : '';
      return mostrarMenu(chatId, nombre);
    });
    return;
  }

  if (data.startsWith("flash_subtema:")) {
    const carpeta = data.split(":")[1];
    const rutaSub = path.join(RUTA_FLASHCARDS, carpeta);
    if (!fs.existsSync(rutaSub)) {
      console.warn('WARN flash_subtema ruta no existe:', rutaSub);
      return bot.sendMessage(chatId, "⚠️ No pude encontrar ese subtema de flashcards");
    }

    let archivos = [];
    try {
      archivos = fs.readdirSync(rutaSub).filter(f => f.endsWith(".json"));
    } catch (e) {
      console.error('ERROR leyendo flashcards en', rutaSub, e);
      return bot.sendMessage(chatId, "❌ Error leyendo flashcards del subtema");
    }

    const added = [];
    archivos.forEach(file => {
      try {
        const contenido = JSON.parse(fs.readFileSync(path.join(rutaSub, file), "utf8"));
        TESTS[file.replace(".json", "")] = Array.isArray(contenido)
          ? { tema: file.replace(".json", ""), preguntas: contenido }
          : contenido;
        added.push(file);
      } catch (e) {
        console.error('ERROR parseando JSON flashcard', file, e);
      }
    });

    if (!added.length) return bot.sendMessage(chatId, `⚠️ No hay flashcards válidas en ${carpeta}`);

    return bot.sendMessage(chatId, `📘 Flashcards ${carpeta}`, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: added.map(f => [{ text: f.replace(".json", ""), callback_data: `flash:${f.replace(".json", "")}` }]) }
    });
  }

  if (data.startsWith("flash:")) {
    const tema = data.split(":")[1];
    const pack = TESTS[tema];
    if (!pack) return bot.sendMessage(chatId, "⚠️ No encontré ese paquete de flashcards.");
    const tarjetas = pack.preguntas || pack;
    if (!tarjetas || !tarjetas.length) return bot.sendMessage(chatId, "⚠️ Ese paquete de flashcards está vacío.");
    usuarios[chatId] = { tipo: "flashcards", tarjetas, indice: 0 };
    return enviarFlashcard(chatId);
  }
  // ➡ AVANZAR FLASHCARD
  if (data === "flash_next") {
    const estado = usuarios[chatId];
    if (estado && estado.tipo === "flashcards") {
      estado.indice++;
      return enviarFlashcard(chatId);
    }
  }


  // ▶ INICIAR CUALQUIER TEST AQUÍ (ARREGLADO)
  if (data.startsWith("tema:")) {
    const tema = data.split(":")[1];
    const pack = TESTS[tema];

    if (!pack) return bot.sendMessage(chatId, "⚠ No encontré ese test.");

    const preguntas = Array.isArray(pack) ? pack : pack.preguntas;
    if (!preguntas || !preguntas.length) return bot.sendMessage(chatId, "⚠ El test está vacío.");

    usuarios[chatId] = {
      tipo: "test",
      tema,
      preguntas,
      indice: 0,
      aciertos: 0,
      fallos: []
    };

    bot.sendMessage(chatId, `🧠 Iniciando test: <b>${tema}</b>`, { parse_mode: "HTML" });
    return enviarPregunta(chatId);
  }

  // ===================================
  // 🔥 TEST NORMAL — ÚLTIMO BLOQUE
  // ===================================
  const estado = usuarios[chatId];
  if (!estado) return bot.sendMessage(chatId, "⚠ No tienes un test activo.");

  if (data === "finish") {
    delete usuarios[chatId];
    // Eliminar todos los archivos de test_en_curso del usuario
    const testDir = path.join(__dirname, "test_en_curso");
    try {
      fs.readdirSync(testDir).filter(f => f.startsWith(`${chatId}`) && f.endsWith('.json')).forEach(f => {
        fs.unlinkSync(path.join(testDir, f));
      });
    } catch (e) {}
    return bot.sendMessage(chatId, "🏁 Test cerrado.");
  }

  if (data === "retest") {
    estado.preguntas = [...estado.fallos];
    estado.indice = 0;
    estado.aciertos = 0;
    estado.fallos = [];
    return enviarPregunta(chatId);
  }

  const p = estado.preguntas[estado.indice];
  if (!p) return;

  if (data === p.correcta) {
    estado.aciertos++;
  } else {
    estado.fallos.push(p);
  }

  bot.editMessageText(`${p.pregunta}\n\n${formatearOpciones(p, data, p.correcta)}`, {
    chat_id: chatId,
    message_id: cb.message.message_id,
    parse_mode: "HTML"
  });

  estado.indice++;
  setTimeout(() => enviarPregunta(chatId), 700);
});

console.log("🤖 BOT ACTIVADO 🎯");
