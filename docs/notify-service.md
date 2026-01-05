# Email Notification Service

The notify service (`frontend/apps/notify/`) is a standalone Node.js application that monitors the activity feed and sends email notifications to subscribed users.

## Overview

The service:
- Polls the activity feed for new events
- Matches events against user subscription preferences
- Generates and sends HTML/text emails via SMTP
- Tracks processing state to prevent duplicate notifications

## Architecture

```
┌─────────────────────────────────────────┐
│           Activity Feed                  │
│      (from Go backend daemon)           │
└────────────────┬────────────────────────┘
                 │
                 │ poll every 15s (immediate)
                 │ poll every 30s (batch check)
                 ▼
┌─────────────────────────────────────────┐
│         email-notifier.ts               │
│    ┌─────────────────────────────────┐  │
│    │ handleEmailNotifications()     │  │
│    │ handleBatchNotifications()     │  │
│    └─────────────────────────────────┘  │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│        evaluateEventForNotifications    │
│    ┌─────────────────────────────────┐  │
│    │ evaluateDocUpdateForNotifs()   │  │
│    │ evaluateNewCommentForNotifs()  │  │
│    └─────────────────────────────────┘  │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│          createNotificationsEmail       │
│         (@shm/emails/notifier.tsx)      │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│             sendEmail()                  │
│         (nodemailer SMTP)               │
└─────────────────────────────────────────┘
```

## Core Files

| File | Purpose |
|------|---------|
| `app/email-notifier.ts` | Main processing loop and event evaluation |
| `app/db.ts` | SQLite database for subscriptions and state |
| `app/notify-request.ts` | API client wrapper |
| `app/mailer.ts` | SMTP email sending |
| `@shm/emails/notifier.tsx` | Email template generation (MJML/React) |

## Database Schema

### Tables

```sql
-- Email addresses with admin tokens
CREATE TABLE emails (
  email TEXT UNIQUE NOT NULL,
  adminToken TEXT NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  isUnsubscribed BOOLEAN NOT NULL DEFAULT FALSE
);

-- Subscription preferences per (account, email) pair
CREATE TABLE email_subscriptions (
  id TEXT NOT NULL,                      -- Account UID
  email TEXT NOT NULL REFERENCES emails(email),
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notifyAllMentions BOOLEAN NOT NULL DEFAULT FALSE,
  notifyAllReplies BOOLEAN NOT NULL DEFAULT FALSE,
  notifyOwnedDocChange BOOLEAN NOT NULL DEFAULT FALSE,
  notifySiteDiscussions BOOLEAN NOT NULL DEFAULT FALSE,
  notifyAllComments BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id, email)
) WITHOUT ROWID;

-- Processing state
CREATE TABLE notifier_status (
  field TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL
);
```

### Status Fields

| Field | Purpose |
|-------|---------|
| `last_processed_event_id` | Cursor for immediate notifications |
| `last_processed_batch_event_id` | Cursor for batch notifications |
| `batch_notifier_last_send_time` | Timestamp of last batch send |

## Notification Types

### Immediate Notifications

Sent within 15 seconds of event occurrence:

| Reason | Trigger | Subscription Flag |
|--------|---------|-------------------|
| `mention` | @mentioned in document or comment | `notifyAllMentions` |
| `reply` | Someone replied to your comment | `notifyAllReplies` |

### Batch Notifications

Aggregated and sent every 4 hours (prod) or 6 minutes (dev):

| Reason | Trigger | Subscription Flag |
|--------|---------|-------------------|
| `site-new-discussion` | New root comment on your document | `notifySiteDiscussions` |
| `site-doc-update` | Document updated on your site | *(TODO)* |

### Other Types (Future)

| Reason | Trigger | Subscription Flag |
|--------|---------|-------------------|
| `user-comment` | Your own comments (digest) | `notifyAllComments` |

## Processing Flow

### Initialization

```typescript
export async function initEmailNotifier() {
  // Run immediate processing once on startup
  currentNotifProcessing = handleEmailNotifications()
  await currentNotifProcessing

  // Schedule immediate processing every 15s
  setInterval(() => {
    // ... handleEmailNotifications() with timeout
  }, 1000 * 15)

  // Schedule batch check every 30s
  setInterval(() => {
    // ... handleBatchNotifications() with timeout
  }, 30_000)
}
```

### Immediate Processing

```typescript
async function handleEmailNotifications() {
  const lastProcessedEventId = getNotifierLastProcessedEventId()

  if (lastProcessedEventId) {
    await handleImmediateNotificationsAfterEventId(lastProcessedEventId)
  } else {
    // First run: set cursor to latest event, don't process history
    await resetNotifierLastProcessedEventId()
  }
}

async function handleImmediateNotificationsAfterEventId(lastProcessedEventId) {
  const eventsToProcess = await loadEventsAfterEventId(lastProcessedEventId)

  try {
    await handleEmailNotifs(eventsToProcess, notifReasonsImmediate)
  } finally {
    // Always update cursor, even on error
    markEventsAsProcessed(eventsToProcess)
  }
}
```

### Batch Processing

```typescript
async function handleBatchNotifications() {
  const lastSendTime = getBatchNotifierLastSendTime()
  const lastProcessedEventId = getBatchNotifierLastProcessedEventId()
  const lastEventId = await getLastEventId()

  // Check if interval has elapsed
  const nextSendTime = lastSendTime + (4 * 60 * 60 * 1000) // 4 hours

  if (nextSendTime < Date.now()) {
    await sendBatchNotifications(lastProcessedEventId)

    // Update cursors
    setBatchNotifierLastSendTime(new Date())
    setBatchNotifierLastProcessedEventId(lastEventId)
  }
}
```

## Event Evaluation

### evaluateEventForNotifications()

Dispatches events to appropriate handlers:

```typescript
async function evaluateEventForNotifications(event, subscriptions, appendNotif) {
  // Skip old events (older than batch interval)
  if (considerationTime < cutoffTime) {
    reportError(`Event ${eventId} is too old. Ignoring!`)
    return
  }

  if (event.data.case === 'newBlob') {
    const blob = event.data.value

    if (blob.blobType === 'Ref') {
      const refEvent = await loadRefEvent(event)
      await evaluateDocUpdateForNotifications(refEvent, ...)
    }

    if (blob.blobType === 'Comment') {
      const comment = await getComment(blob.cid)
      await evaluateNewCommentForNotifications(comment, ...)
    }
  }
}
```

### evaluateDocUpdateForNotifications()

Checks document updates for mentions:

```typescript
async function evaluateDocUpdateForNotifications(refEvent, subscriptions, appendNotif) {
  for (const sub of subscriptions) {
    // Check if subscribed account was mentioned
    if (sub.notifyAllMentions && refEvent.newMentions[sub.id]) {
      appendNotification(sub, {
        reason: 'mention',
        source: 'document',
        authorAccountId: refEvent.authorId,
        authorMeta: refEvent.authorMeta,
        targetMeta: refEvent.metadata,
        subjectAccountId: sub.id,
        targetId: refEvent.id,
        url: refEvent.openUrl,
      })
    }
  }
}
```

### evaluateNewCommentForNotifications()

Checks comments for various notification triggers:

```typescript
async function evaluateNewCommentForNotifications(comment, subscriptions, appendNotif) {
  // Extract @mentions from comment content
  const mentionedUsers = extractMentions(comment.content)

  // Get parent comment author for reply detection
  const parentCommentAuthor = comment.replyParent
    ? (await getComment(comment.replyParent)).author
    : null

  for (const sub of subscriptions) {
    // Mention in comment
    if (sub.notifyAllMentions && mentionedUsers.has(sub.id)) {
      appendNotification(sub, {reason: 'mention', source: 'comment', ...})
    }

    // Reply to your comment
    if (sub.notifyAllReplies && parentCommentAuthor === sub.id) {
      appendNotification(sub, {reason: 'reply', ...})
    }

    // New discussion on your document
    if (sub.id === comment.targetAccount && !comment.threadRoot && sub.notifySiteDiscussions) {
      appendNotification(sub, {reason: 'site-new-discussion', ...})
    }
  }
}
```

## Mention Extraction

Mentions are detected from document/comment content:

```typescript
function getMentionsOfDocument(document: HMDocument): MentionMap {
  const mentionMap: MentionMap = {}

  for (const blockNode of document.content) {
    const annotations = getAnnotations(blockNode.block)
    for (const annotation of annotations) {
      if (annotation.type === 'Embed' && annotation.link.startsWith('hm://')) {
        const hmId = annotation.link.slice(5)
        // Only account mentions (no path = not a document reference)
        if (!hmId.includes('/')) {
          mentionMap[block.id] = mentionMap[block.id] ?? new Set()
          mentionMap[block.id].add(hmId)
        }
      }
    }
  }

  return mentionMap
}
```

For document updates, new mentions are detected by comparing with previous version:

```typescript
const currentMentions = getMentionsOfDocument(newDoc)
const prevMentions = getMentionsOfDocument(prevDoc)

const newMentions = {}
for (const [blockId, mentions] of Object.entries(currentMentions)) {
  const prev = prevMentions[blockId]
  if (!prev) {
    newMentions[blockId] = mentions  // New block
  } else {
    const added = new Set([...mentions].filter(m => !prev.has(m)))
    if (added.size > 0) newMentions[blockId] = added
  }
}
```

## Email Generation

### Notification Grouping

Notifications are grouped by reason and document:

```typescript
const grouped: GroupedNotifications = {
  'site-doc-update': {},
  'site-new-discussion': {},
  'mention': {},
  'reply': {},
  'user-comment': {},
}

for (const notif of notifications) {
  const reason = notif.notif.reason
  const docId = notif.notif.targetId.id
  grouped[reason][docId] = grouped[reason][docId] ?? []
  grouped[reason][docId].push(notif)
}
```

### Template Rendering

Email templates use MJML for responsive HTML:

```typescript
const {html} = renderReactToMjml(
  <Mjml>
    <MjmlHead>
      <MjmlTitle>{subject}</MjmlTitle>
      <MjmlPreview>{summary}</MjmlPreview>
    </MjmlHead>
    <MjmlBody>
      <EmailHeader />

      {['mention', 'reply', 'site-new-discussion'].map(reason => (
        <ReasonSection reason={reason} notifications={grouped[reason]} />
      ))}

      <NotifSettings url={settingsUrl} />
    </MjmlBody>
  </Mjml>
)
```

## SMTP Configuration

Environment variables for email sending:

```
NOTIFY_SMTP_HOST=smtp.example.com
NOTIFY_SMTP_PORT=587
NOTIFY_SMTP_USER=user@example.com
NOTIFY_SMTP_PASSWORD=secret
NOTIFY_SENDER="Seed Notifications <notifications@example.com>"
```

## Error Handling

### Error Batching

Errors are batched to prevent email flooding:

```typescript
const errorBatchDelayMs = 30_000  // 30 seconds
let pendingErrors: string[] = []
let errorBatchTimeout: ReturnType<typeof setTimeout> | null = null

function reportError(message: string) {
  console.error(message)
  pendingErrors.push(`${new Date().toISOString()} ${message}`)

  if (!errorBatchTimeout) {
    errorBatchTimeout = setTimeout(flushErrorBatch, errorBatchDelayMs)
  }
}

async function flushErrorBatch() {
  const errors = pendingErrors
  pendingErrors = []

  const subject = errors.length === 1
    ? 'Email Notifier Error Report'
    : `Email Notifier Error Report (${errors.length} errors)`

  await sendEmail(adminEmail, subject, {text: errors.join('\n\n---\n\n')})
}
```

### Processing Timeouts

```typescript
const timeoutMs = 60_000  // 60 seconds for immediate
currentNotifProcessing = withTimeout(
  handleEmailNotifications(),
  timeoutMs,
  `Processing timed out after ${timeoutMs}ms`,
)
```

### IPFS Fetch Timeout

Prevent hanging on slow IPFS fetches:

```typescript
const IPFS_FETCH_TIMEOUT_MS = 5_000

async function loadRefFromIpfs(cid: string) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), IPFS_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {signal: controller.signal})
    // ...
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`IPFS fetch timed out for CID ${cid}`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
```

## Adding New Notification Types

### 1. Add Reason to Notification Type

In `@shm/emails/notifier.tsx`:

```typescript
export type Notification =
  | { reason: 'mention', ... }
  | { reason: 'reply', ... }
  | { reason: 'my-new-reason', newField: string, ... }  // Add here
```

### 2. Add to Reason Sets

In `email-notifier.ts`:

```typescript
// For immediate notifications:
const notifReasonsImmediate = new Set<NotifReason>(['mention', 'reply', 'my-new-reason'])

// OR for batch notifications:
const notifReasonsBatch = new Set<NotifReason>(['site-doc-update', 'site-new-discussion', 'my-new-reason'])
```

### 3. Add Subscription Flag

In `db.ts`:

```typescript
type BaseSubscription = {
  // existing fields...
  notifyMyNewReason: boolean
}
```

### 4. Run DB Migration

In `initDatabase()`:

```typescript
if (version === 4) {
  db.exec(`
    BEGIN;
    ALTER TABLE email_subscriptions ADD COLUMN notifyMyNewReason BOOLEAN NOT NULL DEFAULT FALSE;
    PRAGMA user_version = 5;
    COMMIT;
  `)
  version = 5
}
```

### 5. Add Evaluation Logic

In `email-notifier.ts`:

```typescript
async function evaluateNewEventForNotifications(...) {
  for (const sub of subscriptions) {
    if (sub.notifyMyNewReason && someCondition) {
      appendNotification(sub, {
        reason: 'my-new-reason',
        newField: value,
        targetId: ...,
        url: ...,
      })
    }
  }
}
```

### 6. Add Email Template

In `@shm/emails/notifier.tsx`:

```typescript
// In grouped sections:
{reason === 'my-new-reason' ? (
  <MjmlText>
    {notification.newField}
  </MjmlText>
) : null}
```

## Development

### Environment

```bash
# Dev mode: 6 minute batch interval
NODE_ENV=development

# Configure admin for error reports
SEED_DEV_ADMIN_EMAIL=developer@example.com
```

### Database Location

```typescript
const dbFilePath = join(
  process.env.DATA_DIR || process.cwd(),
  'web-db.sqlite',
)
```

### Debugging

```typescript
// Log events being processed
console.log(`Will handleEmailNotifs (${events.length} events)`)

// Check batch timing
console.log(`Next batch notifications will send in ${Math.round((nextSendTime - nowTime) / 1000)} seconds`)
```
