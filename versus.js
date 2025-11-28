// ===========================================
// ⚔️ SISTEMA VERSUS (1 vs 1) – VERSIÓN FUNCIONAL
// ===========================================

const db = require("./db");

// Estado global de duelos
let duelos = {}; // { retadorId: { rivalId, puntos, estado, ... } }

// ==============================
// 🎯 1. INICIAR VERSUS
// ==============================
function iniciarVersus(bot, chatId, nombre) {
  bot.sendMessage(chatId, `⚔️ Hola <b>${nombre}</b>, ¿a quién quieres retar?\n\nUsa:\n👉 /invitar NOMBRE_DEL_USUARIO`, { parse_mode: "HTML" });
}

// ==============================
// 🎯 2. INVITAR A OTRO JUGADOR
// ==============================
function invitar(bot, retadorId, rivalId, nombreRetador, nombreRival) {
  if (retadorId == rivalId) {
    return bot.sendMessage(retadorId, "⚠️ No puedes retarte a ti mismo 😂");
  }

  // Intentamos enviar la invitación directamente: si el usuario no ha iniciado
  // conversación con el bot Telegram devolverá un error que capturamos.
  bot.sendMessage(rivalId, `⚔️ ¡<b>${nombreRetador}</b> te ha retado al versus!\n\nUsa:\n👉 /aceptar ${nombreRetador}`, { parse_mode: "HTML" })
    .then(() => {
      // Crear duelo
      duelos[retadorId] = {
        rivalId,
        nombreRetador,
        nombreRival,
        puntos: { [retadorId]: 0, [rivalId]: 0 },
        estado: "pendiente",
        preguntas: [],
        tema: null,
        indice: 0,
      };

      console.log(`📢 ${nombreRetador} invita a ${nombreRival}`);
      bot.sendMessage(retadorId, `📩 Invitación enviada a <b>${nombreRival}</b>… esperando respuesta.`, { parse_mode: "HTML" });
    })
    .catch(err => {
      console.log("❌ ERROR ENVIANDO INVITACIÓN:", err?.response?.body || err.message || err);
      bot.sendMessage(retadorId, `⚠️ No puedo enviar la invitación a <b>${nombreRival}</b>: ese usuario no ha iniciado el bot o bloqueó mensajes.`, { parse_mode: "HTML" });
    });
}

// ==============================
// 🎯 3. ACEPTAR RETO
// ==============================
function aceptar(bot, rivalId, retadorId, TESTS, nombreRival, nombreRetador) {
  const duel = duelos[retadorId];
  if (!duel || duel.estado !== "pendiente") {
    return bot.sendMessage(rivalId, `⚠️ No hay duelo pendiente con <b>${nombreRetador}</b>.`, { parse_mode: "HTML" });
  }

  duel.estado = "activo";
  duel.jugador2 = rivalId;
  duel.indice = 0;

  // COGEMOS UN TEMA ALEATORIO
  const temas = Object.keys(TESTS);
  const temaRandom = temas[Math.floor(Math.random() * temas.length)];
  duel.tema = temaRandom;

  // Seleccionamos hasta 10 preguntas aleatorias sin repetición
  const allPreguntas = [...(TESTS[temaRandom].preguntas || [])];
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const seleccionadas = shuffle(allPreguntas).slice(0, 10);
  duel.preguntas = seleccionadas;
  duel.maxPreguntas = seleccionadas.length;

  bot.sendMessage(retadorId, `🔥 <b>${nombreRival}</b> aceptó el reto!\nTema: <b>${temaRandom}</b>`, { parse_mode: "HTML" });
  bot.sendMessage(rivalId,  `🔥 ¡Aceptaste el reto contra <b>${nombreRetador}</b>!\nTema: <b>${temaRandom}</b>`, { parse_mode: "HTML" });

  enviarPreguntaVersus(bot, retadorId);
}

// ==============================
// 🎯 4. ENVIAR PREGUNTA A LOS DOS
// ==============================
function enviarPreguntaVersus(bot, duelId) {
  const duel = duelos[duelId];
  const i = duel.indice;

  if (i >= duel.preguntas.length) return terminarVersus(bot, duelId);

  const p = duel.preguntas[i];
  duel.respuestas = {}; // Reiniciamos respuestas
  // Limpiamos temporizador anterior si existía
  if (duel.timer) {
    clearTimeout(duel.timer);
    duel.timer = null;
  }

  const texto = `
⚔️ <b>DUELO: ${duel.nombreRetador} vs ${duel.nombreRival}</b>
<b>Pregunta ${i + 1}/${duel.preguntas.length}</b>
━━━━━━━━━━━━━━━━
${p.pregunta}

${Object.entries(p.opciones).map(([k, v]) => `${k}) ${v}`).join("\n")}
`;

  // Botones para responder (A,B,C...) en una sola fila horizontal
  const botones = Object.keys(p.opciones).map(k => ({ text: k, callback_data: k }));

  bot.sendMessage(duelId, texto, { parse_mode: "HTML", reply_markup: { inline_keyboard: [botones] } }).catch(err => console.log(err));
  bot.sendMessage(duel.rivalId, texto, { parse_mode: "HTML", reply_markup: { inline_keyboard: [botones] } }).catch(err => console.log(err));

  // Temporizador de 30 segundos por pregunta
  duel.timer = setTimeout(() => {
    // Para quien no respondió, consideramos incorrecto (no sumar puntos)
    const players = [duelId, duel.rivalId];
    players.forEach(pid => {
      if (!duel.respuestas[pid]) {
        try { bot.sendMessage(pid, '⏱️ Tiempo agotado para esta pregunta.'); } catch (e) { }
      }
    });

    // Mostrar respuesta correcta y marcador parcial
    const correcta = p.correcta;
    players.forEach(pid => {
      try { bot.sendMessage(pid, `✅ Respuesta correcta: ${correcta}`); } catch (e) { }
    });

    const marcador = `🧮 MARCADOR:
<b>${duel.nombreRetador}</b>: ${duel.puntos[duelId]}
<b>${duel.nombreRival}</b>: ${duel.puntos[duel.rivalId]}`;
    bot.sendMessage(duelId, marcador, { parse_mode: "HTML" });
    bot.sendMessage(duel.rivalId, marcador, { parse_mode: "HTML" });

    duel.indice++;
    duel.timer = null;
    setTimeout(() => enviarPreguntaVersus(bot, duelId), 800);
  }, 30000);
}

// ==============================
// 🎯 5. GESTIONAR RESPUESTA
// ==============================
function respuestaVersus(bot, userId, data) {
  userId = String(userId);
  const duelId = Object.keys(duelos).find(d => d === userId || String(duelos[d].rivalId) === userId);
  if (!duelId) return; // No hay versus activo

  const duel = duelos[duelId];
  const p = duel.preguntas[duel.indice];
  if (!p) return; // No hay pregunta activa

  if (duel.respuestas[userId]) return; // Ya respondió

  duel.respuestas[userId] = data;

  if (data === p.correcta) {
    // Asegurarnos de que la key existe y es numérica
    duel.puntos[userId] = (Number(duel.puntos[userId]) || 0) + 1;
    bot.sendMessage(userId, "🟢 ¡Correcto! 🎯");
  } else {
    bot.sendMessage(userId, "🔴 Incorrecto");
  }

  // Cuando respondan los 2...
  const playersResponded = Object.keys(duel.respuestas).length;
  const totalPlayers = 2;

  if (playersResponded === totalPlayers) {
    // Ambos respondieron: cancelar temporizador y mostrar resultado
    if (duel.timer) {
      clearTimeout(duel.timer);
      duel.timer = null;
    }

    // Mostrar correcta y marcador
    const correcta = p.correcta;
    try { bot.sendMessage(duelId, `✅ Respuesta correcta: ${correcta}`); } catch (e) {}
    try { bot.sendMessage(duel.rivalId, `✅ Respuesta correcta: ${correcta}`); } catch (e) {}

    // Normalizar claves a string al mostrar marcador
    const p1 = Number(duel.puntos[String(duelId)]) || 0;
    const p2 = Number(duel.puntos[String(duel.rivalId)]) || 0;
    const marcador = `🧮 MARCADOR:\n<b>${duel.nombreRetador}</b>: ${p1}\n<b>${duel.nombreRival}</b>: ${p2}`;
    bot.sendMessage(duelId, marcador, { parse_mode: "HTML" });
    bot.sendMessage(duel.rivalId, marcador, { parse_mode: "HTML" });

    duel.indice++;
    setTimeout(() => enviarPreguntaVersus(bot, duelId), 800);
  }
}

// ==============================
// 🎯 6. TERMINAR VERSUS
// ==============================
function terminarVersus(bot, duelId) {
  const duel = duelos[duelId];
  const { puntos, rivalId } = duel;

  let ganador;
  if (puntos[duelId] > puntos[rivalId]) ganador = duelId;
  else if (puntos[duelId] < puntos[rivalId]) ganador = rivalId;
  else ganador = null; // empate

  const nombreGanador = ganador === duelId ? duel.nombreRetador : duel.nombreRival;
  const resultado = ganador ? `🏁 FINAL DEL DUELO\n🏆 Ganador: <b>${nombreGanador}</b>` : `🏁 FINAL DEL DUELO\n🤝 Resultado: EMPATE`;

  const marcadorFinal = `🔚 MARCADOR FINAL:\n<b>${duel.nombreRetador}</b>: ${puntos[duelId]}\n<b>${duel.nombreRival}</b>: ${puntos[rivalId]}`;

  bot.sendMessage(duelId, `${resultado}\n\n${marcadorFinal}`, { parse_mode: "HTML" });
  bot.sendMessage(rivalId, `${resultado}\n\n${marcadorFinal}`, { parse_mode: "HTML" });

  // Limpiamos temporizador si aún existiera
  if (duel.timer) {
    clearTimeout(duel.timer);
    duel.timer = null;
  }

  delete duelos[duelId]; // LIMPIEZA
}

// ==============================
// 🎯 DUELOS GRUPALES (N vs N)
// ==============================

let duelosGrupales = {}; // { grupoId: { creador, jugadores: [id1, id2, ...], aceptados: [id1, ...], estado, ... } }
let gruposTestsTemp = {}; // { grupoId: TESTS }

function invitarGrupo(bot, creadorId, idsRivales, nombreCreador, TESTS, tiempoEsperaMs = 60000) {
  if (!idsRivales || idsRivales.length === 0) {
    return bot.sendMessage(creadorId, "⚠️ Debes invitar al menos a una persona.");
  }

  console.log(`🎯 invitarGrupo: TESTS recibidos = ${Object.keys(TESTS || {}).length} temas`);

  // Eliminar duplicados y al creador si está en la lista
  const jugadores = [...new Set(idsRivales)].filter(id => id != creadorId);
  if (jugadores.length === 0) {
    return bot.sendMessage(creadorId, "⚠️ No puedes retarte solo 😂");
  }

  const grupoId = `grupo_${creadorId}_${Date.now()}`;
  duelosGrupales[grupoId] = {
    creador: creadorId,
    nombreCreador,
    jugadores: [creadorId, ...jugadores], // Incluir al creador
    nombresJugadores: { [creadorId]: nombreCreador }, // Mapeo chatId -> nombre
    aceptados: [creadorId], // El creador acepta automáticamente
    rechazados: [],
    estado: "pendiente",
    preguntas: [],
    tema: null,
    indice: 0,
    puntos: {},
    respuestas: {},
    timer: null,
    timerInvitacion: null,
  };

  // Guardar TESTS en variable temporal
  gruposTestsTemp[grupoId] = TESTS;
  console.log(`💾 Guardado en gruposTestsTemp[${grupoId}]: ${Object.keys(TESTS || {}).length} temas`);

  // Inicializar puntos para todos
  duelosGrupales[grupoId].jugadores.forEach(id => {
    duelosGrupales[grupoId].puntos[id] = 0;
  });

  // Enviar invitación a cada persona (excepto creador)
  jugadores.forEach(rivalId => {
    bot.sendMessage(rivalId, 
      `⚔️ ¡<b>${nombreCreador}</b> te ha retado a un DUELO GRUPAL!\n\nUsa:\n👉 /aceptar_grupo ${grupoId}\n👉 /rechazar_grupo ${grupoId}`, { parse_mode: "HTML" })
      .catch(err => {
        console.log("❌ ERROR ENVIANDO INVITACIÓN GRUPAL A", rivalId, err?.response?.body || err.message);
        duelosGrupales[grupoId].rechazados.push(rivalId);
      });
  });

  bot.sendMessage(creadorId, 
    `📩 Invitaciones enviadas a ${jugadores.length} jugador(es).\n⏱️ Esperando respuesta (${tiempoEsperaMs / 1000}s)...`);

  // Temporizador de espera: si pasan X segundos, iniciar con quien aceptó
  duelosGrupales[grupoId].timerInvitacion = setTimeout(() => {
    const grupo = duelosGrupales[grupoId];
    if (grupo && grupo.estado === "pendiente") {
      // Notificar rechazos
      grupo.rechazados.forEach(id => {
        try { bot.sendMessage(id, `❌ El duelo grupal ha sido iniciado sin ti.`); } catch (e) {}
      });

      // Iniciar duelo con quienes aceptaron (mínimo 2)
      if (grupo.aceptados.length < 2) {
        grupo.jugadores.forEach(id => {
          try { bot.sendMessage(id, `❌ No hay suficientes jugadores. Duelo cancelado.`); } catch (e) {}
        });
        delete duelosGrupales[grupoId];
        delete gruposTestsTemp[grupoId];
      } else {
        aceptarGrupo(bot, grupoId, gruposTestsTemp[grupoId] || {});
      }
    }
  }, tiempoEsperaMs);

  console.log(`DUELO GRUPAL CREADO: ${grupoId} con ${jugadores.length} invitados`);
}

function aceptarGrupoUsuario(bot, grupoId, usuarioId, nombreUsuario) {
  const grupo = duelosGrupales[grupoId];
  if (!grupo) {
    return bot.sendMessage(usuarioId, "⚠️ Ese duelo grupal no existe.");
  }

  if (grupo.estado !== "pendiente") {
    return bot.sendMessage(usuarioId, "⚠️ El duelo grupal ya empezó o fue cancelado.");
  }

  // Si ya aceptó, ignorar
  if (grupo.aceptados.includes(usuarioId)) {
    return bot.sendMessage(usuarioId, "✅ Ya habías aceptado este duelo.");
  }

  // Si rechazó antes, removerlo de rechazados
  if (grupo.rechazados.includes(usuarioId)) {
    grupo.rechazados = grupo.rechazados.filter(id => id !== usuarioId);
  }

  // Agregar a aceptados
  grupo.aceptados.push(usuarioId);
  grupo.nombresJugadores[usuarioId] = nombreUsuario;
  bot.sendMessage(usuarioId, "✅ ¡Has aceptado el duelo grupal!");

  // Notificar al creador
  const totalInvitados = grupo.jugadores.length - 1; // -1 porque el creador ya está
  const aceptadosCount = grupo.aceptados.length - 1; // -1 porque el creador ya está
  bot.sendMessage(grupo.creador, `${nombreUsuario} aceptó (${aceptadosCount}/${totalInvitados})`);

  console.log(`GRUPO ${grupoId}: ${nombreUsuario} aceptó. Total aceptados: ${grupo.aceptados.length}/${grupo.jugadores.length}`);

  // ✅ INICIAR DUELO SI TODOS HAN RESPONDIDO (aceptado o rechazado)
  const totalResponsas = grupo.aceptados.length + grupo.rechazados.length;
  if (totalResponsas === grupo.jugadores.length) {
    console.log(`🎯 TODOS RESPONDIERON. Iniciando duelo con ${grupo.aceptados.length} jugadores`);
    console.log(`📦 TESTS para duelo: ${Object.keys(gruposTestsTemp[grupoId] || {}).length} temas`);
    const testsParaDuelo = gruposTestsTemp[grupoId];
    aceptarGrupo(bot, grupoId, testsParaDuelo || {});
  }
}

function aceptarGrupo(bot, grupoId, TESTS) {
  const grupo = duelosGrupales[grupoId];
  if (!grupo) {
    console.log("❌ Grupo no encontrado:", grupoId);
    return;
  }
  
  console.log(`🔍 aceptarGrupo llamado con grupoId=${grupoId}, TESTS disponibles: ${Object.keys(TESTS || {}).length}`);

  // Si ya está activo, ignorar
  if (grupo.estado === "activo") {
    console.log("⚠️ El grupo ya está activo:", grupoId);
    return;
  }

  // Si no es pendiente, salir
  if (grupo.estado !== "pendiente") {
    console.log("⚠️ El grupo no está en estado pendiente:", grupoId, grupo.estado);
    return;
  }

  // Cancelar timer de invitación
  if (grupo.timerInvitacion) {
    clearTimeout(grupo.timerInvitacion);
    grupo.timerInvitacion = null;
  }

  grupo.estado = "activo";
  grupo.indice = 0;

  // COGEMOS UN TEMA ALEATORIO
  if (!TESTS || Object.keys(TESTS).length === 0) {
    console.log("❌ TESTS vacío o no disponible para grupoId:", grupoId);
    grupo.aceptados.forEach(id => {
      try { bot.sendMessage(id, "❌ No hay tests disponibles. Duelo cancelado."); } catch (e) {}
    });
    delete duelosGrupales[grupoId];
    return;
  }

  const temas = Object.keys(TESTS);
  const temaRandom = temas[Math.floor(Math.random() * temas.length)];
  grupo.tema = temaRandom;

  // Seleccionamos 10 preguntas aleatorias
  const allPreguntas = [...(TESTS[temaRandom].preguntas || [])];
  if (allPreguntas.length === 0) {
    console.log("❌ No hay preguntas en tema:", temaRandom);
    grupo.aceptados.forEach(id => {
      try { bot.sendMessage(id, "❌ No hay preguntas en ese tema. Duelo cancelado."); } catch (e) {}
    });
    delete duelosGrupales[grupoId];
    return;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const seleccionadas = shuffle(allPreguntas).slice(0, 10);
  grupo.preguntas = seleccionadas;

  const mensaje = `🔥 DUELO GRUPAL INICIADO\nTema: <b>${temaRandom}</b>\nJugadores: ${grupo.aceptados.length}\n\n⏱️ 30 segundos por pregunta`;
  grupo.aceptados.forEach(id => {
    bot.sendMessage(id, mensaje, { parse_mode: "HTML" }).catch(err => console.log(err));
  });

  setTimeout(() => enviarPreguntaGrupo(bot, grupoId), 1000);
}

function rechazarGrupo(bot, grupoId, usuarioId, nombreUsuario) {
  const grupo = duelosGrupales[grupoId];
  if (!grupo) return bot.sendMessage(usuarioId, "⚠️ Ese duelo no existe.");

  if (grupo.estado !== "pendiente") {
    return bot.sendMessage(usuarioId, "⚠️ El duelo grupal ya empezó o fue cancelado.");
  }

  if (grupo.aceptados.includes(usuarioId)) {
    grupo.aceptados = grupo.aceptados.filter(id => id !== usuarioId);
    bot.sendMessage(usuarioId, "❌ Has rechazado el duelo grupal.");
    bot.sendMessage(grupo.creador, `${nombreUsuario} rechazó la invitación.`);
  } else if (!grupo.rechazados.includes(usuarioId)) {
    grupo.rechazados.push(usuarioId);
    grupo.nombresJugadores[usuarioId] = nombreUsuario;
    bot.sendMessage(usuarioId, "❌ Has rechazado el duelo grupal.");
  }

  console.log(`GRUPO ${grupoId}: ${nombreUsuario} rechazó. Aceptados: ${grupo.aceptados.length}, Rechazados: ${grupo.rechazados.length}`);

  // ✅ INICIAR DUELO SI TODOS HAN RESPONDIDO (aceptado o rechazado)
  const totalResponsas = grupo.aceptados.length + grupo.rechazados.length;
  if (totalResponsas === grupo.jugadores.length) {
    console.log(`🎯 TODOS RESPONDIERON. Iniciando duelo con ${grupo.aceptados.length} jugadores`);
    if (grupo.aceptados.length < 2) {
      grupo.jugadores.forEach(id => {
        try { bot.sendMessage(id, `❌ No hay suficientes jugadores. Duelo cancelado.`); } catch (e) {}
      });
      delete duelosGrupales[grupoId];
      delete gruposTestsTemp[grupoId];
    } else {
      const testsParaDuelo = gruposTestsTemp[grupoId];
      aceptarGrupo(bot, grupoId, testsParaDuelo || {});
    }
  }
}

function enviarPreguntaGrupo(bot, grupoId) {
  const grupo = duelosGrupales[grupoId];
  const i = grupo.indice;

  if (i >= grupo.preguntas.length) return terminarDueloGrupo(bot, grupoId);

  const p = grupo.preguntas[i];
  grupo.respuestas = {}; // Reiniciamos respuestas

  // Limpiamos temporizador anterior si existía
  if (grupo.timer) {
    clearTimeout(grupo.timer);
    grupo.timer = null;
  }

  const texto = `
<b>Pregunta ${i + 1}/${grupo.preguntas.length}</b>
━━━━━━━━━━━━━━━━
${p.pregunta}

${Object.entries(p.opciones).map(([k, v]) => `${k}) ${v}`).join("\n")}
`;

  // Botones en fila horizontal
  const botones = Object.keys(p.opciones).map(k => ({ text: k, callback_data: `grupo:${grupoId}:${k}` }));

  grupo.aceptados.forEach(id => {
    bot.sendMessage(id, texto, { parse_mode: "HTML", reply_markup: { inline_keyboard: [botones] } }).catch(err => console.log(err));
  });

  // Temporizador de 30 segundos
  grupo.timer = setTimeout(() => {
    const players = grupo.aceptados;
    players.forEach(pid => {
      if (!grupo.respuestas[pid]) {
        try { bot.sendMessage(pid, '⏱️ Tiempo agotado para esta pregunta.'); } catch (e) {}
      }
    });

    const correcta = p.correcta;
    players.forEach(pid => {
      try { bot.sendMessage(pid, `✅ Respuesta correcta: ${correcta}`); } catch (e) {}
    });

    const marcador = `MARCADOR GRUPAL:\n${grupo.aceptados.map(id => `<b>${grupo.nombresJugadores[id]}</b>: ${grupo.puntos[id]}`).join("\n")}`;
    players.forEach(pid => {
      bot.sendMessage(pid, marcador, { parse_mode: "HTML" }).catch(err => console.log(err));
    });

    grupo.indice++;
    grupo.timer = null;
    setTimeout(() => enviarPreguntaGrupo(bot, grupoId), 800);
  }, 30000);
}

function respuestaGrupo(bot, usuarioId, grupoId, respuesta) {
  usuarioId = String(usuarioId);
  const grupo = duelosGrupales[grupoId];
  if (!grupo) return;

  const p = grupo.preguntas[grupo.indice];
  if (!p) return;

  if (grupo.respuestas[usuarioId]) return; // Ya respondió

  grupo.respuestas[usuarioId] = respuesta;

  if (respuesta === p.correcta) {
    // Inicializar y sumar de forma segura
    const key = String(usuarioId);
    grupo.puntos[key] = (Number(grupo.puntos[key]) || 0) + 1;
    bot.sendMessage(usuarioId, "🟢 ¡Correcto! 🎯");
  } else {
    bot.sendMessage(usuarioId, "🔴 Incorrecto");
  }

  // Si todos respondieron
  if (Object.keys(grupo.respuestas).length === grupo.aceptados.length) {
    if (grupo.timer) {
      clearTimeout(grupo.timer);
      grupo.timer = null;
    }

    const correcta = p.correcta;
    grupo.aceptados.forEach(pid => {
      try { bot.sendMessage(pid, `✅ Respuesta correcta: ${correcta}`); } catch (e) {}
    });

    const marcador = `MARCADOR GRUPAL:\n${grupo.aceptados.map(id => `<b>${grupo.nombresJugadores[id]}</b>: ${grupo.puntos[id]}`).join("\n")}`;
    grupo.aceptados.forEach(pid => {
      bot.sendMessage(pid, marcador, { parse_mode: "HTML" }).catch(err => console.log(err));
    });

    grupo.indice++;
    setTimeout(() => enviarPreguntaGrupo(bot, grupoId), 800);
  }
}

function terminarDueloGrupo(bot, grupoId) {
  const grupo = duelosGrupales[grupoId];
  const { puntos, aceptados } = grupo;

  // Encontrar ganador
  const numericScores = aceptados.map(id => Number(puntos[String(id)]) || 0);
  const maxPuntos = Math.max(...numericScores);
  const ganadores = aceptados.filter((id, idx) => (Number(puntos[String(id)]) || 0) === maxPuntos);

  const marcadorFinal = `MARCADOR GRUPAL FINAL:\n${aceptados.map(id => `<b>${grupo.nombresJugadores[id] || id}</b>: ${Number(puntos[String(id)]) || 0}`).join("\n")}`;

  aceptados.forEach(id => {
    bot.sendMessage(id, marcadorFinal, { parse_mode: "HTML" }).catch(err => console.log(err));
  });

  // Limpiar timers
  if (grupo.timer) clearTimeout(grupo.timer);
  if (grupo.timerInvitacion) clearTimeout(grupo.timerInvitacion);

  delete duelosGrupales[grupoId];
}

// EXPORTS
module.exports = {
  duelos,
  duelosGrupales,
  iniciarVersus,
  invitar,
  aceptar,
  respuestaVersus,
  invitarGrupo,
  aceptarGrupoUsuario,
  aceptarGrupo,
  rechazarGrupo,
  respuestaGrupo,
};
