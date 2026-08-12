# Checkmark review — M3: the symmetric log (`harness/03-symmetric-log`)

Status: **verified — ready for Eric's review.** (Local commits only; not pushed.)

## What changed

The session log stops being a chat and becomes a shared workspace log: the user holds the same verbs the agent does, on
the same log, with every entry saying who acted.

- **Protocol**: `SessionActor` (`user | agent | system | trigger`) with `sessionEventActor()` deriving legacy events'
  actor from shape; `actor` on message/tool_call/tool_result payloads; new
  `InvokeSessionTool {sessionId, verb: read|write|call, input}` action.
- **Server**: the user's verb runs through the exact dispatchers the agent uses (same grants: the publish gate and
  callable set apply), appends actor-`user` tool_call/tool_result events, and reports execution failures as log entries
  plus a response `error` — a failed user attempt is context, not an exception. 409 while the agent's turn is live. On
  the agent's next turn, user actions replay as `<user_action>`/`<user_action_result>` tagged user messages (provider
  transcripts have no notion of user-made tool calls), with a system-prompt line framing them as shared ground truth not
  to re-run.
- **Desktop**: tool rows carry the actor with an accent "You" chip for user-run verbs; a wrench palette beside Send
  offers Read/Write forms and schema-generated forms for the agent's callables (JSON fallback for deep shapes);
  `useInvokeSessionTool` sends the action and the WS append is the only source of truth (no optimistic rows); the
  palette disables while the agent is busy, matching the server's 409.
- Judgment call, flagged: the palette is a button, not a "/" keybinding — the composer is a ProseMirror editor that owns
  its keystrokes; a slash-command inside it is a follow-up, not a minimal diff.

## How it was verified

- Agents suite **231 pass / 0 fail** (new: an end-to-end symmetric-log test — user write via the action, failed verb as
  log entry, four actor-stamped events, the next agent turn's provider request containing the tagged user action,
  invalid-verb rejection).
- Desktop vitest **264 pass / 0 fail** (new: actor threading ×2, "You" chip rendering, palette mutation envelopes ×2).
  Typechecks clean (pre-existing forge.config.ts excepted).
- **Adversarial review (high): 10 verified findings, all dispositioned.** Server fixes: the interrupted-tool synthesizer
  no longer fabricates results for user-actor calls (an actor-less synthetic replayed as a provider-illegal orphan and
  permanently bricked the session — a poison guard also drops any such pre-existing result at replay); the live-run
  guard is now bidirectional (user verbs hold an in-memory lock MessageSession 409s against, closing the check-then-act
  race); user-action payloads escape tag-closing brackets so fetched content cannot forge <user_action_result> frames
  the prompt elevates to ground truth; a user's palette call no longer silently promotes that callable into the agent's
  provider toolset; both replay loops derive actors through sessionEventActor (the canonical helper) instead of raw
  casts. Desktop fixes (by the same agent that built the UI): palette callables derived from the stored definition +
  server capabilities instead of a hardcoded list (loading state, not grant-all); NaN-dropping number fields now block
  submit and contract-miss responses keep the popover open; the invoke mutation invalidates session queries so a stale
  WS cannot hide a durable action; the result-merge no longer clobbers actor:'user' (and the test that claimed to cover
  it now actually omits the actor). Deferred with note: extracting the three near-duplicate AgentServicePiToolContext
  constructions into one builder (cleanup, tracked for M4 where the context grows again). New regression test: a
  dangling user tool_call (crash-shaped history) neither gains a synthetic result nor replays as an orphan tool message.

## Eric's three-minute test

1. Open a thread, click the wrench, run Read on `~/memory/` — expect a "You"-chipped Read row with the listing; the
   agent's next reply should reference it without re-running it.
2. Use Write to create `~/memory/from-me.md`, then ask the agent what you did — it should answer from the log.
3. Run a web search from the palette while the agent is idle; then ask a question that needs it — the agent should build
   on your result.
4. Send a message and, while the agent streams, open the palette — it should be disabled until the turn ends.
