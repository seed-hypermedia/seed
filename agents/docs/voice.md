# Voice chat

Talk to an agent session instead of typing. The desktop composer's microphone button joins a LiveKit room for the
session; a speech worker in the same room transcribes what you say, runs it as a normal user message through the session
(tools, memory, model, collaborators all apply), and speaks the reply back. The transcript and the reply land in the
session's log like any typed turn.

Voice is off by default. Servers without it answer `CreateVoiceSession` with HTTP 501 and report `voice: false` on
`/api/health`. The desktop shows the microphone only when `GetVoiceSettings` reports the pipeline available **and** both
speech keys resolved (the account's own or the server's); until the keys are entered in Settings → Advanced → Voice
there is no button.

## How it works

```
Browser mic ──WebRTC──▶ LiveKit server ◀──WebRTC── voice worker (bun, @livekit/agents)
     ▲                       ▲                        ├ Silero VAD (local)
     │ CreateVoiceSession    │ AgentDispatch          ├ Deepgram streaming STT
     │ (signed CBOR)         │ (explicit, "seed-voice")├ optional LiveKit turn detector (ONNX)
     ▼                       │                        ├ "LLM" = POST /agents/api/voice/turn ─┐
Agents server ───────────────┘                        └ Cartesia streaming TTS ◀────────────┘
  ├ mints the room token (livekit-server-sdk AccessToken, 1h)     NDJSON reply deltas
  ├ keeps an in-memory room record → session, speaker, speech keys
  ├ appends the utterance as the speaker's user message and runs the turn (voiceMessage)
  └ streams the run's text deltas back to the worker through the VoiceEventHub
```

1. The desktop sends `CreateVoiceSession {sessionId}` (same access as `MessageSession`). The server resolves the
   speaker's speech keys, records the room `seed-voice-<sessionId>` in memory, mints a participant JWT (`roomJoin`,
   `canPublish`, `canSubscribe`, identity `user-<accountId>`, TTL 1h), and asks LiveKit to dispatch the `seed-voice`
   agent into that room with `{sessionId}` as job metadata. The response carries the LiveKit URL, token, room, identity
   and `expiresAt`.
2. The worker accepts the job, calls `POST /agents/api/voice/room-config {room}` to learn the session and keys, and
   builds its VAD → STT → "LLM" → TTS pipeline.
3. Each finished utterance becomes `POST /agents/api/voice/turn {room, text}`. The server subscribes to the session's
   events, appends the text as a user message with `clientMessageId voice:<uuid>`, runs the agent inline, and streams
   NDJSON: `{"delta": "…"}` per text delta, then `{"done": true, "text": "<final assistant text>"}`. The worker speaks
   the deltas as they arrive.
4. When the job ends the worker calls `POST /agents/api/voice/leave {room}`; records also expire two hours after issue.

Room records live only in memory: a server restart drops them, and the next `CreateVoiceSession` re-creates one (the
desktop re-issues on every start of the mic).

### Internal route contract

All three routes are served under `/api/voice/*` and `/agents/api/voice/*`, exist only with voice enabled (404
otherwise), and require `Authorization: Bearer <SEED_AGENTS_VOICE_INTERNAL_TOKEN>` (401 without it). JSON bodies in;
unknown or expired rooms are 403 `{"error": "Unknown room"}`.

| Route                | Body           | Answer                                                                                                                                |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `POST …/voice/turn`  | `{room, text}` | `application/x-ndjson`: `{"delta": string}`\* then `{"done": true, "text": string}`; a failure before any text is `{"error": string}` |
| `POST …/room-config` | `{room}`       | `{sessionId, deepgramApiKey, cartesiaApiKey, deepgramModel, cartesiaModel, cartesiaVoice, language, turnDetector}`                    |
| `POST …/voice/leave` | `{room}`       | `{ok: true}` (idempotent)                                                                                                             |

A turn stream ends on the assistant's durable message, on the session going back to idle/stopped/error after the run
started, a second after the run's request settles (a silent, tools-only turn yields `"text": ""`), or after five
minutes. A worker that disconnects mid-turn is unsubscribed; the run itself continues.

## Configuration

Every setting is an environment variable with a matching `--flag`; the worker process reads the same names (in `child`
mode the server passes its resolved values down, so flags apply to both).

| Variable                           | Flag                     | Default                                | Purpose                                                                     |
| ---------------------------------- | ------------------------ | -------------------------------------- | --------------------------------------------------------------------------- |
| `SEED_AGENTS_VOICE_ENABLED`        | `--voice-enabled`        | off                                    | Serve `CreateVoiceSession` and the worker routes                            |
| `SEED_AGENTS_LIVEKIT_URL`          | `--livekit-url`          | `ws://localhost:7880`                  | LiveKit URL for the worker and the dispatch API (inside the deployment)     |
| `SEED_AGENTS_LIVEKIT_PUBLIC_URL`   | `--livekit-public-url`   | = `SEED_AGENTS_LIVEKIT_URL`            | LiveKit URL handed to browsers                                              |
| `SEED_AGENTS_LIVEKIT_API_KEY`      | `--livekit-api-key`      | `devkey`                               | LiveKit API key (`livekit-server --dev` credentials)                        |
| `SEED_AGENTS_LIVEKIT_API_SECRET`   | `--livekit-api-secret`   | `secret`                               | LiveKit API secret                                                          |
| `SEED_AGENTS_DEEPGRAM_API_KEY`     | `--deepgram-api-key`     | `your-deepgram-api-key`                | Server-wide Deepgram key (placeholder = not configured)                     |
| `SEED_AGENTS_CARTESIA_API_KEY`     | `--cartesia-api-key`     | `your-cartesia-api-key`                | Server-wide Cartesia key (placeholder = not configured)                     |
| `SEED_AGENTS_DEEPGRAM_MODEL`       | `--deepgram-model`       | `nova-3`                               | Deepgram STT model                                                          |
| `SEED_AGENTS_CARTESIA_MODEL`       | `--cartesia-model`       | `sonic-3`                              | Cartesia TTS model                                                          |
| `SEED_AGENTS_CARTESIA_VOICE`       | `--cartesia-voice`       | `6c9e08ad-6629-4ba3-a640-a0bae916dfff` | Cartesia voice id                                                           |
| `SEED_AGENTS_VOICE_LANGUAGE`       | `--voice-language`       | `en`                                   | STT/TTS language                                                            |
| `SEED_AGENTS_VOICE_TURN_DETECTOR`  | `--voice-turn-detector`  | off                                    | Load the LiveKit end-of-utterance model (a ~460 MB download) instead of VAD |
| `SEED_AGENTS_VOICE_WORKER`         | `--voice-worker`         | `child` when enabled                   | `child` (server spawns it), `external` (dev pane), `off`                    |
| `SEED_AGENTS_VOICE_INTERNAL_TOKEN` | `--voice-internal-token` | random per boot                        | Shared secret for the worker routes; set it when the worker is `external`   |
| `SEED_AGENTS_VOICE_SERVER_URL`     | (worker only)            | `http://127.0.0.1:<port>`              | Where the worker reaches this server                                        |

The dispatch agent name is fixed: `seed-voice`.

### Speech keys: server vs. per account

The Deepgram and Cartesia keys are placeholders out of the box (`your-deepgram-api-key`, `your-cartesia-api-key`). Two
ways to supply real ones:

- **Server-wide** through the env vars above. Every voice session on the server uses them.
- **Per account** from desktop Settings → Advanced → Voice. The desktop stores them on its local agents server with
  `SetVoiceSettings`, encrypted like every other secret, under the names `voice/deepgram-api-key` and
  `voice/cartesia-api-key` (metadata `{kind: 'voice-api-key', provider}`). `null` clears a key; absent fields are left
  alone.

When a voice session is created the keys are resolved **for the speaker's account** (the signed account, not the agent
owner's): the account's secret if present, else the server's configured key, else the placeholder. `GetVoiceSettings`
reports the same logic per key as `'account'`, `'server'` or `'none'`, plus `available` (whether this server runs voice
at all). The server's key only counts as `'server'` when voice is enabled and the value is not a placeholder. Key values
are never returned to clients or logged; the worker receives them over the loopback `room-config` route only.

## Development

```
brew install livekit          # provides livekit-server
livekit-server --dev          # ws://localhost:7880, keys devkey / secret
```

`./dev up` runs two extra mprocs panes: `livekit` (`livekit-server --dev`) and `voice`
(`cd agents && bun run dev:voice`, the worker from source). `.env.vars` sets `SEED_AGENTS_VOICE_ENABLED=1`,
`SEED_AGENTS_VOICE_WORKER=external`, `SEED_AGENTS_VOICE_INTERNAL_TOKEN=dev-voice-token`,
`SEED_AGENTS_VOICE_SERVER_URL=http://localhost:3051` and the placeholder speech keys, so the agents server (`:3051`) and
the worker pane agree on the token without the server generating one.

Put real Deepgram and Cartesia keys either in your shell before `./dev up` or in the desktop's Voice settings. Then open
a session in the desktop app and click the microphone. The server's startup banner shows
`Voice: livekit=… stt=deepgram/nova-3 tts=cartesia/sonic-3 worker=external`.

Handy checks:

```
curl -s localhost:3051/api/health | jq .voice            # true
curl -s -X POST localhost:3051/api/voice/room-config \
  -H 'Authorization: Bearer dev-voice-token' -H 'Content-Type: application/json' \
  -d '{"room":"seed-voice-<sessionId>"}'                  # 403 until the desktop created the room
```

Tests need no LiveKit server: `bun test src/voice.test.ts` injects a fake dispatch client and a fake service host.

`bun run test:voice` is the real-process smoke (`scripts/smoke-voice.ts`): it starts `livekit-server --dev` and the
daemon in `child` worker mode, drives the signed API (settings, token, dispatch) and the loopback routes, and watches
the worker child join the room, fail its STT handshake on the placeholder key, and leave. No speech keys needed.

## Runtime notes (worker)

- **Turn detector plugin is loaded lazily.** Importing `@livekit/agents-plugin-livekit` registers ONNX inference
  runners, and the worker's inference process then loads the models at startup — fatally when they were never
  downloaded. The worker imports the plugin only when `SEED_AGENTS_VOICE_TURN_DETECTOR` is truthy (or on
  `download-files`). A room whose config asks for the detector while the worker has it off falls back to VAD endpointing
  and says so in its log. Run `bun run download-voice-models` (about 460 MB) before turning it on.
- **Bun's `ws` shim and rejected handshakes.** Bun replaces the `ws` package and has no `unexpected-response` event,
  which the Deepgram and Cartesia plugins use for a rejected handshake (bad key, 4xx). The rejection surfaces as an
  unhandled `error` event, which Node turns into `ERR_UNHANDLED_ERROR`. The worker installs an `uncaughtException`
  handler that logs and ignores exactly that code so the plugin's own retry and error path can run and close the
  session; any other uncaught error still exits the job.
- **Dead sessions leave the room.** When the AgentSession closes for any reason other than job shutdown (an
  unrecoverable STT/TTS error, for example), the worker ends the job so the shutdown callback runs and posts `leave`;
  the agent never lingers silently in the room.
- **1.9.0 option names.**
  `turnHandling: {turnDetection: model | 'vad', interruption: {enabled, mode: 'vad', minDuration}, endpointing: {minDelay, maxDelay}, preemptiveGeneration: {enabled: false}}`,
  all in milliseconds; `userAwayTimeout: null`. `interruption.mode` and `turnDetection` are set explicitly because their
  defaults reach for LiveKit Cloud inference, which a self-hosted server cannot provide. Preemptive generation stays
  off: the Seed session is stateful, so a speculative turn on an interim transcript would post the utterance twice.
- **Cartesia sentence buffering.** botical-voice patched the Cartesia plugin's `BUFFERED_WORDS_COUNT` (8 → 200) to trade
  latency for prosody. 1.9.0 still hardcodes it and does not expose it as an option; the patch is not applied here.
  Revisit if the spoken replies sound choppy.
- **`direnv exec` re-exports `.env.vars`.** An inline `SEED_AGENTS_VOICE_SERVER_URL=… direnv exec …` is overridden by
  the file; pass overrides after `direnv exec`.

## Production

- Run LiveKit as its own container or systemd unit (`livekit-server --config …` with real API keys), reachable by the
  agents server and the worker on `SEED_AGENTS_LIVEKIT_URL` and by browsers on `SEED_AGENTS_LIVEKIT_PUBLIC_URL`
  (`wss://…` behind TLS). WebRTC needs the UDP port range LiveKit advertises (or its TCP fallback) open to clients.
- Leave `SEED_AGENTS_VOICE_WORKER=child`: `main.ts` spawns `voice-worker.js` (a second bundle entry beside `main.js`)
  with `bun run voice-worker.js start`, restarts it with exponential backoff (1 s … 30 s) if it exits, and terminates it
  on shutdown. The internal token is generated per boot and passed in the child's environment; nothing else needs to
  know it.
- Set `SEED_AGENTS_LIVEKIT_API_KEY` / `_SECRET` to the LiveKit deployment's credentials and, if every user should be
  able to talk without their own keys, `SEED_AGENTS_DEEPGRAM_API_KEY` and `SEED_AGENTS_CARTESIA_API_KEY`.
- The turn detector (`SEED_AGENTS_VOICE_TURN_DETECTOR=1`) downloads its ONNX model on first use; pre-fetch it in the
  image with `bun run download-voice-models` or leave it off (VAD-only endpointing works well for short exchanges).
- The Docker image stages `@livekit/*`, `livekit-server-sdk` and the `onnxruntime` packages next to `dist/` (native
  bindings cannot be bundled); `main.js --exec-selfcheck` still has to pass.
