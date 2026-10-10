'use strict';
/*
 * Shared agent logic. Used by api/agent.js (Vercel) and server.js (Render / local).
 * The Gemini key is read from the GEMINI_API_KEY environment variable and never sent to the browser.
 */

const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

const ANALYZE_SYSTEM = [
  'You review the answers collected for the system prompt of a phone voice agent, together with any company documents attached after the JSON (price lists, FAQs, service details).',
  'You receive JSON with fields (label and value). Decide which important details callers of this kind of business will very likely need, for example working hours, how to hand off to a human, how bookings are made, prices, or the service area.',
  'Reply with one JSON object and nothing else: {"missing":[{"id","label","question","placeholder"}],"found":[{"id","label","value"}],"facts":""}.',
  '"missing": one or two of those details that neither the answers nor the documents cover. If the documents answer something, it is not missing. Ask only about how the business operates, such as working hours, human handoff, how bookings or visits are made, or the service area. Never ask about prices, charges, fees, deposits, booking amounts, maintenance charges, discounts or any other money amounts (those come only from documents), and never ask about guidelines or restrictions (already covered). id is snake_case, label is two to four words, question is one short spoken question with no markdown, placeholder is a short example answer.',
  '"found": up to four of those details that the answers do not cover but the documents do, with a short value taken faithfully from the documents. Never invent a value. Empty when there are no documents.',
  '"facts": the key facts from the documents that the voice agent will need on calls (services, prices, policies, hours, contacts), as short plain sentences, at most 150 words. Empty string when there are no documents.'
].join('\n');

const PROMPT_SYSTEM = [
  'You write production system prompts for phone voice agents.',
  'You receive JSON with fields (label and value) collected from the business. Use only these facts. Where a needed fact is missing, write a bracketed placeholder such as [WORKING HOURS]. Ignore values that are "skip".',
  'Reply with one JSON object and nothing else: {"prompt","analytics","persona"}.',
  '"prompt": the system prompt as plain text with markdown headings, 250 to 400 words, with these sections: 1. Identity and Core Mission, 2. Call Flow (numbered steps), 3. Business Facts, 4. Guardrails and Human Handoff, 5. Voice Style (one or two sentences per turn, numbers and prices spoken as words, never invent facts). Start with a title line "# System Prompt: <company> Voice Assistant".',
  '"analytics": five or six fields worth extracting from every call for this business, each {"name","description","type"}; name is snake_case, type is String, Number, Boolean or Date.',
  '"persona": two sentences starting with "You are analyzing calls for", describing the business and what to pay attention to.'
].join('\n');

const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

// Company documents sent with the analysis: PDFs and images go to Gemini as files, text arrives already extracted
// by the browser (txt, md, csv, docx). At most 3 files and about 3 MB, to stay under the Vercel request limit.
const DOC_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
function docParts(list) {
  const out = []; let budget = 4.2e6;
  arr(list).slice(0, 3).forEach((d) => {
    const name = clip(d && d.name, 120) || 'document';
    if (d && typeof d.text === 'string' && d.text.trim()) { out.push({ text: 'Document: ' + name }, { text: clip(d.text, 40000) }); return; }
    if (d && typeof d.data === 'string' && DOC_TYPES.includes(d.mime) && d.data.length <= budget) { budget -= d.data.length; out.push({ text: 'Document: ' + name }, { inlineData: { mimeType: d.mime, data: d.data } }); }
  });
  return out;
}
const arr = (v) => (Array.isArray(v) ? v : []);

function cleanFields(list) {
  return arr(list).slice(0, 30).map((f) => {
    const o = {
      id: clip(f && f.id, 40), label: clip(f && f.label, 80), type: clip(f && f.type, 12) || 'text',
      required: !(f && f.required === false), value: clip(f && f.value, 1500)
    };
    if (f && Array.isArray(f.options)) o.options = f.options.slice(0, 12).map((x) => clip(x, 80));
    return o;
  });
}

function parseJson(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('Model did not return JSON');
}

// Errors worth retrying on the next model: unknown model, per-model quota (free tier is about 15 requests a minute), overload, timeout.
const retryable = (e) => [404, 429, 500, 503, 504].includes(e.status) || /not found|not supported/i.test(e.message);

// One request to one model. fast turns off "thinking" where the model allows it (gemini-3.5 models; 3.8 rejects it):
// with thinking, gemini-3.5-flash spends about 300 tokens and a second or two on a simple form turn.
async function callModel(model, system, payload, maxTokens, temperature, ms, fast, ctl, extra) {
  const timer = setTimeout(() => ctl.abort(), ms);
  const gen = { responseMimeType: 'application/json', temperature: temperature, maxOutputTokens: maxTokens };
  if (fast && /^gemini-3\.5/.test(model)) gen.thinkingConfig = { thinkingLevel: 'minimal' };
  try {
    const r = await fetch(ENDPOINT + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }].concat(extra || []) }],
        generationConfig: gen
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ('Gemini returned ' + r.status);
      throw Object.assign(new Error(msg.split('\n')[0]), { status: r.status });
    }
    const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
    return parseJson(parts.map((p) => p.text || '').join(''));
  } catch (e) {
    throw e.name === 'AbortError' ? Object.assign(new Error('Gemini timed out'), { status: 504 }) : e;
  } finally { clearTimeout(timer); }
}

// Tries the models in order. A model that fails moves on to the next one at once, and with opts.hedge a model that is
// slow (Gemini load spikes can push one model to 10 s or more) gets the next model started in parallel after
// opts.hedge ms. The first good answer wins and the others are cancelled.
function callGemini(system, payload, maxTokens, temperature, ms, opts) {
  opts = opts || {};
  if (!process.env.GEMINI_API_KEY) return Promise.reject(Object.assign(new Error('GEMINI_API_KEY is not set on the server'), { status: 500 }));
  const models = [process.env.GEMINI_MODEL].concat(DEFAULT_MODELS).filter((m, i, a) => m && a.indexOf(m) === i);
  return new Promise((resolve, reject) => {
    let next = 0, running = 0, done = false, lastErr = null, hedgeTimer = null;
    const ctls = [];
    const finish = (err, val) => {
      if (done) return; done = true; clearTimeout(hedgeTimer); ctls.forEach((c) => c.abort());
      if (err) { if (err.status !== 429) err.status = 502; reject(err); } else resolve(val);
    };
    const launch = () => {
      if (done || next >= models.length) return;
      const model = models[next++]; const ctl = new AbortController(); ctls.push(ctl); running++;
      clearTimeout(hedgeTimer);
      if (opts.hedge && next < models.length) hedgeTimer = setTimeout(launch, opts.hedge);
      callModel(model, system, payload, maxTokens, temperature, ms || 10000, opts.fast, ctl, opts.parts).then((v) => finish(null, v), (e) => {
        running--; if (done) return; lastErr = e;
        if (!retryable(e)) return finish(e);
        console.warn('[gemini] ' + model + ': ' + e.message.slice(0, 120) + ', trying the next model');
        if (next < models.length) launch(); else if (!running) finish(lastErr || new Error('No Gemini model available'));
      });
    };
    launch();
  });
}

// Bot voice for Gemini Live: female Indian English (en-IN) from the Gemini voice library (GET /v1beta/voices?language_code=en-IN).
// Only gemini-3.8-live accepts these voices. Override with GEMINI_LIVE_VOICE, for example en-in-csagent-5 or en-in-assistant-3.
const DEFAULT_LIVE_VOICE = 'en-in-concierge-2';

/* ---- Gemini Live: one WebSocket per build, opened by the browser straight to Gemini with a short-lived token.
   The instructions, tools and voice are locked into the token here, so the key and the bot's rules never reach the page.
   gemini-3.8-live answers only in audio, so the system prompt and the analysis stay on the text models above. ---- */
const LIVE_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const LIVE_SYSTEM = [
  'You are the voice setup assistant inside a "Create Voice Assistant" form on a voice AI platform. You talk with the person who is building a phone assistant and you fill in the form for them while they watch.',
  'Always speak natural Indian English, in English only. Never switch to Hindi, Hinglish or any other language, even if the person uses one; if they answer in another language, write the value in English and keep speaking English. Keep every turn to one or two short sentences and ask for one field at a time. No lists, no markdown.',
  '',
  'Messages that start with [App] come from the app, not from the person. They tell you what is on screen and what to ask. Never read them aloud and never mention the app. When an [App] message or a tool result contains "Say:" followed by a line, say that line in your own natural words, keep its meaning, and add nothing else.',
  '',
  'The form changes only through your tools. Whenever the person answers a field, call update_form before you speak, then follow the next instruction in its result. Never say a field is set unless update_form returned ok. Rules for update_form: only write what the person actually said in their latest answer; never guess, never use examples or placeholders, never fill a field they did not answer. For a select field copy one of its options exactly. Clean up capitalisation and obvious speech recognition slips. A bare yes, ok or go ahead fills nothing, unless you just recommended one specific option for the field you were asking about; then fill that option. If they decline an optional field use the value skip; never skip a required field, instead say briefly why it is needed and ask again. If they correct an earlier answer, update that field. If they ask you something, answer in one sentence and ask again.',
  '',
  'Call press_button only when the person clearly asks for it. At the start: build_with_ai if they want you to build it with them (any wording: build with you, let us build it with you, do it together, you do it, do it for me, AI please, automatic, go ahead, yes, or a misheard version like bill with you) or build_manually if they want to fill it in themselves (manual, myself, let me do it, I will type it). After the basics: upload_prompt or generate_with_ai. After the details: generate_prompt. After an upload: validate. At the end: save. After press_button, follow the Say line in its result.',
  'Only the person can upload files: if they want to add a document, tell them to click the upload box. Uploading documents is optional: if at that step they say no, skip, or ask you to generate without uploading, call update_form with docs = skip. Use add_analytics_field only when they ask for an extra analytics field at the end.',
  'While you collect the answers by voice the form is hidden, so describe choices in words and never say things like you can see it on screen. The app opens the form, already filled in, when the person has to upload something.'
].join('\n');
const LIVE_TOOLS = [{ functionDeclarations: [
  { name: 'update_form', description: 'Write the person\'s answers into form fields. Returns ok, the current form and what to ask next.',
    parameters: { type: 'OBJECT', properties: { updates: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING', description: 'Field id' }, value: { type: 'STRING' } }, required: ['id', 'value'] } } }, required: ['updates'] } },
  { name: 'press_button', description: 'Press a button in the form for the person.',
    parameters: { type: 'OBJECT', properties: { button: { type: 'STRING', enum: ['build_with_ai', 'build_manually', 'upload_prompt', 'generate_with_ai', 'generate_prompt', 'validate', 'save'] } }, required: ['button'] } },
  { name: 'add_analytics_field', description: 'Add an analytics field to the generated assistant.',
    parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: 'snake_case' }, description: { type: 'STRING' }, type: { type: 'STRING', enum: ['String', 'Number', 'Boolean', 'Date'] } }, required: ['name', 'description', 'type'] } }
] }];

async function liveToken() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY is not set on the server'), { status: 500 });
  const model = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
  const now = Date.now();
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      uses: 1, expireTime: new Date(now + 30 * 60e3).toISOString(), newSessionExpireTime: new Date(now + 60e3).toISOString(),
      bidiGenerateContentSetup: {
        model: 'models/' + model,
        generationConfig: { responseModalities: ['AUDIO'], temperature: 0.4,
          speechConfig: { languageCode: 'en-IN', voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_LIVE_VOICE || DEFAULT_LIVE_VOICE } } } },
        systemInstruction: { parts: [{ text: LIVE_SYSTEM }] },
        tools: LIVE_TOOLS,
        inputAudioTranscription: {}, outputAudioTranscription: {}
      }
    })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.name) throw Object.assign(new Error((d.error && d.error.message) || 'Could not create a Gemini Live token'), { status: r.status === 429 ? 429 : 502 });
  return { token: d.name, model: model, url: LIVE_WS };
}

/* ---- offline mock (MOCK_AGENT=1) so the UI can be tested without a key ---- */
function mock(kind, b) {
  if (kind === 'analyze') return { missing: [{ id: 'working_hours', label: 'Working hours', question: 'What are your working hours?', placeholder: 'Mon to Fri, 9 am to 6 pm' }, { id: 'human_handoff', label: 'Human handoff', question: 'Who should take over when a caller needs a human?', placeholder: 'Front desk line' }] };
  if (kind === 'prompt') {
    const get = (l) => ((b.fields || []).filter((f) => f.label === l)[0] || {}).value || '[' + l.toUpperCase() + ']';
    return { prompt: '# System Prompt: ' + get('Company name') + ' Voice Assistant\n\n## 1. Identity and Core Mission\nYou are ' + get('Sales representative name') + ', the ' + get('Agent role') + '.\nGoal: ' + get('Agent goal') + '\n\n## 2. Call Flow\n1. Greet the caller.\n2. Ask how you can help.\n\n(Mock prompt: MOCK_AGENT is on.)', analytics: [{ name: 'caller_name', description: 'Name of the caller', type: 'String' }, { name: 'appointment_booked', description: 'Whether an appointment was booked', type: 'Boolean' }], persona: 'You are analyzing calls for ' + get('Company name') + '. Focus on what the caller wanted and how the call ended.' };
  }
  return {};
}

/* ---- tiny in-memory rate limit: protects the key on a public demo link ---- */
const hits = [];
function limited() {
  const now = Date.now();
  while (hits.length && now - hits[0] > 60000) hits.shift();
  if (hits.length >= 90) return true;
  hits.push(now); return false;
}

async function handle(body) {
  try {
    const b = body && typeof body === 'object' ? body : {};
    const kind = clip(b.kind, 12);
    if (!['analyze', 'prompt', 'ping', 'live'].includes(kind)) return { status: 400, json: { error: 'Unknown kind' } };
    if (limited()) return { status: 429, json: { error: 'Too many requests, try again in a minute' } };
    const fields = cleanFields(b.fields);
    if (kind === 'ping') {
      if (process.env.MOCK_AGENT) return { status: 200, json: { ok: true, model: 'mock' } };
      await callGemini('Reply with the JSON object {"ok":true} and nothing else.', { ping: 1 }, 256, 0, 10000, { fast: true });
      return { status: 200, json: { ok: true } };
    }
    if (kind === 'live') {
      if (process.env.MOCK_AGENT) return { status: 501, json: { error: 'No Gemini Live in mock mode' } };
      return { status: 200, json: await liveToken() };
    }
    if (process.env.MOCK_AGENT) return { status: 200, json: mock(kind, Object.assign({}, b, { fields: fields })) };

    if (kind === 'analyze') {
      const parts = docParts(b.docs);
      const r = await callGemini(ANALYZE_SYSTEM, { fields: fields.map((f) => ({ label: f.label, value: f.value })), documents_attached: parts.length / 2 }, 2048, 0.3, parts.length ? 25000 : 10000, { fast: true, hedge: parts.length ? 12000 : 4000, parts: parts });
      // backstop for the prompt: never ask the person for prices or for guidelines, whatever the model returns
      const banned = /price|pricing|charge|fee|cost|amount|deposit|rent|emi|discount|payment|rate|budget|guideline|restriction/i;
      const missing = arr(r.missing).filter((m) => m && !banned.test(String(m.label) + ' ' + String(m.question))).slice(0, 2).map((m) => ({ id: clip(m.id, 30), label: clip(m.label, 40), question: clip(m.question, 160), placeholder: clip(m.placeholder, 80) })).filter((m) => m.label && m.question);
      const found = parts.length ? arr(r.found).slice(0, 4).map((m) => ({ id: clip(m.id, 30), label: clip(m.label, 40), value: clip(m.value, 300) })).filter((m) => m.label && m.value) : [];
      return { status: 200, json: { missing: missing, found: found, facts: parts.length ? clip(r.facts, 1500) : '' } };
    }
    if (kind === 'prompt') {
      const r = await callGemini(PROMPT_SYSTEM, { fields: fields.map((f) => ({ label: f.label, value: f.value })) }, 4096, 0.5, 18000, { hedge: 12000 });
      return { status: 200, json: {
        prompt: clip(r.prompt, 8000),
        analytics: arr(r.analytics).slice(0, 8).map((a) => ({ name: clip(a.name, 40), description: clip(a.description, 160), type: clip(a.type, 10) })),
        persona: clip(r.persona, 600)
      } };
    }
    return { status: 400, json: { error: 'Unknown kind' } };
  } catch (e) {
    return { status: e.status || 500, json: { error: clip(e.message || 'Agent error', 300) } };
  }
}

module.exports = { handle };
