# Task: KM listens to thread replies (no explicit mention needed) + conversation memory

## Context

Repo: `/Users/horacioh/jean/Seed/seed-km` (branch `knowledge-agent-server-setup`).
Working dir for this work: `seed-knowledge-manager/agent/mcp/seed-cli-mcp/`.
Stack: TypeScript, Bun-built bundles deployed to systemd on `ubuntu@oc.hyper.media`.

The Knowledge Manager agent polls the Seed Hypermedia activity feed every 30s and replies to comments that @mention it. Today, **only comments containing an explicit `@KM` (Embed annotation OR inline `@[name](hm://kmAccountId)`) trigger a reply**. Users replying to KM's own comment in a thread are ignored unless they re-mention KM in every turn — bad UX for multi-turn dialogue.

Goal: KM should also auto-respond when a comment is a reply (direct or transitive) inside a thread that KM is already participating in. Plus, the LLM should see prior turns so replies feel like continued conversation.

## Current behavior to extend

- Polling driver: `src/poll-cli.ts`. Trigger gate is `findKmMentionInComment(comment, [kmAccountId, siteAccount])` at line ~197.
- Mention detection: `src/mentions.ts:findKmMentionInComment` — scans `block.annotations` for `Embed` link to KM/site, falls back to inline `@[…](hm://…)` regex.
- Thread context already gathered at reply time: `src/reply-engine.ts:gatherCommentReplyContext` walks `replyParent` chain up to 30 hops and includes the chain in the LLM prompt. So conversation memory is partly implemented — it's per-mention, not stored.
- Comment shape (`mentions.ts:SeedComment`): has `replyParent` and `threadRoot` fields populated by `seed-cli comment get`.
- Self-skip: `if (comment.author === kmAccountId) continue` (poll-cli.ts ~192) — must stay to avoid loops.
- Idempotency: `state.isProcessed(mid) || state.hasPlaceholderFor(mid)` — must stay.
- Invoker gate: currently bypassed by env var `KM_ENFORCE_INVOKER_GATE` (default off). Honor the toggle — when gate ON, the new auto-reply path must also pass the writer check.
- Per-day cap (`maxCommentsPerDay`, default 30) and blocked-list must apply to auto-replies too.

## What to implement

### 1. New trigger: comment is a thread reply to KM

In `poll-cli.ts`, BEFORE the `findKmMentionInComment` check, add a second trigger path:

- If `comment.replyParent` exists, fetch (or use cache) the parent comment. If parent's `author === kmAccountId`, treat as a triggering reply.
- Optionally also: if `comment.threadRoot` exists and any ancestor in the chain is authored by KM, trigger. Decision: start with direct-parent-only to keep the surface tight; add full-chain in a later pass if needed.
- Add a small in-process cache `kmReplyChainCache: Map<commentId, boolean>` so transitive lookups don't re-fetch the same chain inside one poll cycle.
- When triggered without explicit mention, build the `Mention` via a new helper `buildThreadReplyMention(comment, ts)` that mirrors `buildCommentMention` but uses the full block text (since there's no Embed evidence to extract). Tag the `Mention` with a discriminator (e.g. `triggerSource: 'mention' | 'thread-reply'`) so audit logs can tell them apart.

### 2. Audit event for the new path

Emit `mention_via_thread_reply` info event with `{commentId, parentCommentId, docId, author}` so operator can grep for the new trigger.

### 3. LLM context: include "you are KM, continuing a thread"

`gatherCommentReplyContext` already walks the chain. Confirm it's used on this new path too (Pass B doesn't care how the mention was created). Update the system prompt fragment (look in `reply-engine.ts` for `draftReply` / DeepSeek prompt) to add: "If the user's comment is a reply to your earlier comment, treat it as a follow-up turn. Do not re-introduce yourself."

### 4. Tests

Add unit tests in `src/`:

- `mentions.test.ts` or new `thread-reply.test.ts`: parent-of-KM detection given a `SeedComment` with `replyParent`.
- Mock `cli.runRead(['comment', 'get', ...])` to return a parent authored by KM and verify trigger fires.
- Negative case: parent authored by someone else → no trigger (unless explicit mention exists).

Run `bun test src` and `bun run typecheck` after. Both must pass.

### 5. Safety rails (do NOT touch)

- Keep self-skip (`comment.author === kmAccountId`).
- Keep blocked-list (`blocked.has(mention.author)`).
- Keep idempotency check on `mentionKey`.
- Keep per-day cap.
- Honor `KM_ENFORCE_INVOKER_GATE` env var: if true, the thread-reply path also checks the writer set.

## Deployment

After typecheck + tests pass:

```bash
cd seed-knowledge-manager/agent/mcp/seed-cli-mcp
bun run build
scp dist/poll-cli.js ubuntu@oc.hyper.media:/tmp/poll-cli.js
ssh ubuntu@oc.hyper.media 'sudo install -m 755 -o km -g km /tmp/poll-cli.js /home/km/km-agent/mcp/seed-cli-mcp/dist/poll-cli.js && sudo rm /tmp/poll-cli.js'
```

Timer `km-poll.timer` fires every 30s — next tick picks up new binary.

## Verify deploy

```bash
ssh ubuntu@oc.hyper.media 'sudo ls -t /home/km/km-logs/runs/ | head -3'
# Find newest run dir, then:
ssh ubuntu@oc.hyper.media 'sudo grep -E "mention_via_thread_reply|placeholder_posted|reply_finalised" /home/km/km-logs/runs/<RUN_ID>/trace.jsonl'
```

End-to-end: comment on a doc mentioning KM, wait for reply, then reply to KM's reply WITHOUT @-mentioning. Expect new placeholder + final reply within one poll cycle.

## Open questions to answer before coding

1. Direct parent only, or full chain ancestor scan? (Recommend direct parent first.)
2. Should a reply in a thread KM started but where KM hasn't replied yet trigger? (Recommend NO — KM must have posted at least one comment in the chain.)
3. Cap auto-reply depth (e.g. KM only continues a thread for N turns) to avoid two KMs ping-ponging if a future variant deploys?
4. Persist conversation state across runs, or rely on on-demand chain walk every poll? (Chain walk works; persistence is optional.)

## Critical files to read first

- `src/poll-cli.ts` (Pass A trigger logic, lines 180–230)
- `src/mentions.ts` (Mention type, findKmMentionInComment, buildCommentMention)
- `src/reply-engine.ts` (gatherCommentReplyContext, draftReply prompt)
- `src/state.ts` (mentionKey, processed/placeholder idempotency)

Read those before writing code. Then ask any of the open questions before implementing.
