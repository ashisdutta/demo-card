# Handoff prompt for Claude Code

Paste everything below the line into Claude Code, opened in this project folder.

---

You are continuing work on a demo web app in this folder. Read `README.md`, `index.html`, `api/_core.js`, `api/agent.js` and `server.js` before changing anything.

## What the app is

A demo of an "AI builder" for a voice-AI platform. On the Assistants dashboard the user clicks Create Assistant. A voice bot appears, asks whether to build manually or have the bot build it, then a form slides out beside the bot. The bot asks one question at a time, the user answers by voice (or typing), and the answer is written into the matching form field while the user watches. At the end Gemini writes the system prompt and the assistant is saved to the dashboard.

Flow:
1. Intro: bot only. "Build manually, or should I build it for you?"
2. Card 1, Basics: assistant name, phone number (bot suggests numbers), Standard/Premium voice mode, voice (different list per mode), then two buttons: Upload system prompt / Generate with AI.
3. Card 2, upload path: only an upload area.
4. Card 2, generate path: company name, domain or industry, agent name, agent role, agent goal, language requirements, agent tone, documents upload, optional guidelines or restrictions.
5. Analysis popup: the model finds missing details, the page creates input boxes for them on the fly, the bot asks and fills them, then asks "shall I generate the prompt?" and presses Generate Prompt itself on yes.
6. Processing popup: building, validating, simulating the system prompt (animation only).
7. Card 3: generated prompt, analytics fields (Field Name, Description, Type, remove, Add Field) and Analytics Persona.
8. Save Voice Assistant: stored in localStorage and shown as a card on the dashboard.

## Architecture

- `index.html`: all UI and client logic in one file, vanilla JS, no build step.
  - `SIMS` = scripted self-playing demo. `LIVE` = real conversation. `SCRIPT` picks between them from the `live` flag.
  - `converse()` is the live loop: say, listen, call the agent, apply updates, repeat.
  - `listen()` uses browser speech recognition (`en-IN`) with a text box fallback.
  - `agent()` posts to `/api/agent`. If a turn fails it sets `aiDown` and uses `localTurn()`, an offline note-taker that writes down only what the user said.
  - `speak()` uses Gemini text to speech when "Bot voice: Gemini" is on, otherwise the browser voice chosen in the demo bar.
- `api/_core.js`: Gemini calls. Kinds: `turn`, `analyze`, `prompt`, `tts`, `ping`. Key comes from the `GEMINI_API_KEY` environment variable. `MOCK_AGENT=1` runs a built-in mock without a key.
- `api/agent.js`: Vercel function wrapper. `server.js`: plain Node server for Render or local use.

## Hard rules

- Never fill a field until the user has answered it. No auto-filled sample values in live mode. The scripted run must only start when the user switches Mode to scripted.
- Never put the API key in client code or commit it. Read it from the environment only.
- Keep the look: white UI, violet accent `#6B54E3`, light violet voice column split from the form by a vertical line, dot-matrix orb that glows while the bot speaks.
- Keep it a no-build project that deploys to Vercel (static `index.html` + `api/`) and to Render (`node server.js`).
- Document upload, validation and simulation stay demo-only.

## State of testing

- Tested end to end with `MOCK_AGENT=1` and typed answers in headless Chromium: passes.
- NOT tested against the real Gemini API, real microphone input, or real audio output. These need testing first.

## Tasks, in order

1. Create `.env` from `.env.example` with my Gemini key, run `node server.js`, open http://localhost:3000 in Chrome and check the demo bar shows "AI: live". If it shows offline, read the error (hover the status, or check the `/api/agent` response) and fix the cause: key format, model id in `DEFAULT_MODELS`, or request shape. Check current model ids at https://ai.google.dev/gemini-api/docs/models.
2. Run a full live conversation and confirm each answer lands in the right field, nothing is filled before I answer, and the bot asks one field at a time. Tighten `TURN_SYSTEM` in `api/_core.js` if the model fills fields I did not answer.
3. Bot voice: I want an Indian English voice. Test the Gemini TTS path (`callTTS` and `pickVoice` in `api/_core.js`, Interactions API, docs at https://ai.google.dev/gemini-api/docs/speech-generation). List the voice library (`GET /v1beta/voices`) to find a voice that sounds Indian, or the voice I call "Nova 3" if it exists there, and set it as the default. If Gemini has no suitable voice, make the browser fallback pick the best Indian voice and tell me what the options are.
4. Check speech recognition works for Indian English and that the bot does not hear itself (listening must start only after the bot stops speaking).
5. Fix anything broken you find on the way, then give me the exact steps to deploy on Vercel's free plan with the key as an environment variable.

Tell me what you verified by actually running it and what you could not verify.
