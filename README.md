# Voice Assistant Builder demo

An AI builder that talks with the user, listens to their answers, and fills the
"Create Voice Assistant" form. It then writes the system prompt and saves the
assistant to the dashboard.

## What is real and what is demo

| Part | Status |
| --- | --- |
| Conversation, field filling, missing-detail analysis, system prompt, analytics fields | Real, done by Gemini |
| Speech input | Real, browser speech recognition (Chrome or Edge), with a text box fallback |
| Bot voice | Browser voice by default (best Indian English voice found, pick another in the demo bar). Gemini voice (Indian English, `en-in-concierge-2`) with the Bot voice toggle or `?geminivoice=1` |
| Document upload, validation, simulation | Demo only (animation) |
| Saving | Saved in the browser (localStorage), shown on the Assistants page |

Nothing is filled in until the user answers. If a Gemini call fails (quota, timeout, overload), the server first tries the next model. If that fails too, the demo bar shows "AI: offline" and the bot keeps going for about 20 seconds by writing down what the user says (it skips questions, stalls and bare yes/no), then tries Gemini again. The scripted self-playing run only starts if you switch Mode to scripted.

## Files

- `index.html` the whole user interface
- `api/agent.js` server function for Vercel
- `api/_core.js` the agent logic and Gemini calls (shared)
- `server.js` plain Node server for Render or local use

## Environment variables

- `GEMINI_API_KEY` (required)
- `GEMINI_MODEL` (optional, default tries `gemini-3.5-flash-lite` then `gemini-3.8-flash`)
- `GEMINI_TTS_VOICE` (optional, default `en-in-concierge-2`, female Indian English). Other Indian voices: `en-in-csagent-5`, `en-in-assistant-3`, `en-in-podcaster-4`, or list them with `GET https://generativelanguage.googleapis.com/v1beta/voices?language_code=en-IN`
- `GEMINI_TTS_MODEL` (optional, default tries `gemini-3.8-flash-lite-tts` then `gemini-3.8-flash-tts`)

### Free tier limits (measured October 2026)

- Text: about 15 requests a minute per model. A conversation uses one request per answer, so this is fine; a 429 moves to the next model.
- Voice: 3 requests a minute per TTS model, and every bot line is one request. That is why the Gemini voice is off by default: on the free tier it runs out within a minute and the page switches to the browser voice. Turn it on for demos only with a paid key. It also adds about 5 seconds before each bot line.

Never put the key in `index.html` or commit it. `.env` is in `.gitignore`.

## Deploy on Vercel (free Hobby plan)

1. Put this folder in a GitHub repository, or run `npx vercel` inside it.
2. In Vercel: Add New Project, import the repository. Framework preset: Other. No build command.
3. Project Settings, Environment Variables: add `GEMINI_API_KEY`.
4. Deploy, then open the link in Chrome or Edge and allow the microphone.

## Deploy on Render (free web service)

1. New, Web Service, connect the repository.
2. Runtime: Node. Build command: leave empty (or `npm install`). Start command: `node server.js`.
3. Instance type: Free. Add the environment variable `GEMINI_API_KEY`.
4. Free Render services sleep after about 15 minutes without traffic and take up to a
   minute to wake. Open the link a few minutes before you present.

## Run locally

```
cp .env.example .env      # then paste your key into .env
node server.js            # open http://localhost:3000
```

Always use http://localhost:3000, not the `index.html` file. Opened as a file, Chrome asks for the microphone before every answer and Gemini cannot be reached. If the server is running, the file version now switches to localhost by itself.

`MOCK_AGENT=1 node server.js` runs without a key, using a simple built-in mock.

## Demo bar

- Restart: start the flow again
- Mode: live AI or scripted (scripted plays sample answers by itself)
- Bot voice: browser or Gemini

URL options: `?scripted=1` starts in scripted mode, `?mute=1` starts with sound off, `?geminivoice=1` starts with the Gemini voice.

## Browser voice and microphone

- Use Chrome or Edge. Speech recognition runs in `en-IN` and starts only after the bot has finished speaking.
- Default bot voice in Chrome: Google हिन्दी (hi-IN), which reads English with an Indian accent. A voice picked in the demo bar is remembered instead.
- Where Google हिन्दी is missing, the best Indian voice is used: Edge has Microsoft Neerja Online (Natural), female, and Prabhat, male. Chrome on a Mac has only Rishi, male. Chrome on Windows has Microsoft Heera, female, and Ravi, male.
