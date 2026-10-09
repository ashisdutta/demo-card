'use strict';
/*
 * Shared agent logic. Used by api/agent.js (Vercel) and server.js (Render / local).
 * The Gemini key is read from the GEMINI_API_KEY environment variable and never sent to the browser.
 */

const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

const ACTIONS = {
  intro: ['build_with_ai', 'build_manually'],
  basics: ['upload_prompt', 'generate_with_ai'],
  details: [],
  extra: ['generate_prompt'],
  upload: ['validate'],
  result: ['save']
};

const STAGE_HINT = {
  intro: 'There are no fields yet. The person is choosing between you building the assistant with them (action build_with_ai) and filling the form by hand (action build_manually). Decide by meaning, not exact wording; any phrasing, word order or speech recognition slip that means the same thing counts. build_with_ai examples: "build with you", "let us build it with you", "let us do it together", "you build it", "you do it", "do it for me", "help me build it", "AI please", "automatic", "the AI way", "bill with you" (misheard build), "go ahead", "yes". build_manually examples: "manual", "manually", "I will build it myself", "let me do it", "I will fill it in", "I will type it", "I would rather fill the form". Only ask again if the answer fits neither, for example a greeting or an unrelated question.',
  basics: 'Ask for each empty field in order. When every field is filled, ask whether they already have a system prompt to upload or want you to generate one with them, then use action upload_prompt or generate_with_ai. Never use those actions while a required field is still empty.',
  details: 'Ask for each empty field in order. The field "docs" is a file upload that only the person can do: ask whether they want to add documents; if yes, tell them to click the upload box and wait (no update); if they say no, set docs to "skip". A user message like "[I uploaded the file x.pdf]" means it is done, so move on. When every field is filled or skipped, say only that you will now check what you have.',
  extra: 'These extra details were found missing after analysis. Ask for each empty one. When all are filled, ask whether you should generate the prompt. If they agree, use action generate_prompt.',
  upload: 'A system prompt file is attached. Ask whether you should validate and test it. If they agree, use action validate.',
  result: 'The prompt, analytics fields and analytics persona are ready. The person can ask you to add analytics fields (use add_analytics) or to save the assistant (action save). For changes to the prompt text, tell them to press Edit prompt.'
};

const TURN_SYSTEM = [
  'You are the voice setup assistant inside a "Create Voice Assistant" form on a voice AI platform.',
  'You talk with the person who is building a phone assistant and you fill in the form for them.',
  'Your words are read aloud by text to speech, so write plain spoken sentences: no markdown, no lists, no emojis, no quotation marks.',
  '',
  'Each turn you receive JSON with: stage, stage_hint, fields (the form fields in the order to ask them, with their current values), last_bot (what you just said), asking (the id of the field you were asking about, if any), user (what the person just said, transcribed from speech, so it may contain recognition mistakes) and allowed_actions.',
  '',
  'At the intro, classify the meaning of the answer rather than matching exact words. Requests to build it with you, together, or for the person mean build_with_ai; requests to fill it in themselves mean build_manually. Paraphrases like "build with you" and "let us build it with you" express the same choice.',
  'Reply with one JSON object and nothing else, with exactly these keys:',
  '"updates": array of {"id","value"}. One entry for every field the user message answers. It can be several fields at once, or none. For a select field the value must be copied exactly from its options. For a text field write a clean value: fix capitalisation and obvious speech to text slips, keep it concise, keep the meaning. STRICT RULE: only fill a field with something the person actually said in this message. Never fill a field they have not answered, never guess, never use example or placeholder values, and never fill several fields from one short answer unless they really gave all of them. A bare yes, ok or go ahead fills nothing, unless you had just recommended one specific option for the field you were asking about; then fill that option. If they explicitly tell you to choose for them, you may pick a sensible value for that one field only. If they decline an optional field (required is false), use the value "skip". Never use "skip" or any placeholder for a required field: if they decline or dodge a required field, say briefly why it is needed and ask again. Never change a field that already has a value unless the person clearly corrects it in this message.',
  '"say": string. What you say next, one or two short sentences. Acknowledge briefly, then ask for the next field that is still empty, in the listed order, one field at a time. When a select field is next, mention the options or your recommendation in a few words. If the person asked you something, answer it in one sentence first. If you did not understand, ask again simply.',
  '"focus": string. The id of the field you are asking about now, or "" if none.',
  '"action": string. One of allowed_actions, or "none". Only pick an action when the person clearly asks for it and stage_hint allows it.',
  '"add_analytics": array of {"name","description","type"}. Only in stage "result", for analytics fields the person asks to add. name is snake_case, type is String, Number, Boolean or Date. Otherwise an empty array.'
].join('\n');

const ANALYZE_SYSTEM = [
  'You review the answers collected for the system prompt of a phone voice agent.',
  'You receive JSON with fields (label and value). Find the important details that are still missing: things callers of this kind of business will very likely need and that the fields do not already cover, for example working hours, how to hand off to a human, how bookings are made, or the service area.',
  'Reply with one JSON object and nothing else: {"missing":[{"id","label","question","placeholder"}]}.',
  'Return one or two items. id is snake_case. label is two to four words. question is one short spoken question with no markdown. placeholder is a short example answer.'
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
async function callModel(model, system, payload, maxTokens, temperature, ms, fast, ctl) {
  const timer = setTimeout(() => ctl.abort(), ms);
  const gen = { responseMimeType: 'application/json', temperature: temperature, maxOutputTokens: maxTokens };
  if (fast && /^gemini-3\.5/.test(model)) gen.thinkingConfig = { thinkingLevel: 'minimal' };
  try {
    const r = await fetch(ENDPOINT + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
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
      callModel(model, system, payload, maxTokens, temperature, ms || 10000, opts.fast, ctl).then((v) => finish(null, v), (e) => {
        running--; if (done) return; lastErr = e;
        if (!retryable(e)) return finish(e);
        console.warn('[gemini] ' + model + ': ' + e.message.slice(0, 120) + ', trying the next model');
        if (next < models.length) launch(); else if (!running) finish(lastErr || new Error('No Gemini model available'));
      });
    };
    launch();
  });
}

/* ---- optional Gemini text to speech (Interactions API). The browser falls back to its own voice if this fails. ---- */
// Default voice: female Indian English (en-IN) from the Gemini voice library (GET /v1beta/voices?language_code=en-IN).
// There is no "Nova" voice in the library. Override with GEMINI_TTS_VOICE, for example en-in-csagent-5 or en-in-assistant-3.
const DEFAULT_TTS_VOICE = 'en-in-concierge-2';
// Free tier allows only 3 requests a minute per TTS model, so the second model is a quota fallback.
const DEFAULT_TTS_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];

async function callTTS(text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { const e = new Error('GEMINI_API_KEY is not set on the server'); e.status = 500; throw e; }
  const voice = process.env.GEMINI_TTS_VOICE || DEFAULT_TTS_VOICE;
  const models = [process.env.GEMINI_TTS_MODEL].concat(DEFAULT_TTS_MODELS).filter((m, i, a) => m && a.indexOf(m) === i);
  let lastErr = null;
  for (const model of models) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          model: model,
          input: [{ type: 'user_input', content: [{ type: 'text', text: text }] }],
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice: voice }] }
        })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error((data.error && data.error.message) || ('Gemini TTS returned ' + r.status)), { status: r.status });
      let found = null;
      (function walk(o) { if (found || !o || typeof o !== 'object') return; if (o.type === 'audio' && typeof o.data === 'string') { found = o; return; } Object.keys(o).forEach((k) => walk(o[k])); })(data);
      if (!found) throw Object.assign(new Error('Gemini TTS returned no audio'), { status: 502 });
      return { audio: found.data, mime: found.mime_type || 'audio/wav', voice: voice };
    } catch (e) {
      lastErr = e.name === 'AbortError' ? Object.assign(new Error('Gemini TTS timed out'), { status: 504 }) : e;
      if (!retryable(lastErr)) break;
      console.warn('[tts] ' + model + ': ' + lastErr.message.slice(0, 120) + ', trying the next model');
    } finally { clearTimeout(timer); }
  }
  throw Object.assign(lastErr || new Error('No Gemini TTS model available'), { status: lastErr && lastErr.status === 429 ? 429 : 502 });
}

/* ---- Gemini Live: one WebSocket per build, opened by the browser straight to Gemini with a short-lived token.
   The instructions, tools and voice are locked into the token here, so the key and the bot's rules never reach the page.
   gemini-3.8-live answers only in audio, so the system prompt and the analysis stay on the text models above. ---- */
const LIVE_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const LIVE_SYSTEM = [
  'You are the voice setup assistant inside a "Create Voice Assistant" form on a voice AI platform. You talk with the person who is building a phone assistant and you fill in the form for them while they watch.',
  'Speak natural Indian English. Keep every turn to one or two short sentences and ask for one field at a time. No lists, no markdown.',
  '',
  'Messages that start with [App] come from the app, not from the person. They tell you what is on screen and what to ask. Never read them aloud and never mention the app. When an [App] message or a tool result contains "Say:" followed by a line, say that line in your own natural words, keep its meaning, and add nothing else.',
  '',
  'The form changes only through your tools. Whenever the person answers a field, call update_form before you speak, then follow the next instruction in its result. Never say a field is set unless update_form returned ok. Rules for update_form: only write what the person actually said in their latest answer; never guess, never use examples or placeholders, never fill a field they did not answer. For a select field copy one of its options exactly. Clean up capitalisation and obvious speech recognition slips. A bare yes, ok or go ahead fills nothing, unless you just recommended one specific option for the field you were asking about; then fill that option. If they decline an optional field use the value skip; never skip a required field, instead say briefly why it is needed and ask again. If they correct an earlier answer, update that field. If they ask you something, answer in one sentence and ask again.',
  '',
  'Call press_button only when the person clearly asks for it. At the start: build_with_ai if they want you to build it with them (any wording: build with you, let us build it with you, do it together, you do it, do it for me, AI please, automatic, go ahead, yes, or a misheard version like bill with you) or build_manually if they want to fill it in themselves (manual, myself, let me do it, I will type it). After the basics: upload_prompt or generate_with_ai. After the details: generate_prompt. After an upload: validate. At the end: save. After press_button, follow the Say line in its result.',
  'Only the person can upload files: if they want to add a document, tell them to click the upload box. Use add_analytics_field only when they ask for an extra analytics field at the end.'
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
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_LIVE_VOICE || process.env.GEMINI_TTS_VOICE || DEFAULT_TTS_VOICE } } } },
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
  const user = String(b.user || ''); const fields = b.fields || []; const out = { updates: [], say: '', focus: '', action: 'none', add_analytics: [] };
  const empty = () => fields.filter((f) => !f.value);
  if (b.stage === 'intro') {
    if (/\b(manual|myself|by myself|on my own|fill it in|fill this in|i will do it|i'll do it)\b/i.test(user)) out.action = 'build_manually';
    else if (/\b(with you|together|for me|you can|you do it|go ahead|please do|build|create|make|yes|yeah|yep|sure|okay|ok)\b/i.test(user)) out.action = 'build_with_ai';
    else out.say = 'Would you like me to build it with you, or would you rather fill it in yourself?';
    return out;
  }
  if (b.stage === 'result') { if (/save/i.test(user)) out.action = 'save'; else if (/add/i.test(user)) { out.add_analytics = [{ name: 'preferred_time', description: 'Time of day the caller prefers', type: 'String' }]; out.say = 'Added. Anything else, or shall I save it?'; } else out.say = 'Shall I save it?'; return out; }
  if (b.stage === 'upload') { out.action = /yes|ok|sure|go/i.test(user) ? 'validate' : 'none'; out.say = 'Shall I validate it?'; return out; }
  const first = empty()[0];
  if (first) {
    let v = user;
    if (first.type === 'file') v = /\[I uploaded/.test(user) ? '' : 'skip';
    else if (first.options) v = first.options.filter((o) => user.toLowerCase().split(/\W+/).some((w) => w.length > 3 && o.toLowerCase().includes(w)))[0] || first.options[0];
    else if (!first.required && /^(no|none|skip)/i.test(user)) v = 'skip';
    if (v) { out.updates.push({ id: first.id, value: v }); first.value = v; }
    else if (first.type === 'file') first.value = 'done';
  } else {
    if (b.stage === 'basics') out.action = /upload/i.test(user) ? 'upload_prompt' : 'generate_with_ai';
    if (b.stage === 'extra') out.action = 'generate_prompt';
    return out;
  }
  const next = empty()[0];
  if (next) { out.say = 'Got it. What about ' + next.label.toLowerCase() + '?'; out.focus = next.id; }
  else out.say = b.stage === 'basics' ? 'Do you want to upload a system prompt, or should I generate one?' : (b.stage === 'extra' ? 'Shall I generate the prompt?' : 'Let me check what I have.');
  return out;
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
    if (!['turn', 'analyze', 'prompt', 'tts', 'ping', 'live'].includes(kind)) return { status: 400, json: { error: 'Unknown kind' } };
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
    if (kind === 'tts') {
      if (process.env.MOCK_AGENT) return { status: 501, json: { error: 'No voice in mock mode' } };
      const text = clip(b.text, 500).trim();
      if (!text) return { status: 400, json: { error: 'No text' } };
      return { status: 200, json: await callTTS(text) };
    }
    if (process.env.MOCK_AGENT) return { status: 200, json: mock(kind, Object.assign({}, b, { fields: fields })) };

    if (kind === 'analyze') {
      const r = await callGemini(ANALYZE_SYSTEM, { fields: fields.map((f) => ({ label: f.label, value: f.value })) }, 1024, 0.3, 10000, { fast: true, hedge: 4000 });
      const missing = arr(r.missing).slice(0, 2).map((m) => ({ id: clip(m.id, 30), label: clip(m.label, 40), question: clip(m.question, 160), placeholder: clip(m.placeholder, 80) })).filter((m) => m.label && m.question);
      return { status: 200, json: { missing: missing } };
    }
    if (kind === 'prompt') {
      const r = await callGemini(PROMPT_SYSTEM, { fields: fields.map((f) => ({ label: f.label, value: f.value })) }, 4096, 0.5, 18000, { hedge: 12000 });
      return { status: 200, json: {
        prompt: clip(r.prompt, 8000),
        analytics: arr(r.analytics).slice(0, 8).map((a) => ({ name: clip(a.name, 40), description: clip(a.description, 160), type: clip(a.type, 10) })),
        persona: clip(r.persona, 600)
      } };
    }
    const stage = ACTIONS[b.stage] ? b.stage : 'basics';
    const allowed = ACTIONS[stage];
    const r = await callGemini(TURN_SYSTEM, {
      stage: stage, stage_hint: STAGE_HINT[stage], allowed_actions: allowed.concat('none'),
      fields: fields, last_bot: clip(b.last_bot, 500), asking: clip(b.focus, 40), user: clip(b.user, 800)
    }, 2048, 0.3, 9000, { fast: true, hedge: 2500 });
    // Backstop for the prompt rules: only known fields, and never "skip" on a required field.
    const byId = {}; fields.forEach((f) => { byId[f.id] = f; });
    const updates = arr(r.updates).slice(0, 12).map((u) => ({ id: clip(u && u.id, 40), value: clip(u && u.value, 1500).trim() }))
      .filter((u) => byId[u.id] && u.value && !(byId[u.id].required && /^(skip|skipped|none|n\/a|no)$/i.test(u.value)));
    return { status: 200, json: {
      updates: updates,
      say: clip(r.say, 400), focus: clip(r.focus, 40),
      action: allowed.includes(r.action) ? r.action : 'none',
      add_analytics: arr(r.add_analytics).slice(0, 4).map((a) => ({ name: clip(a.name, 40), description: clip(a.description, 160), type: clip(a.type, 10) }))
    } };
  } catch (e) {
    return { status: e.status || 500, json: { error: clip(e.message || 'Agent error', 300) } };
  }
}

module.exports = { handle };
