# Local-First Notification Read State Edge Cases

## 1. Late-arriving old events

Policy: events with `eventAtMs <= markAllReadAtMs` are considered read, even if they arrive after the user taps "Mark all as read".

Reasoning:
- Keeps read-state monotonic and conflict-safe across devices.
- Prevents old feed replay/reorder from re-introducing stale unread notifications.
- Matches our merge model (`max` watermark + read-event union + prune).

Tradeoff:
- A user might miss an old event that was discovered late.
- This is acceptable for v1 because the system prioritizes deterministic cross-device convergence.

## 2. Clock skew across devices

Potential issue:
- Device A and device B can have different wall clocks, affecting `markAllReadAtMs` values.

Mitigation:
- Merge uses monotonic `max(markAllReadAtMs)`.
- Per-event reads are represented as explicit `{eventId, eventAtMs}` entries.
- Pruning against the merged watermark is deterministic.

Outcome:
- Even with skew, read-state remains convergent and never regresses into "unread again".
- A skewed future clock can aggressively mark items read; this is a known tradeoff of timestamp watermarks.

## 3. Duplicate events and differing event order

Potential issue:
- Different peers/devices can observe events in different order.
- Event records may appear repeatedly in paginated feed reads.

Mitigation:
- Notification identity uses stable `feedEventId` derived from raw feed event shape.
- Read-events are a map keyed by `eventId`, merged with `max(eventAtMs)`.
- Server and desktop both deduplicate and merge idempotently.

Outcome:
- Reordering and duplicate delivery do not cause read-state divergence.

## 4. Sync failure and retry behavior

Behavior when notify server is unreachable:
- Local read operations continue to work (`mark-event-read`, `mark-all-read`).
- Account state remains `dirty=true` and captures `lastSyncError`.
- Background sync retries periodically and after subsequent local mutations.
- Manual `syncNow` can be invoked to force a retry.

Result:
- Offline-first UX is preserved while eventual convergence is deferred until connectivity returns.

## 5. Read-event set growth and pruning

Risk:
- `readEvents` can grow if users mark many items individually.

Mitigation:
- Any `markAllReadAtMs` update prunes `readEvents` entries where `eventAtMs <= markAllReadAtMs`.
- Server and desktop apply the same prune rule after merge.

Result:
- Storage growth is bounded by "recent individually-read events after the last watermark".

## 6. Account switching and per-account isolation

Requirement:
- Notification ingestion runs in desktop main process for all local accounts.

Implementation:
- The background ingestor tracks a persisted global feed cursor and classifies
  mention/reply notifications for every local key returned by `daemon.listKeys`.
- UI rendering still scopes to the currently selected account.
- Read-state is stored per account UID.
- Queries and sync status are keyed by account UID.
- Sync requests are signed with the selected account key and merged server-side by `accountId`.

Result:
- Switching accounts does not pause ingestion for non-selected accounts, and
  cannot leak or overwrite another account's read-state.
