# Voice Assistant Builder demo

An AI builder that talks with the user, listens to their answers, and fills the
"Create Voice Assistant" form. It then writes the system prompt and saves the
assistant to the dashboard.

## What is real and what is demo

| Part | Status |
| --- | --- |
| Conversation and field filling | Real: Gemini Live (`gemini-3.8-live`) over one WebSocket per build. Gemini hears the mic, speaks in an Indian English voice and fills fields through tool calls |
| Missing-detail analysis, system prompt, analytics fields | Real, Gemini text models (the Live model answers only in audio) |
| Dashboard cards | Edit and Configure reopen the builder with the saved values, Duplicate, Delete. Call is demo only: nothing is dialled |
| Speech input and bot voice | Gemini Live hears the microphone and answers in its own Indian English voice (`en-in-concierge-2`). You can also type answers. There is no backup voice |
| Form | One scrolling page: Basics, then the system prompt section, then the generated prompt and analytics. Editing a saved assistant shows Save changes and keeps nothing until it is pressed |
| Company documents | Real: PDF and images go to Gemini, Word and text files are read in the browser (up to 3 files, about 3 MB). The analysis fills details it finds in them and asks only for what is still missing; their key facts go into the system prompt |
| System prompt upload, validation, simulation | Demo only (animation) |
| Saving | Saved in the browser (localStorage), shown on the Assistants page |

Nothing is filled in until the user answers. If a Gemini call fails (quota, timeout, overload), the server first tries the next model. If that fails too, the demo bar shows "AI: offline" and the bot keeps going for about 20 seconds by writing down what the user says (it skips questions, stalls and bare yes/no), then tries Gemini again. The scripted self-playing run only starts if you switch Mode to scripted.

## Build-with-me flow

1. The bot asks: build it with me, or manually? Manual opens the form straight away.
2. Build with me: voice only. The bot asks every question by voice, including the extra ones the analysis finds missing, and fills the form behind the scenes. Only a progress line is shown.
3. The form opens, filled in, when the person has to do something by hand: upload company documents (generate path) or upload a system prompt (upload path). The bot points at the upload box.
4. After the documents are uploaded (or skipped), the analysis reads them with the answers. Details found in the documents are filled in and marked "From documents"; the bot asks only for what is still missing.
5. Then generate, review and save as before. Pausing the bot also opens the form.

## How the Live connection works

1. Create Assistant asks for the mic once, then the page asks `/api/agent` (`kind: live`) for a short-lived token.
2. The server creates the token with the bot's instructions, tools and voice locked in, so the page cannot change them and never sees the API key.
3. The browser opens one WebSocket straight to Gemini Live and keeps it for the whole build. It is closed after the assistant is saved, or when the builder is closed.
4. The mic is not streamed while the bot's audio plays, so the bot does not hear itself.
5. If the connection drops, stops replying for 12 seconds, or Google announces it will close the session, the page reconnects by itself (same model and voice) and the bot continues from the current question. If it cannot reconnect after several tries, the bot shows Try again; answers given so far are kept.

This works on Vercel because the WebSocket goes from the browser to Google, not through a Vercel function.

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
- `GEMINI_LIVE_MODEL` (optional, default `gemini-3.8-live`)
- `GEMINI_LIVE_VOICE` (optional, default `GEMINI_TTS_VOICE` or `en-in-concierge-2`)

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

`MOCK_AGENT=1 node server.js` runs the analysis and prompt writer without a key, using a simple built-in mock. The voice conversation needs a real key (Gemini Live has no mock).

## Demo bar

Hidden by default. Click the small round button at the bottom right to show it, or open the page with `?demo=1`.


- Restart: start the flow again
- Mode: live AI or scripted (scripted plays sample answers by itself, with the browser voice; it is a separate demo mode, not a backup)
- Bot voice and the voice list: only used by scripted mode

URL options: `?scripted=1` starts in scripted mode, `?mute=1` starts with sound off, `?geminivoice=1` starts with the Gemini voice.

## Browser voice and microphone

- Use Chrome or Edge. Speech recognition runs in `en-IN` and starts only after the bot has finished speaking.
- Default bot voice in Chrome: Google हिन्दी (hi-IN), which reads English with an Indian accent. A voice picked in the demo bar is remembered instead.
- Where Google हिन्दी is missing, the best Indian voice is used: Edge has Microsoft Neerja Online (Natural), female, and Prabhat, male. Chrome on a Mac has only Rishi, male. Chrome on Windows has Microsoft Heera, female, and Ravi, male.
