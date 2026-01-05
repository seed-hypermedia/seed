# Notify Service Incident Analysis (2026-01-03)

## Incident Summary

On January 3, 2026, the notify service entered a degraded state where email notification processing consistently timed out. The service was eventually killed (exit code 137, indicating OOM or manual kill) after approximately 2 days of degraded operation.

## Timeline

| Time | Event |
|------|-------|
| ~23:19 | Last successful notification processing: 1 event processed, ID set to `blob-bafy2bzacecnm3qtyxoiu4pzflebpparfbxic2ol4gg3cwy564bvqhtijr5ggm` |
| 23:20:49 | First "already processing" message - next round started but found previous still running |
| 23:21:34 | First timeout after 60 seconds |
| 23:21:34 - ongoing | Pattern repeats: new round starts, takes >60s, times out |
| 00:53:20 | Error: "comment has been deleted" - batch processing attempted to process stale events |
| 00:56:34 | SMTP auth failures begin (`535 Authentication failed`) |
| ~Jan 5 | Container killed (exit 137) |

## Log Evidence

### Pattern 1: Consistent Timeouts

```
2026-01-02T23:20:49.535Z Email notifications already processing. Skipping round.
2026-01-02T23:21:04.535Z Email notifications already processing. Skipping round.
2026-01-02T23:21:19.535Z Email notifications already processing. Skipping round.
2026-01-02T23:21:34.535Z Email notifications already processing. Skipping round.
2026-01-02T23:21:34.535Z Error handling email notifications: Email notification processing timed out after 60000ms
```

This pattern shows:
- Processing started at ~23:19:49 (15s before first "already processing")
- Took over 60 seconds (4x the 15s interval passed before timeout)
- Timeouts occur roughly every 60 seconds thereafter

### Pattern 2: Service Never Recovered

After the first timeout, the service continued in a loop:
- Timeout fires → `.finally()` clears `currentNotifProcessing` → new round starts → new round also times out

Looking at the last ~104 timeouts in the logs, the service never successfully completed a round after the initial failure.

### Pattern 3: Deleted Comment Error

```
2026-01-03T00:53:20.896Z Error evaluating event for notifications: [not_found] rpc error: code = NotFound desc = comment bafy2bzaceckq3eyq5blta7zz5zbzu4quy24i2xbwxtqwmia5np7ujsslv2tvs has been deleted
```

This occurred during batch notification processing (not immediate), indicating the batch processor was trying to process events that referenced a now-deleted comment.

## Root Cause Analysis

### Primary Issue: Processing Takes >60s

The core issue is that `handleEmailNotifications()` started taking more than 60 seconds to complete. This triggers a cascade:

1. Round N starts at T+0
2. Interval fires at T+15, sees processing active, logs "already processing"
3. Interval fires at T+30, same
4. Interval fires at T+45, same
5. Timeout fires at T+60, rejects with timeout error
6. `.finally()` sets `currentNotifProcessing = undefined`
7. Interval fires at T+75, starts round N+1
8. Round N+1 ALSO takes >60s
9. Repeat forever

### What Could Cause >60s Processing?

The `handleEmailNotifications` call flow:
1. `handleEmailNotifications()`
2. → `handleImmediateNotificationsAfterEventId(lastProcessedEventId)`
3. → `loadEventsAfterEventId(lastProcessedEventId)` - paginate through feed
4. → For each event: `handleEmailNotifs()` → `evaluateEventForNotifications()`

**Hypothesis A: gRPC Call Hanging**

A single `grpcClient.activityFeed.listEvents()` call could hang indefinitely. The original code had no timeout on individual gRPC calls.

Evidence:
- No individual call timeouts existed
- A hung connection would block forever
- Subsequent rounds would also hit the same issue

**Hypothesis B: Event ID Not Found in Feed**

If `lastProcessedEventId` was never found (event expired from feed, feed ordering changed, etc.), `loadEventsAfterEventId` would paginate through the ENTIRE feed with `pageSize: 2`.

Evidence:
- Original code had no max page limit
- With `pageSize: 2`, even 1000 events = 500 gRPC requests
- No timeout on individual requests = compound delays

**Hypothesis C: Heavy Event Processing**

For each event, `evaluateEventForNotifications` makes multiple API calls:
- For Comments: `getComment`, `getParentComments` (traverses chain), `requestAPI` calls
- For Refs: `loadRefFromIpfs` (x2), `getDocument` (x2 if has previous version), `requestAPI` calls

If even one call hangs or is slow, processing backs up.

### Note: Deleted Comment is a Symptom, Not Cause

The error `comment bafy2bzaceckq3eyq5blta7zz5zbzu4quy24i2xbwxtqwmia5np7ujsslv2tvs has been deleted` appeared at 00:53:20, which is AFTER the problems started at 23:20. This error occurred during batch processing trying to handle stale events, not as the initial trigger.

### Unknown: What Actually Caused the Initial Hang

We lack sufficient logging to determine exactly what caused the first timeout. The daemon is on the same machine and should be fast. Possibilities:
1. Momentary network/socket issue
2. Daemon garbage collection pause
3. Database lock contention
4. gRPC connection pool exhaustion
5. Bug in event ordering causing ID not to be found

**We added comprehensive timing logs to diagnose future incidents.**

### Secondary Issues

1. **No Cancellation**: When timeout fires, the underlying `handleEmailNotifications()` continues running. This wastes resources and could interfere with the next round.

2. **Concurrent Background Work**: Old rounds continue running after timeout, potentially making multiple gRPC calls while new rounds also run.

3. **No Max Page Limit**: The `loadEventsAfterEventId` function had no upper bound on pagination.

4. **Small Page Size**: Using `pageSize: 2` meant more round trips to find events.

## Code Issues Found

### Issue 1: Timeout Doesn't Cancel Work

**Before (problematic):**
```javascript
currentNotifProcessing = withTimeout(
  handleEmailNotifications(),  // This promise continues running after timeout
  timeoutMs,
  'timeout message'
)
currentNotifProcessing.finally(() => {
  currentNotifProcessing = undefined  // Clears reference but work continues
})
```

The `withTimeout` wrapper rejects after 60s, but the original `handleEmailNotifications()` promise continues executing in the background.

### Issue 2: No Page Limit

**Before (problematic):**
```javascript
while (true) {  // Infinite loop
  const {events, nextPageToken} = await grpcClient.activityFeed.listEvents({
    pageSize: 2,  // Very small page size
  })
  // ... search for lastProcessedEventId ...
  if (!nextPageToken) break
}
```

If `lastProcessedEventId` is never found, this loops until the feed ends.

### Issue 3: Promise Reference vs Boolean Flag

**Before:**
```javascript
if (currentNotifProcessing) {  // Check promise reference
  return  // Skip
}
```

The promise reference is set to `undefined` in `.finally()` even though the underlying work continues.

## Fixes Applied

### Fix 1: AbortController Pattern with Proper Cleanup

```javascript
let isNotifProcessingActive = false
let currentNotifAbortController: AbortController | null = null

setInterval(() => {
  if (isNotifProcessingActive) return  // Boolean flag

  isNotifProcessingActive = true
  currentNotifAbortController = new AbortController()
  const signal = currentNotifAbortController.signal

  const processingPromise = handleEmailNotifications(signal)

  // Timeout triggers abort, but doesn't clear the flag
  const timeoutId = setTimeout(() => {
    currentNotifAbortController?.abort()
    reportError('Email notification processing timed out')
  }, 60_000)

  // Wait for ACTUAL promise to settle, not just timeout
  processingPromise
    .catch((err) => {
      if (err.message !== 'Event loading aborted') {
        reportError(err.message)
      }
    })
    .finally(() => {
      clearTimeout(timeoutId)
      isNotifProcessingActive = false  // Only cleared when work truly stops
    })
})
```

### Fix 2: Max Page Limit + Larger Page Size + Individual Call Timeouts

```javascript
const MAX_EVENT_PAGES = 100
const EVENT_PAGE_SIZE = 20  // Was 2
const GRPC_CALL_TIMEOUT_MS = 10_000  // 10s timeout per gRPC call

while (pageCount < MAX_EVENT_PAGES) {
  if (signal?.aborted) {
    // Return partial results instead of throwing
    return {events: eventsAfterEventId, foundCursor: false, aborted: true}
  }

  const {events, nextPageToken} = await grpcClient.activityFeed.listEvents({
    pageSize: EVENT_PAGE_SIZE,
  })
  // ...
}

if (pageCount >= MAX_EVENT_PAGES) {
  reportError('Hit max pages, lastProcessedEventId may be stale')
}
```

### Fix 3: Graceful Degradation with LoadEventsResult

Instead of throwing exceptions on abort/error, `loadEventsAfterEventId` now returns a structured result:

```typescript
type LoadEventsResult = {
  events: PlainMessage<Event>[]  // Events collected before abort/error
  foundCursor: boolean           // Whether we found lastProcessedEventId
  aborted: boolean               // Whether processing was aborted
}
```

This allows callers to process whatever events were collected before the issue occurred, rather than losing all progress.

### Fix 4: Boolean Processing Flag

Using `isNotifProcessingActive` instead of checking the promise reference ensures the flag accurately reflects whether processing is happening.

### Fix 5: Comprehensive Timing Logs

Added timing instrumentation to identify slow operations:
- `loadEventsAfterEventId`: Logs page times >1s, total time >5s
- `handleImmediateNotificationsAfterEventId`: Logs load time and process time >5s
- `handleEmailNotifications`: Logs total time >10s
- Individual gRPC call failures with timing

Error reports sent for:
- gRPC call timeouts (10s per call)
- Max pages hit (100 pages)
- Event ID not found in feed

## Potential Issues with Fix

### Issue A: Abort Doesn't Cancel gRPC Calls

The `AbortController.abort()` sets `signal.aborted = true`, but the gRPC call in progress won't be cancelled - it will complete, then the next loop iteration checks `signal.aborted` and returns partial results.

**Impact**: One extra gRPC call may complete after abort. This is acceptable.

### Issue B: Events Lost on Max Pages

If we hit MAX_EVENT_PAGES, we return the events found so far. Some events between `lastProcessedEventId` and current position may be skipped.

**Mitigated by**:
- MAX_EVENT_PAGES * EVENT_PAGE_SIZE = 2000 events capacity
- Batch processing runs separately and will eventually catch up
- Error is logged for visibility

### Issue C: Partial Results on Abort/Error (Now Graceful)

With the `LoadEventsResult` pattern, aborts/errors no longer throw exceptions. Instead:
- `loadEventsAfterEventId` returns `{events, foundCursor: false, aborted: true/false}`
- Callers check `foundCursor` and `aborted` flags and log warnings
- Partial event list is still processed and marked as processed

**Impact**: Events collected before abort/error are processed. On next successful run, we start from the newest event found, which is correct behavior.

## Recommendations

1. **Monitor for max page hits**: Add alerting when `loadEventsAfterEventId hit max pages` appears in logs

2. **Investigate daemon slowness**: The root cause of >60s processing is likely slow daemon responses. Check daemon logs around 2026-01-02 23:19.

3. **Consider cursor reset logic**: If lastProcessedEventId can't be found after N pages, reset to current event ID (partially implemented - we now report and continue)

## Open Questions

1. **What caused the initial slowdown?** The daemon may have been under load, had a network issue, or was processing a large operation.

2. **Why did it never recover?** Once slow, the daemon stayed slow. This could be:
   - Cascading load from multiple concurrent notify requests
   - Daemon's own issues (memory pressure, CPU saturation)
   - External factors (database load, network issues)

3. **Was the container OOM killed or manually killed?** Exit code 137 indicates SIGKILL, but could be either OOM killer or manual intervention.

## Appendix: Key Log Lines

```
# Last success
Will handleEmailNotifs (1 events): mention, reply
Setting notifier last processed event ID to blob-bafy2bzacecnm3qtyxoiu4pzflebpparfbxic2ol4gg3cwy564bvqhtijr5ggm

# First timeout cycle (pattern repeats)
2026-01-02T23:20:49.535Z Email notifications already processing. Skipping round.
2026-01-02T23:21:04.535Z Email notifications already processing. Skipping round.
2026-01-02T23:21:19.535Z Email notifications already processing. Skipping round.
2026-01-02T23:21:34.535Z Email notifications already processing. Skipping round.
2026-01-02T23:21:34.535Z Error handling email notifications: Email notification processing timed out after 60000ms

# Total timeouts in log file: 104
# Total "already processing" in log file: 328

# Deleted comment error (batch processing)
2026-01-03T00:53:20.896Z Error evaluating event for notifications: [not_found] rpc error: code = NotFound desc = comment bafy2bzaceckq3eyq5blta7zz5zbzu4quy24i2xbwxtqwmia5np7ujsslv2tvs has been deleted

# SMTP auth failures
Failed to send error report email: Error: Invalid login: 535 Authentication failed
```
