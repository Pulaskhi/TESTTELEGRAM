  // Detecta si una variante parece acrónimo (ej: solo mayúsculas, sin vocales)
  function looksLikeAcronym(v) {
    if (!v) return false;
    // Acrónimo típico: 2+ mayúsculas seguidas, sin vocales
    return /^[A-Z]{2,}$/.test(v) || /^[A-Z]{2,}(\s|$)/.test(v);
  }
  // Función avanzada de puntuación para variantes fonéticas
  function scoreBestVariant(variant, lettersStr) {
    const seq = getConsonantSequence(lettersStr);
    const text = variant.toLowerCase();
    const words = text.split(/\s+/).filter(Boolean);
    const cons = getConsonantSequence(text);
    let score = 0;
    if (words.length === 1) score += 20;
    score -= text.length * 0.5;
    if (text[0] && text[0].toUpperCase() === seq[0]) score += 5;
    if (words.length >= 3) score -= 10;
    if (words.length >= 4) score -= 20;
    if (cons.length <= seq.length + 1) score += 5;
    if (/^(de|la|el|and|the|a|en)$/.test(words[1] || "")) score -= 4;
    return score;
  }
// phonetic.js
// ===========================================
// 📦 DEPENDENCIAS
// ===========================================
const db = require("./db");
const https = require("https");

// ===========================================
// 📚 DICCIONARIO ESPAÑOL (PRIORIDAD)
// ===========================================
let spanishCommon = [];
try {
  spanishCommon = require("./data/spanish_common.json");
} catch (e) {
  spanishCommon = [];
}
const spanishSet = new Set(
  spanishCommon.map((w) => (w || "").toString().toLowerCase())
);

// ===========================================
// 🧱 TABLA BBDD PARA MAPEOS FONÉTICOS
// ===========================================
db.run(`
  CREATE TABLE IF NOT EXISTS phonetic_mappings (
    chatId TEXT,
    numero TEXT,
    letra TEXT,
    PRIMARY KEY (chatId, numero)
  );
`);

// ===========================================
// 🔤 HELPERS PARA CONSONANTES
// ===========================================

// Devuelve solo las consonantes de una cadena (ES + Ñ, sin vocales)
function getConsonantSequence(str) {
  return (str || "")
    .toUpperCase()
    .replace(/[AEIOUÁÉÍÓÚÜ]/g, "")
    .replace(/[^BCDFGHJKLMNPQRSTVWXYZÑ]/g, "");
}

// Valida que la variante contenga las consonantes del código en orden.
// B y V se tratan como equivalentes.
function validateVariantAgainstSequence(variant, lettersStr) {
  const codeCons = getConsonantSequence(lettersStr);
  const onlyCons = (variant || "")
    .toUpperCase()
    .replace(/[^BCDFGHJKLMNPQRSTVWXYZÑ]/g, "");

  let idx = 0;
  for (const ch of codeCons) {
    let target = ch;
    if (target === "B") {
      const posB = onlyCons.indexOf("B", idx);
      const posV = onlyCons.indexOf("V", idx);
      if (posB === -1 && posV === -1)
        return { ok: false, reason: "missing B/V" };
      idx = Math.min(posB === -1 ? Infinity : posB, posV === -1 ? Infinity : posV) + 1;
    } else {
      const pos = onlyCons.indexOf(target, idx);
      if (pos === -1)
        return { ok: false, reason: `missing ${target}` };
      idx = pos + 1;
    }
  }
  return { ok: true };
}

// ===========================================
// 🧩 HELPERS DE GENERACIÓN LOCAL
// ===========================================

// Genera palabra simple concatenando letras
function generateWordFromLetters(letters) {
  return (letters || []).join("");
}

// Fallback local: combina trozos con preposición aleatoria
function generateVariantsFromLettersLocal(letters) {
  const base = generateWordFromLetters(letters);
  if (letters.length <= 1) return [base];

  const mid = Math.ceil(letters.length / 2);
  const a = generateWordFromLetters(letters.slice(0, mid));
  const b = generateWordFromLetters(letters.slice(mid));

  const preps = ["de", "la", "en", "con", "para"];
  const prep = preps[Math.floor(Math.random() * preps.length)];
  const phrase = (a + " " + b).trim();
  const phrase2 = (a + " " + prep + " " + b).trim();

  return [base, phrase, phrase2];
}

// Divide secuencia en bloques 2/3 evitando bloques de 1
function fragmentSequence(lettersArr) {
  const n = lettersArr.length;
  const parts = [];
  let i = 0;
  let remaining = n;

  while (remaining > 0) {
    if (remaining % 3 === 0 || remaining > 4) {
      parts.push(lettersArr.slice(i, i + 3));
      i += 3;
      remaining -= 3;
    } else {
      if (remaining === 4) {
        parts.push(lettersArr.slice(i, i + 2));
        parts.push(lettersArr.slice(i + 2, i + 4));
        i += 4;
        remaining -= 4;
      } else {
        parts.push(lettersArr.slice(i, i + 2));
        i += 2;
        remaining -= 2;
      }
    }
  }
  return parts;
}

// Scoring simple: prioriza variantes cuyo final está en diccionario ES
function scoreVariantLanguage(variant) {
  const text = (variant || "").toLowerCase();
  const tokens = text.split(/[^a-záéíóúüñ]+/i).filter(Boolean);
  if (!tokens.length) return 0;
  const last = tokens[tokens.length - 1];
  return spanishSet.has(last) ? 2 : 0;
}

function sortVariantsByPreference(variants) {
  return [...variants].sort((a, b) => {
    const sa = scoreVariantLanguage(a);
    const sb = scoreVariantLanguage(b);
    if (sa !== sb) return sb - sa; // primero más “español”
    return a.length - b.length; // más corta primero
  });
}

// Detecta cosas tipo "NGDNSNP", "LDS NPC", etc.
function isGarbageWord(v) {
  if (!v) return true;
  const text = v.toLowerCase();

  // Clústers feos conocidos
  if (/(gds|dspc|spc|lgds|npspc|npspic)/.test(text)) return true;

  // 3 o más consonantes seguidas → muy sospechoso
  if (/[bcdfghjklmnñpqrstvwxyz]{3,}/i.test(text)) return true;

  // Pseudopalabra larga solo con letras y sin tildes → basura casi seguro
  if (/^[a-z]{7,}$/i.test(text) && !/[áéíóúñàè]/i.test(text)) return true;

  return false;
}


// ===========================================
// 🤖 CLIENTE OPENAI
// ===========================================
function callOpenAI(apiKey, messages, opts = {}) {
  return new Promise((resolve, reject) => {
    // 🔒 Forzamos SIEMPRE gpt-4.1
    const model = opts.model || "gpt-4.1";
    const max_completion_tokens =
      typeof opts.max_completion_tokens === "number"
        ? opts.max_completion_tokens
        : typeof opts.max_tokens === "number"
        ? opts.max_tokens
        : 60;

    const bodyObj = {
      model,
      messages: Array.isArray(messages)
        ? messages
        : [{ role: "user", content: String(messages) }],
      max_completion_tokens,
    };

    // Solo enviamos temperature si el caller la define explícitamente.
    if (typeof opts.temperature === "number") {
      bodyObj.temperature = opts.temperature;
    }

    const data = JSON.stringify(bodyObj);

    const options = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        Authorization: `Bearer ${apiKey}`,
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      console.log("DEBUG OpenAI statusCode=", res.statusCode);
      res.on("data", (d) => {
        body += d;
      });
      res.on("end", () => {
        try {
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch (pe) {
            parsed = null;
          }
          if (parsed && parsed.error) {
            return reject(
              new Error(parsed.error.message || JSON.stringify(parsed.error))
            );
          }

          let reply = "";
          if (parsed && Array.isArray(parsed.choices) && parsed.choices.length) {
            parsed.choices.forEach((c, idx) => {
              console.log(
                `DEBUG OpenAI choice[${idx}] finish_reason=`,
                c.finish_reason
              );
              const msg = c.message || {};
              if (typeof msg.content === "string" && msg.content.trim())
                reply += msg.content;
              else if (msg.content && typeof msg.content === "object") {
                if (Array.isArray(msg.content.parts))
                  reply += msg.content.parts.join("");
                else if (typeof msg.content.text === "string")
                  reply += msg.content.text;
              } else if (typeof c.text === "string") reply += c.text;
              else if (c.delta && typeof c.delta.content === "string")
                reply += c.delta.content;
            });
          }

          if (!reply && parsed) {
            if (typeof parsed.output === "string") reply = parsed.output;
            else if (typeof parsed.result === "string") reply = parsed.result;
          }

          console.log(
            "DEBUG OpenAI reply preview:",
            (reply || "").slice(0, 200)
          );
          return resolve({ reply: reply || "", raw: parsed });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.setTimeout(20000, () => {
      req.abort();
      reject(new Error("OpenAI request timeout"));
    });

    req.write(data);
    req.end();
  });
}

// ===========================================
// 🗃️ HELPERS DB
// ===========================================
function getUserMappings(chatId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT numero, letra FROM phonetic_mappings WHERE chatId = ?`,
      [chatId],
      (err, rows) => {
        if (err) return reject(err);
        const map = {};
        (rows || []).forEach((r) => (map[String(r.numero)] = r.letra));
        resolve(map);
      }
    );
  });
}

// ===========================================
// 🧠 PROMPTS PARA OPENAI
// ===========================================
function buildSystemPrompt(codeConsonants) {
  return {
    role: "system",
    content: `
You are a **high-precision linguistic generator**.

Your task: Generate up to **9 NATURAL variants** (Spanish priority, then Catalan, then English) that strictly follow the user’s consonant sequence.

════════════════════════════════════════
🔒 1) HARD CONSONANT SEQUENCE RULE
════════════════════════════════════════
Let SEQ be the ordered consonant sequence.

Every candidate MUST:
✔ Contain ALL consonants of SEQ in the SAME order  
✔ Allow B ↔ V equivalence  
✔ Allow extra consonants + vowels  
❌ Reject any candidate missing a SEQ consonant  
❌ Reject candidates where order is broken  
❌ Reject raw approximations of the code ("NGDSP", "NGD SPC")  

════════════════════════════════════════
🧹 2) ANTI-GARBAGE RULE
════════════════════════════════════════
ABSOLUTELY DO NOT OUTPUT:
- Long invented pseudowords  
- Words with unnatural consonant clusters (≥3 consecutive consonants)  
- Patterns like: gds, dspc, spc, lgds, npspc, npspic  
- Pseudowords longer than 6 letters  
- Anything that looks like the input code with vowels sprinkled  

Allowed only if unavoidable:
✔ Short pseudowords (≤6 letters, ≤2 syllables, must look ES/CAT/EN plausible)

════════════════════════════════════════
🌍 3) LANGUAGE DISTRIBUTION
════════════════════════════════════════
Try to output:
• 3 Spanish variants  
• 3 Catalan variants  
• 3 English variants  

Use:
- Real words when possible  
- Short natural phrases (2–3 words) otherwise  
- Never mechanical constructs (“tomar el gas dos”) unless unavoidable  

Natural Spanish phrases are **preferred for “best”**.

════════════════════════════════════════
🧩 4) INTERNAL SELF-CHECK (SILENT)
════════════════════════════════════════
For each candidate:
1. Extract consonants  
2. Verify SEQ is a subsequence  
3. Verify it is natural, not garbage  
4. If invalid → discard silently  

════════════════════════════════════════
📦 5) OUTPUT FORMAT (STRICT)
════════════════════════════════════════
Return EXACTLY:

{"variants":[...],"best":"..."}

• No markdown  
• No analysis  
• No extra comments  

SEQ for this conversation: ${codeConsonants.split("").join("-")}
    `.trim(),
  };
}




function buildUserPrompt(lettersStr, lettersStrWithV, fragmentStrs) {
  const codeCons = getConsonantSequence(lettersStr);
  return {
    role: "user",
    content:
      `CODE: ${lettersStr}\n` +
      `ALTERNATIVE CODE (B→V): ${lettersStrWithV}\n` +
      `CONSONANT SEQUENCE (EXACT): ${codeCons.split("").join("-")}\n` +
      `FRAGMENTS: ${fragmentStrs.join(" ")}\n\n` +
      `Return ONLY one JSON line: {"variants":[...],"best":"..."}.`,
  };
}

// Prompt de reparación: OpenAI lo intenta de nuevo corrigiendo sus errores anteriores
function buildRepairPrompt(lettersStr, invalidVariants) {
  const codeCons = getConsonantSequence(lettersStr);
  return {
    role: "user",
    content:
      `The previous variants did NOT satisfy the consonant constraint.\n` +
      `CODE: ${lettersStr}\n` +
      `CONSONANT SEQUENCE (EXACT): ${codeCons.split("").join("-")}\n` +
      `Some invalid attempts were: ${invalidVariants.join(" | ")}\n\n` +
      `Generate up to 5 NEW variants that DO satisfy the rules and respond only with {"variants":[...],"best":"..."}.`,
  };
}

// ===========================================
// 🧩 PARSEO SEGURO DEL JSON DEVUELTO
// ===========================================
function parseJSONFromReply(reply) {
  if (!reply || !reply.trim()) return null;
  const text = reply.trim();

  // Intento directo
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object") return obj;
  } catch (e) {}

  // Buscar {...}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const sub = text.slice(start, end + 1);
    try {
      const obj2 = JSON.parse(sub);
      if (obj2 && typeof obj2 === "object") return obj2;
    } catch (e) {}
  }
  return null;
}

// ===========================================
// 🧨 FALLO OPENAI → FALLBACK LOCAL
// ===========================================
async function sendErrorFallback(bot, chatId, seq, lettersStr, e) {
  const lettersArray = lettersStr.split("");
  const output =
    lettersArray.length <= 4
      ? generateWordFromLetters(lettersArray)
      : `${generateWordFromLetters(
          lettersArray.slice(0, Math.ceil(lettersArray.length / 2))
        )} ${generateWordFromLetters(
          lettersArray.slice(Math.ceil(lettersArray.length / 2))
        )}`;
  try {
    const sent = await bot.sendMessage(
      chatId,
      `<b>Palabra (fallback local)</b>\nSecuencia: <code>${seq}</code>\nLetras: <code>${lettersStr}</code>\n\n⚠️ OpenAI error: ${
        e.message || e
      }\n👉 ${output}`,
      { parse_mode: "HTML" }
    );
    console.log(
      "DEBUG phonetic: sent error-fallback message id=",
      sent && sent.message_id
    );
    return sent;
  } catch (err) {
    console.error("ERROR sending error-fallback message:", err);
    return;
  }
}

// ===========================================
// 🧠 LÓGICA PRINCIPAL FONÉTICA
// ===========================================
async function generateWordsForSequence(chatId, seq, bot) {
  const seqArr = seq.split("");
  const map = await getUserMappings(chatId);
  const missing = seqArr.filter((n) => !map[n]);
  if (missing.length > 0) {
    return bot.sendMessage(
      chatId,
      `⚠️ Te faltan mappings para: ${[...new Set(missing)].join(
        ", "
      )}\nUsa /asignar NUM LETRA`
    );
  }

  const letters = seqArr.map((n) => map[n]); // código del usuario (ej: T N M R L...)
  const lettersWithV = letters.map((l) => (l === "B" ? "V" : l));
  const lettersStr = letters.join("");
  const lettersStrWithV = lettersWithV.join("");

  const fragments = fragmentSequence(letters);
  const fragmentStrs = fragments.map((f) => f.join(""));

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Fallback sin OpenAI
    const output =
      letters.length <= 4
        ? generateWordFromLetters(letters)
        : `${generateWordFromLetters(
            letters.slice(0, Math.ceil(letters.length / 2))
          )} ${generateWordFromLetters(
            letters.slice(Math.ceil(letters.length / 2))
          )}`;
    try {
      const msg = await bot.sendMessage(
        chatId,
        `<b>Palabra (fallback local)</b>\nSecuencia: <code>${seq}</code>\nLetras: <code>${lettersStr}</code>\n\n👉 ${output}`,
        { parse_mode: "HTML" }
      );
      console.log(
        "DEBUG phonetic: sent fallback message id=",
        msg && msg.message_id
      );
      return msg;
    } catch (err) {
      console.error("ERROR sending fallback message:", err);
      return;
    }
  }

  bot.sendMessage(
    chatId,
    `🔎 Generando palabra usando OpenAI para: ${lettersStr}...`
  );

  // 🔒 Forzamos siempre gpt-4.1 aquí
  const preferredModel = "gpt-4.1";
  const fallbackModel = "gpt-4.1"; // mismo modelo, así nunca hay cambio real
  const allowFallback =
    typeof process.env.OPENAI_FALLBACK === "string"
      ? (process.env.OPENAI_FALLBACK || "").toLowerCase() === "true"
      : true;
  const maxTokensEnv = parseInt(process.env.OPENAI_MAX_TOKENS || "") || 60;

  const systemMsg = buildSystemPrompt(getConsonantSequence(lettersStr));
  let userMsg = buildUserPrompt(lettersStr, lettersStrWithV, fragmentStrs);

  // =======================
  // 1ª LLAMADA A OPENAI
  // =======================
  let resp;
  try {
    resp = await callOpenAI(apiKey, [systemMsg, userMsg], {
      model: preferredModel,
      max_completion_tokens: maxTokensEnv,
    });
  } catch (err) {
    console.error("ERROR OpenAI primary:", err);
    return sendErrorFallback(bot, chatId, seq, lettersStr, err);
  }

  let parsedJSON = parseJSONFromReply(resp.reply);

  // Fallback de modelo si no hay JSON válido (en este caso modelo es el mismo)
  if (
    (!parsedJSON || !Array.isArray(parsedJSON.variants)) &&
    allowFallback &&
    preferredModel !== fallbackModel
  ) {
    try {
      console.log(
        "DEBUG phonetic: retrying with fallback model",
        fallbackModel
      );
      resp = await callOpenAI(apiKey, [systemMsg, userMsg], {
        model: fallbackModel,
        max_completion_tokens: maxTokensEnv,
      });
      parsedJSON = parseJSONFromReply(resp.reply);
    } catch (err) {
      console.error("ERROR OpenAI fallback model:", err);
    }
  }

  let variants = [];
  let bestRaw = null;
  if (parsedJSON && Array.isArray(parsedJSON.variants)) {
    variants = parsedJSON.variants
      .map((v) => (v || "").toString().trim())
      .filter(Boolean);
    variants = [...new Set(variants)]; // quitar duplicados
    bestRaw =
      parsedJSON.best && typeof parsedJSON.best === "string"
        ? parsedJSON.best.trim()
        : null;
    console.log("DEBUG variantes generadas por OpenAI:", variants);
  } else {
    console.warn(
      "WARN phonetic: no se pudo extraer JSON de OpenAI:",
      resp.reply
    );
  }

  // =======================
  // FILTRO ANTI-SIGLAS / CÓDIGO PLANO
  // =======================
  const rawCode = lettersStr.toLowerCase().replace(/\s+/g, "");
  variants = variants.filter((v) => {
    const txt = (v || "").toLowerCase().trim();
    const compact = txt.replace(/\s+/g, "");
    // 1) quitar cosas tipo NGDNSNP, LDSNPC (solo consonantes)
    if (looksLikeAcronym(v)) return false;
    // 2) quitar si es exactamente el mismo código
    if (compact === rawCode) return false;
    return true;
  });

  // =======================
  // VALIDAR CONTRA CÓDIGO
  // =======================
  let annotated = variants.map((v) => {
    const val = validateVariantAgainstSequence(v, lettersStr);
    return { text: v, ok: val.ok, reason: val.reason };
  });

  let validVariants = annotated.filter((a) => a.ok).map((a) => a.text);

  // Si ninguna válida pero había inválidas → pase de reparación
  if (!validVariants.length && variants.length) {
    try {
      console.log(
        "DEBUG phonetic: no hay variantes válidas, intentando pase de reparación..."
      );
      const repairMsg = buildRepairPrompt(
        lettersStr,
        annotated.slice(0, 5).map((a) => a.text)
      );
      const repairResp = await callOpenAI(apiKey, [systemMsg, repairMsg], {
        model: preferredModel,
        max_completion_tokens: maxTokensEnv,
      });
      const repairJSON = parseJSONFromReply(repairResp.reply);
      if (repairJSON && Array.isArray(repairJSON.variants)) {
        const repairVariants = [
          ...new Set(
            repairJSON.variants
              .map((v) => (v || "").toString().trim())
              .filter(Boolean)
          ),
        ];
        const repairAnnotated = repairVariants.map((v) => {
          const val = validateVariantAgainstSequence(v, lettersStr);
          return { text: v, ok: val.ok, reason: val.reason };
        });
        validVariants = repairAnnotated.filter((a) => a.ok).map((a) => a.text);
        if (!bestRaw && typeof repairJSON.best === "string") {
          bestRaw = repairJSON.best.trim();
        }
        console.log("DEBUG repair variants:", repairVariants);
      }
    } catch (err) {
      console.error("ERROR durante pase de reparación:", err);
    }
  }

  // Selección avanzada del “best”
  function getConsonantSequence(str) {
    return (str || "").toUpperCase().replace(/[^BCDFGHJKLMNPQRSTVWXYZÑ]/g, "");
  }
  // Nueva función “chooseBestVariant”
  function chooseBestVariant(variants, codeStr, spanishSet) {
  const seq = getConsonantSequence(codeStr);

  function detectLang(v) {
    const t = v.toLowerCase();
    const words = t.split(/\s+/);

    if (/[áéíóúñ]/.test(t) || spanishSet.has(words[words.length-1])) return "es";
    if (/[àèòçíóú]/.test(t) || /ny/.test(t)) return "cat";
    if (/^[a-z\s]+$/.test(t)) return "en";
    return "unk";
  }

  return variants
    .map(v => {
      const t = v.toLowerCase();
      const lang = detectLang(v);
      const words = t.split(/\s+/);
      const cons = getConsonantSequence(t);

      let score = 0;

      // Language priority
      if (lang === "es") score += 50;
      else if (lang === "cat") score += 30;
      else if (lang === "en") score += 10;
      else score -= 20;

      // Prefer short, natural
      if (words.length === 1) score += 20;
      score -= t.length * 0.25;

      // Compact SEQ fit
      if (cons.length <= seq.length + 1) score += 10;

      // Penalize connectors
      if (/^(de|la|el|and|the|a|en)$/.test(words[1] || "")) score -= 6;

      return { v, score };
    })
    .sort((a, b) => b.score - a.score)[0].v;
}


  // Ordenar y filtrar las 5 mejores variantes válidas según las reglas
  // Ordenar y filtrar las 5 mejores variantes válidas según las reglas
  let best = null;
  if (validVariants.length) {
    const scored = validVariants.map(v => ({
      v,
      score: scoreBestVariant(v, lettersStr),
    }));
    scored.sort((a, b) => b.score - a.score);
    validVariants = scored.map(s => s.v).slice(0, 5);
    best = validVariants[0];
  }


  // Si sigue sin haber ninguna válida → fallback local
  if (!validVariants.length) {
    const perFragment = fragments.map((f) => generateWordFromLetters(f));
    const localPhrase = perFragment.join(" ");
    const localFallbacks = generateVariantsFromLettersLocal(letters);
    validVariants = [localPhrase, ...localFallbacks];
    best = validVariants[0];
  }

  // =======================
  // RESPUESTA AL USUARIO
  // =======================
  const replyLines = [];
  replyLines.push("<b>Frases sugeridas</b>");
  validVariants.forEach((v, i) => {
    replyLines.push(`${i + 1}. ${v}`);
  });
  if (best) replyLines.push(`<b>MEJOR:</b> ${best}`);

  try {
    const sent = await bot.sendMessage(chatId, replyLines.join("\n"), {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔁 Otra secuencia", callback_data: "fonetico:again" }],
          [{ text: "🏠 Volver al menú", callback_data: "fonetico:menu" }],
        ],
      },
    });
    console.log(
      "DEBUG phonetic: sent suggestions message id=",
      sent && sent.message_id
    );
    return sent;
  } catch (err) {
    console.error("ERROR sending suggestions message:", err);
    return;
  }
}

// ===========================================
// 🤖 REGISTRO DE COMANDOS TELEGRAM
// ===========================================
function registerPhonetic(bot) {
  // /asignar 1 A
  bot.onText(/\/asignar\s+(\S+)\s+(\S+)/i, (msg, match) => {
    const chatId = String(msg.chat.id);
    const numero = match[1];
    const letra = match[2].toUpperCase().slice(0, 1);
    db.run(
      `INSERT OR REPLACE INTO phonetic_mappings (chatId, numero, letra) VALUES (?, ?, ?)`,
      [chatId, numero, letra],
      (err) => {
        if (err)
          return bot.sendMessage(
            chatId,
            `❌ Error guardando mapping: ${err.message}`
          );
        bot.sendMessage(chatId, `✅ Asignado: ${numero} → ${letra}`);
      }
    );
  });

  // /ver_mapa
  bot.onText(/\/ver_mapa/i, (msg) => {
    const chatId = String(msg.chat.id);
    getUserMappings(chatId)
      .then((map) => {
        const keys = Object.keys(map).sort();
        if (!keys.length)
          return bot.sendMessage(
            chatId,
            `📭 No tienes mappings. Usa /asignar NUM LETRA`
          );
        const lines = keys.map((k) => `${k} → ${map[k]}`);
        bot.sendMessage(chatId, `<b>Tus mappings:</b>\n${lines.join("\n")}`, {
          parse_mode: "HTML",
        });
      })
      .catch((err) =>
        bot.sendMessage(
          chatId,
          `❌ Error leyendo mappings: ${err.message}`
        )
      );
  });

  // /borrar_mapa
  bot.onText(/\/borrar_mapa/i, (msg) => {
    const chatId = String(msg.chat.id);
    db.run(
      `DELETE FROM phonetic_mappings WHERE chatId = ?`,
      [chatId],
      (err) => {
        if (err)
          return bot.sendMessage(
            chatId,
            `❌ Error borrando mappings: ${err.message}`
          );
        bot.sendMessage(chatId, `🧹 Tus mappings han sido borrados.`);
      }
    );
  });

  // /palabras 123
  bot.onText(/\/palabras\s+(\S+)/i, (msg, match) => {
    const chatId = String(msg.chat.id);
    const seq = match[1];
    generateWordsForSequence(chatId, seq, bot);
  });
}

// ===========================================
// 🧾 EXPORTS
// ===========================================
module.exports = {
  registerPhonetic,
  getUserMappings,
  generateWordsForSequence,
};
