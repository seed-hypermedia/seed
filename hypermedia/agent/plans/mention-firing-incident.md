---
name: Mention Firing Incident
summary: The June 2026 trace of how a comment that mentions an agent becomes a trigger firing, and why replies in a thread were silently dropped twice before the activity monitor was fixed.
---
Status: historical record, traced against the live incident of 29 June 2026 on `agentic.seed.hyper.media`. Both fixes it describes shipped. The current pipeline is described on [triggers](../triggers.md); this page keeps the reasoning behind two rules that still hold: an event is new when it has not been observed before, not when its timestamp is recent, and a comment and its citation twin collapse to one [firing](../firing.md).

# The pipeline at a glance

One comment that mentions an account becomes two events in the Hypermedia activity feed (`/api/ListEvents`): a `comment` event and a `citation` event that share the same comment version CID. Both flow through the same path, and there were two places an event could be dropped before it ever fired.

```
// per account, every ~5 s — agents/src/activity-monitor.ts
ListEvents(currentAccount)  →  activityEventKey()  →  [DROP 1] staleness filter  →
   Service.processActivityEvent()  →  activityMatchesTriggerSource()  →
      [DROP 2] citation suppression  →  activityFiringKey() dedup  →
         INSERT trigger_firings  →  createSession  →  run agent
```

1. **Poll the feed** (`activity-monitor.ts`, `#pollAccount`). The monitor polls `/api/ListEvents?currentAccount=<agentAccount>` through the `@seed-hypermedia/client`. It only sees blobs already indexed on the polled server, so a comment becomes visible a few seconds after it was authored.
2. **Derive a stable key** (`activity-triggers.ts`, `activityEventKey`). A comment event's key is `blob-<cid>`; its citation twin's key is `mention-<cid>--<target>`. The `<cid>` (the comment version) is identical in both.
3. **DROP 1, the staleness watermark.** The old filter kept an event only when its create time was at or after `max(lastSuccessAt, startedAt - ACTIVITY_BACKFILL_MS)`. `lastSuccessAt` was set to `Date.now()` after every successful poll, so in steady state the bound was about five seconds ago. Any event that became visible more than one poll interval after its own timestamp was dropped for good, and recorded in `seenKeys` so it was never reconsidered. The flaw: the create time was being used where the observe time was meant, and the feed carries no observe time.
4. **Match against each enabled trigger** (`api-service.ts`, `processActivityEvent`; `activity-triggers.ts`, `matchesSingleMention`). A mention trigger matches structurally: a comment matches when any block embeds a mention link resolving to the account (`commentMentionsAccount`), and a citation matches when its target id record names the account. Whether the comment is a thread root or a reply does not matter.
5. **DROP 2, citation suppression (removed).** The citation twin of a comment carries `citationType: 'c'`. The old matcher returned false for it, trusting the comment event to fire instead. When DROP 1 had already discarded the comment event, the citation was the only sibling left, and it was thrown away here.
6. **Dedupe the siblings and fire once** (`activityFiringKey`). The citation's `mention-<cid>--<target>` key collapses onto the comment's `blob-<cid>`, and `trigger_firings` is unique on `(account_id, trigger_id, activity_key)`, so whichever sibling arrives first creates the session and the other is a no-op insert. (Today admission goes through a `trigger_event_claims` row first; the effect is the same.) Both carry the full comment body (`loadCitationEvent` fetches it for `c` citations), so the context is the same either way.

# The live trace

Three comments in one thread, all mentioning the agent's account. Only the thread root fired.

| Comment | Authored | Comment event reached the matcher? | Citation event reached the matcher? | Fired? |
| --- | --- | --- | --- | --- |
| Thread root, "Hey @agent research EDM…" | 15:05:13 | yes, visible about 3 s later, still fresh | suppressed (DROP 2) | yes, from the comment event |
| Reply, "one document for each" | 15:06:50 | no, fetched every poll from 15:06:56 and always older than `lastSuccessAt` (DROP 1) | no, same DROP 1 | no, neither sibling reached the matcher |
| Reply, "can you hear me?" | 15:08:15 | no, visible about 5 s later (DROP 1) | reached the matcher, then DROP 2 | no, the citation was suppressed |

The root won only because its comment event happened to surface within one poll interval of its timestamp. Both replies had more than five seconds of indexing lag, so DROP 1 discarded their comment events on every poll. The second reply also had a fresh citation that reached the matcher, which DROP 2 suppressed.

# The fixes

| Change | Fixes "can you hear me?" (fresh citation) | Fixes "one document for each" (both siblings stale) |
| --- | --- | --- |
| A. Remove DROP 2 and dedupe siblings on the shared CID | yes, the citation fires | no, neither sibling reaches the matcher |
| B. Request `order: 'observed'` from ListEvents, decide newness by observation (the key is not in `seenKeys`), and advance the watermark per event | yes, the comment event also survives | yes, even an hours-late comment surfaces at the top and fires |

Fix A resolved the reported miss. The broader "reply mentions don't fire" problem was DROP 1, and fix B addresses its root: a feed event is new when the monitor has not observed it before, not when its create timestamp is recent, so a comment that propagates late still fires when it first appears. The two compose: B lets the late comment event through, and A's shared-CID firing key keeps the citation twin from firing twice. The create-time bound survives only for the cold-start first poll.

# See also

- [Triggers](../triggers.md)
- [Firing](../firing.md)
- [Trigger](../trigger.md)
- [Persistence](../persistence.md)
