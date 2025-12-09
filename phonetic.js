const db = require("./db");
const https = require("https");

// Cargar lista pequeña de palabras comunes en español para priorizar variantes realistas
let spanishCommon = [];
try {
  spanishCommon = require('./data/spanish_common.json');
} catch (e) {
  spanishCommon = [];
}
const spanishSet = new Set(spanishCommon.map(w => (w || '').toString().toLowerCase()));

// Crear tabla de mappings si no existe
db.run(`
  CREATE TABLE IF NOT EXISTS phonetic_mappings (
    chatId TEXT,
    numero TEXT,
    letra TEXT,
    PRIMARY KEY (chatId, numero)
  );
`);

// Función para validar y reemplazar las variantes con el diccionario
function getValidVariants(variants) {
  return variants.slice(0, 3);
}

// Registrar handlers públicos para el módulo fonético
function registerPhonetic(bot) {
  // /asignar 1 A
  bot.onText(/\/asignar\s+(\S+)\s+(\S+)/i, (msg, match) => {
    const chatId = String(msg.chat.id);
    const numero = match[1];
    const letra = match[2].toUpperCase().slice(0, 1);
    db.run(`INSERT OR REPLACE INTO phonetic_mappings (chatId, numero, letra) VALUES (?, ?, ?)`, [chatId, numero, letra], (err) => {
      if (err) return bot.sendMessage(chatId, `❌ Error guardando mapping: ${err.message}`);
      bot.sendMessage(chatId, `✅ Asignado: ${numero} → ${letra}`);
    });
  });

  // /ver_mapa
  bot.onText(/\/ver_mapa/i, (msg) => {
    const chatId = String(msg.chat.id);
    getUserMappings(chatId).then(map => {
      const keys = Object.keys(map).sort();
      if (!keys.length) return bot.sendMessage(chatId, `📭 No tienes mappings. Usa /asignar NUM LETRA`);
      const lines = keys.map(k => `${k} → ${map[k]}`);
      bot.sendMessage(chatId, `<b>Tus mappings:</b>\n${lines.join('\n')}`, { parse_mode: 'HTML' });
    }).catch(err => bot.sendMessage(chatId, `❌ Error leyendo mappings: ${err.message}`));
  });

  // /borrar_mapa
  bot.onText(/\/borrar_mapa/i, (msg) => {
    const chatId = String(msg.chat.id);
    db.run(`DELETE FROM phonetic_mappings WHERE chatId = ?`, [chatId], (err) => {
      if (err) return bot.sendMessage(chatId, `❌ Error borrando mappings: ${err.message}`);
      bot.sendMessage(chatId, `🧹 Tus mappings han sido borrados.`);
    });
  });

  // /palabras 123
  bot.onText(/\/palabras\s+(\S+)/i, (msg, match) => {
    const chatId = String(msg.chat.id);
    const seq = match[1];
    generateWordsForSequence(chatId, seq, bot);
  });
}

// Función para generar palabra a partir de letras
function generateWordFromLetters(letters) {
  let result = '';
  for (let i = 0; i < letters.length; i++) {
    result += letters[i];  // Aquí puedes agregar cualquier lógica para modificar las letras si es necesario
  }
  return result;
}

// Función para generar variantes locales (fallback si OpenAI no devuelve resultados válidos)
// Función para generar variantes locales (fallback si OpenAI no devuelve resultados válidos)
function generateVariantsFromLettersLocal(letters) {
  const base = generateWordFromLetters(letters);
  if (letters.length <= 1) return [base];

  // Dividir la secuencia de letras en dos partes para crear combinaciones
  const mid = Math.ceil(letters.length / 2);
  const a = generateWordFromLetters(letters.slice(0, mid));
  const b = generateWordFromLetters(letters.slice(mid));

  // Usar preposiciones comunes para crear combinaciones más naturales
  const preps = ['de', 'la', 'en', 'con', 'para'];
  const prep = preps[Math.floor(Math.random() * preps.length)];
  const phrase = (a + ' ' + b).trim();
  const phrase2 = (a + ' ' + prep + ' ' + b).trim();

  return [base, phrase, phrase2];
}

// Función para llamar a OpenAI
function callOpenAI(apiKey, prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const model = opts.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const max_completion_tokens = typeof opts.max_completion_tokens === 'number' ? opts.max_completion_tokens : (typeof opts.max_tokens === 'number' ? opts.max_tokens : 40);
    const bodyObj = {
        model: "gpt-4.1-mini", // O el modelo que estés utilizando
        messages: Array.isArray(prompt) ? prompt : [{ role: 'user', content: prompt }],
        max_completion_tokens: 200,
        temperature: 0.3 // Bajamos la temperatura para obtener respuestas más coherentes y determinísticas.
    };
    const data = JSON.stringify(bodyObj);


    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': `Bearer ${apiKey}`
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      console.log('DEBUG OpenAI response statusCode=', res.statusCode);
      res.on('data', (d) => {
        body += d;
      });
      res.on('end', () => {
        try {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch (pe) { parsed = null; }
          if (parsed && parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));

          // extract textual reply if present
          let reply = '';
          if (parsed && Array.isArray(parsed.choices) && parsed.choices.length) {
            parsed.choices.forEach((c, idx) => {
              console.log(`DEBUG OpenAI choice[${idx}] finish_reason=`, c.finish_reason);
              const msg = c.message || {};
              if (typeof msg.content === 'string' && msg.content.trim()) reply += msg.content;
              else if (msg.content && typeof msg.content === 'object') {
                if (Array.isArray(msg.content.parts)) reply += msg.content.parts.join('');
                else if (typeof msg.content.text === 'string') reply += msg.content.text;
              } else if (typeof c.text === 'string') reply += c.text;
              else if (c.delta && typeof c.delta.content === 'string') reply += c.delta.content;
            });
          }

          if (!reply && parsed) {
            if (typeof parsed.output === 'string') reply = parsed.output;
            else if (typeof parsed.result === 'string') reply = parsed.result;
          }

          console.log('DEBUG OpenAI reply preview:', (reply || '').slice(0,200));
          return resolve({ reply: reply || '', parsed });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.setTimeout(20000, () => {
      req.abort();
      reject(new Error('OpenAI request timeout'));
    });

    req.write(data);
    req.end();
  });
}

function getUserMappings(chatId) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT numero, letra FROM phonetic_mappings WHERE chatId = ?`, [chatId], (err, rows) => {
      if (err) return reject(err);
      const map = {};
      (rows || []).forEach(r => map[String(r.numero)] = r.letra);
      resolve(map);
    });
  });
}

// Divide secuencia de letras en fragmentos de 2 o 3 letras (evita fragmentos de 1 cuando sea posible)
function fragmentSequence(lettersArr) {
  const n = lettersArr.length;
  const parts = [];
  let i = 0;
  // Use a strategy to split into 3s and 2s avoiding a tail of 1
  let remaining = n;
  while (remaining > 0) {
    if (remaining % 3 === 0 || remaining > 4) {
      // use 3 when possible and when remaining >4 (to avoid leaving 1)
      parts.push(lettersArr.slice(i, i+3));
      i += 3;
      remaining -= 3;
    } else {
      // remaining 1 or 4 -> use two 2s when remaining==4, else use 2
      if (remaining === 4) {
        parts.push(lettersArr.slice(i, i+2));
        parts.push(lettersArr.slice(i+2, i+4));
        i += 4;
        remaining -= 4;
      } else {
        parts.push(lettersArr.slice(i, i+2));
        i += 2;
        remaining -= 2;
      }
    }
  }
  return parts;
}

// Validar una variante: las consonantes del `lettersStr` deben aparecer
// en el mismo orden (cada una al menos una vez). Se permiten consonantes
// adicionales en la variante (no se rechazan), por eso sólo comprobamos
// presencia y orden de las consonantes del código.
function validateVariantAgainstSequence(variant, lettersStr) {
  const codeCons = lettersStr.replace(/[AEIOUaeiou]/g, '').toUpperCase();
  const onlyCons = (variant || '').toUpperCase().replace(/[^BCDFGHJKLMNPQRSTVWXYZÑ]/g, '');

  // Ensure each code consonant appears in `onlyCons` in order.
  let searchIdx = 0;
  for (const ch of codeCons) {
    const found = onlyCons.indexOf(ch, searchIdx);
    if (found === -1) return { ok: false, reason: `falta consonante ${ch}` };
    searchIdx = found + 1;
  }
  return { ok: true };
}

// Función para generar palabras basadas en secuencias de números
async function generateWordsForSequence(chatId, seq, bot) {
  const seqArr = seq.split("");
  const map = await getUserMappings(chatId);
  const missing = seqArr.filter(n => !map[n]);
  if (missing.length > 0) {
    return bot.sendMessage(chatId, `⚠️ Te faltan mappings para: ${[...new Set(missing)].join(", ")}\nUsa /asignar NUM LETRA`);
  }

  let letters = seqArr.map(n => map[n]);
  // Si hay una B, también probar con V
  let lettersWithV = letters.map(l => l === 'B' ? 'V' : l);
  const lettersStr = letters.join('');
  const lettersStrWithV = lettersWithV.join('');

  // Fragmentar la secuencia en trozos (parches) cuando sea relativamente larga
  const fragments = fragmentSequence(letters);
  const fragmentStrs = fragments.map(f => f.join(''));

  // Ajuste del prompt para OpenAI: instrucción más explícita y tolerante
  const systemMsg = {
    role: 'system',
    content: 'Genera hasta 5 variantes que contengan las consonantes del código en el mismo orden (mayúsculas para explicitar):\n- Las consonantes del código deben aparecer en la variante en el mismo orden (cada una al menos una vez).\n- Se permiten consonantes adicionales que no formen parte del código, y se permiten vocales intercaladas y espacios.\n- Prioriza una sola palabra real del diccionario (español o inglés). Si no existe una palabra única natural, devuelve frases cortas de 2 o 3 palabras reales. Evita conectores innecesarios.\n- No alteres el orden relativo de las consonantes del código; el resto del contenido puede variar libremente.\n- Devuelve la respuesta como UN ÚNICO OBJETO JSON en una sola línea EXACTAMENTE con el formato: {"variants":[...],"best":"..."}. Usa hasta 5 variantes, pon en "best" la mejor opción.\nEjemplo: para la secuencia consonántica "SGDTM" una salida válida sería {"variants":["saga de tema","saga tema"],"best":"saga de tema"}.'
  };

const userMsg = {
  role: 'user',
  content: `${lettersStr}\nO también: ${lettersStrWithV}\nFragmentos: ${fragmentStrs.join(' ')}\n\nEjemplo de salida esperada (una sola línea JSON): {"variants":["nube", "kilo"],"best":"nube"}`
};


  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const output = letters.length <= 4 ? generateWordFromLetters(letters) : `${generateWordFromLetters(letters.slice(0, Math.ceil(letters.length / 2)))} ${generateWordFromLetters(letters.slice(Math.ceil(letters.length / 2)))}`;
    try {
      const msg = await bot.sendMessage(chatId, `<b>Palabra (fallback local)</b>\nSecuencia: <code>${seq}</code>\nLetras: <code>${lettersStr}</code>\n\n👉 ${output}`, { parse_mode: 'HTML' });
      console.log('DEBUG phonetic: sent fallback message id=', msg && msg.message_id);
      return msg;
    } catch (err) {
      console.error('ERROR sending fallback message:', err);
      return;
    }
  }

  bot.sendMessage(chatId, `🔎 Generando palabra usando OpenAI para: ${lettersStr}...`);

  try {
    // Respect the user's chosen model in .env. If OPENAI_MODEL is set, we will attempt it
    // once with a reasonable token budget. Automatic fallback to gpt-3.5-turbo only
    // happens if OPENAI_FALLBACK=true in the environment.
    const preferredModel = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const fallbackModel = process.env.OPENAI_FALLBACK_MODEL || 'gpt-3.5-turbo';
    // Allow fallback by default unless the environment explicitly disables it
    const allowFallback = (typeof process.env.OPENAI_FALLBACK === 'string') ? (process.env.OPENAI_FALLBACK || '').toLowerCase() === 'true' : true;
    // Reduce default max tokens to lower truncation risk; can be overridden with OPENAI_MAX_TOKENS
    const maxTokensEnv = parseInt(process.env.OPENAI_MAX_TOKENS || '') || 40;

    let resp = await callOpenAI(apiKey, [systemMsg, userMsg], { model: preferredModel, max_completion_tokens: maxTokensEnv });
    console.log('DEBUG respuesta de OpenAI (primary):', resp && resp.parsed ? (resp.parsed.id || '') : (resp.reply || '').slice(0,200));

    let respuesta = (resp && resp.reply) ? resp.reply : '';
    let parsedJSON = resp && resp.parsed ? resp.parsed : null;

    // If the API-level parsed object doesn't contain the expected `variants`,
    // try parsing the textual reply (resp.reply) because some models return
    // the JSON payload inside the assistant message instead of as top-level
    // fields in the API object.
    if (respuesta && respuesta.trim()) {
      try {
        const maybe = JSON.parse(respuesta.trim());
        if (maybe && typeof maybe === 'object' && Array.isArray(maybe.variants)) {
          parsedJSON = maybe;
          console.log('DEBUG phonetic: extracted JSON from textual reply');
        }
      } catch (e) {
        // not JSON — ignore, keep parsedJSON as-is
      }
    }

    // If configured, allow a single fallback to gpt-3.5-turbo when the primary returned a
    // truncated/empty completion. This avoids surprising automatic model switches unless
    // the environment explicitly opts in.
    const primaryChoices = resp && resp.parsed && Array.isArray(resp.parsed.choices) ? resp.parsed.choices : null;
    const primaryTruncated = primaryChoices && primaryChoices.length && primaryChoices[0].finish_reason === 'length' && (!respuesta || !respuesta.trim());
    if (allowFallback && primaryTruncated && preferredModel !== fallbackModel) {
      console.log('DEBUG phonetic: primary model returned truncated/empty result; retrying with fallback model', fallbackModel);
      resp = await callOpenAI(apiKey, [systemMsg, userMsg], { model: fallbackModel, max_completion_tokens: 120 });
      console.log('DEBUG respuesta de OpenAI (fallback):', resp && resp.parsed ? (resp.parsed.id || '') : (resp.reply || '').slice(0,200));
      respuesta = (resp && resp.reply) ? resp.reply : '';
      // Prefer a parsed API object only if it already contains the expected `variants`.
      // Otherwise try to extract JSON from the textual reply (some models embed the
      // JSON as message text). If neither yields `variants`, fall back to the API
      // parsed object so we at least retain metadata.
      const apiParsed = resp && resp.parsed ? resp.parsed : null;
      if (apiParsed && Array.isArray(apiParsed.variants)) {
        parsedJSON = apiParsed;
      } else {
        parsedJSON = null;
        if (respuesta && respuesta.trim()) {
          try {
            const maybe2 = JSON.parse(respuesta.trim());
            if (maybe2 && typeof maybe2 === 'object' && Array.isArray(maybe2.variants)) {
              parsedJSON = maybe2;
              console.log('DEBUG phonetic: extracted JSON from fallback textual reply');
            }
          } catch (e) {
            // not JSON — ignore
          }
        }
        if (!parsedJSON && apiParsed) {
          parsedJSON = apiParsed; // keep API object as last-resort
        }
      }
    }

    // If parsedJSON still missing, try parsing textual reply if any
    if (!parsedJSON && respuesta && respuesta.trim()) {
      try { parsedJSON = JSON.parse(respuesta.trim()); } catch (je) { parsedJSON = null; }
    }

    let variants = [];
    let mejorLine = null;
    if (parsedJSON && Array.isArray(parsedJSON.variants)) {
      // No filtrar: mostrar todas las variantes devueltas por OpenAI
      variants = parsedJSON.variants.slice(0, 5).map(v => (v || '').toString().trim()).filter(Boolean);
      console.log("DEBUG variantes generadas por OpenAI:", variants);
      if (parsedJSON.best && typeof parsedJSON.best === 'string' && variants.includes(parsedJSON.best.trim())) mejorLine = 'MEJOR: ' + parsedJSON.best.trim();
    } else {
      console.warn('WARN phonetic: OpenAI returned JSON but missing "variants" field:', parsedJSON);
    }

    let finalVariants = variants.length ? variants : [];
    // Annotate each variant with validation result but do not filter out (user requested visibility)
    let annotated = finalVariants.map(v => {
      const val = validateVariantAgainstSequence(v, lettersStr);
      if (val.ok) return { text: v, ok: true };
      return { text: v, ok: false, reason: val.reason };
    });

    // If OpenAI returned variants but ALL of them are invalid, and we used a
    // two-fragment split with unequal sizes (e.g. 2+3), retry by swapping the
    // fragment order (3+2) once. This helps when the model expects a different
    // patching direction to find a single-word or better phrase.
    if (finalVariants.length > 0 && annotated.every(a => !a.ok) && fragments.length === 2 && fragments[0].length !== fragments[1].length) {
      try {
        console.log('DEBUG phonetic: all OpenAI variants invalid; retrying with swapped fragments');
        const swappedFragments = [fragments[1], fragments[0]];
        const swappedFragmentStrs = swappedFragments.map(f => f.join(''));
        const swappedUserMsg = {
          role: 'user',
          content: `${lettersStr}\nO también: ${lettersStrWithV}\nFragmentos: ${swappedFragmentStrs.join(' ')}\n\nEjemplo de salida esperada (una sola línea JSON): {"variants":["nube", "kilo"],"best":"nube"}`
        };

        let swappedResp = await callOpenAI(apiKey, [systemMsg, swappedUserMsg], { model: preferredModel, max_completion_tokens: maxTokensEnv });
        let swappedText = (swappedResp && swappedResp.reply) ? swappedResp.reply : '';
        let swappedParsed = swappedResp && swappedResp.parsed ? swappedResp.parsed : null;

        // Try fallback model if primary truncated/empty and fallback allowed
        const swappedChoices = swappedResp && swappedResp.parsed && Array.isArray(swappedResp.parsed.choices) ? swappedResp.parsed.choices : null;
        const swappedTruncated = swappedChoices && swappedChoices.length && swappedChoices[0].finish_reason === 'length' && (!swappedText || !swappedText.trim());
        if (allowFallback && swappedTruncated && preferredModel !== fallbackModel) {
          console.log('DEBUG phonetic: swapped attempt truncated; retrying with fallback model', fallbackModel);
          swappedResp = await callOpenAI(apiKey, [systemMsg, swappedUserMsg], { model: fallbackModel, max_completion_tokens: 120 });
          swappedText = (swappedResp && swappedResp.reply) ? swappedResp.reply : '';
          swappedParsed = swappedResp && swappedResp.parsed ? swappedResp.parsed : null;
        }

        let swappedVariants = [];
        if (swappedParsed && Array.isArray(swappedParsed.variants)) {
          swappedVariants = swappedParsed.variants.slice(0,5).map(v => (v || '').toString().trim()).filter(Boolean);
        } else if (swappedText && swappedText.trim()) {
          try {
            const maybe = JSON.parse(swappedText.trim());
            if (maybe && Array.isArray(maybe.variants)) swappedVariants = maybe.variants.slice(0,5).map(v => (v||'').toString().trim()).filter(Boolean);
          } catch (e) {
            // ignore
          }
        }

        if (swappedVariants.length) {
          console.log('DEBUG phonetic: swapped attempt returned variants ->', swappedVariants);
          finalVariants = swappedVariants;
          annotated = finalVariants.map(v => {
            const val = validateVariantAgainstSequence(v, lettersStr);
            if (val.ok) return { text: v, ok: true };
            return { text: v, ok: false, reason: val.reason };
          });
        }
      } catch (swErr) {
        console.error('ERROR during swapped-fragments retry:', swErr);
      }
    }
    if (!finalVariants.length) {
      // Fallback local: generar palabra por fragmento y combinar
      const perFragment = fragments.map(f => generateWordFromLetters(f));
      const localPhrase = perFragment.join(' ');
      const localFallbacks = generateVariantsFromLettersLocal(letters);
      console.log("DEBUG phonetic: using local generated variants (per-fragment) ->", [localPhrase].concat(localFallbacks));
      finalVariants = [localPhrase].concat(localFallbacks);
      mejorLine = null;  // No se genera una mejor opción en este caso
    }

    // Si ninguna variante pasa el filtro, muestra mensaje explicativo
    if (variants.length === 0) {
      finalVariants.unshift('⚠️ Ninguna variante generada por OpenAI contenía todas las consonantes en orden. Mostrando alternativas locales.');
    }

    const replyLines = [];
    replyLines.push('<b>Frases sugeridas</b>');
    if (!variants.length) replyLines.push('⚠️ OpenAI no devolvió variantes válidas; mostrando alternativas locales.');
    if (finalVariants.length) {
      // build annotated lines
      replyLines.push(annotated.map((a, i) => `${i+1}. ${a.text} ${a.ok ? '' : '⚠️ (' + a.reason + ')'}`).join('\n'));
    }
    if (mejorLine) replyLines.push(`<b>${mejorLine}</b>`);
    // ...no mostrar el JSON...

    try {
      const sent = await bot.sendMessage(chatId, replyLines.join('\n'), {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔁 Otra secuencia', callback_data: 'fonetico:again' }],
            [{ text: '🏠 Volver al menú', callback_data: 'fonetico:menu' }]
          ]
        }
      });
      console.log('DEBUG phonetic: sent suggestions message id=', sent && sent.message_id);
      return sent;
    } catch (err) {
      console.error('ERROR sending suggestions message:', err);
      return;
    }
  } catch (e) {
    console.error('ERROR OpenAI:', e);
    const output = letters.length <= 4 ? generateWordFromLetters(letters) : `${generateWordFromLetters(letters.slice(0, Math.ceil(letters.length / 2)))} ${generateWordFromLetters(letters.slice(Math.ceil(letters.length / 2)))}`;
    try {
      const sent = await bot.sendMessage(chatId, `<b>Palabra (fallback local)</b>\nSecuencia: <code>${seq}</code>\nLetras: <code>${lettersStr}</code>\n\n⚠️ OpenAI error: ${e.message || e}\n👉 ${output}`, { parse_mode: 'HTML' });
      console.log('DEBUG phonetic: sent error-fallback message id=', sent && sent.message_id);
      return sent;
    } catch (err) {
      console.error('ERROR sending error-fallback message:', err);
      return;
    }
  }
}

module.exports = {
  registerPhonetic,
  getUserMappings,
  generateWordsForSequence
};
