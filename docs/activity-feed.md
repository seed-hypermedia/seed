# Activity Feed System

The activity feed is a central component for tracking all changes in the Seed Hypermedia network. It powers the notification system and provides real-time updates to users.

## Overview

The activity feed tracks:
- Document updates (new references/versions)
- Comments (new and replies)
- Access control changes (capabilities granted/revoked)
- Contact additions
- Citations and mentions between documents

## Core Files

| File | Purpose |
|------|---------|
| `@shm/shared/src/api-activity.ts` | ListEvents API implementation |
| `@shm/shared/src/models/activity-service.ts` | Event loading, resolution, and type definitions |
| `frontend/apps/notify/app/email-notifier.ts` | Consumes feed for notifications |

## Event Types

### Raw Event Structure

Events come from the backend in two forms:

```typescript
export type HMActivityEvent =
  | {
      newBlob: HMNewBlobEvent  // Content blobs (documents, comments, etc.)
      account: string
      eventTime: HMTimestamp | null
      observeTime: HMTimestamp | null
    }
  | {
      newMention: Mention  // Reference/citation events
      account: string
      eventTime: HMTimestamp | null
      observeTime: HMTimestamp | null
    }
```

### NewBlob Event Types

When `event.data.case === 'newBlob'`, the `blobType` indicates the event type:

| blobType | Description | Resolution Function |
|----------|-------------|---------------------|
| `Comment` | New comment created | `loadCommentEvent()` |
| `Ref` | Document update (new reference) | `loadRefEvent()` |
| `Capability` | Access control change | `loadCapabilityEvent()` |
| `Contact` | Contact record change | `loadContactEvent()` |
| `DagPB` | IPFS DAG node (ignored) | returns `null` |
| `Profile` | Profile update (ignored) | returns `null` |

### NewMention Event Types

When `event.data.case === 'newMention'`, the `sourceType` indicates the citation type:

| sourceType | Description |
|------------|-------------|
| `doc/Embed` | Document embeds another document |
| `doc/Link` | Document links to another document |
| `doc/Button` | Document button references another document |
| `comment/Embed` | Comment embeds a document |
| `comment/Link` | Comment links to a document |
| `comment/Target` | Comment targets a document |

All mention types are resolved by `loadCitationEvent()`.

## Loaded Event Types

Raw events are resolved into rich "loaded" events with full metadata:

### LoadedCommentEvent

```typescript
type LoadedCommentEvent = {
  id: string
  type: 'comment'
  author: HMContactItem        // Author with metadata
  time: HMTimestamp
  comment: HMComment | null    // Full comment content
  commentId: UnpackedHypermediaId
  target: HMContactItem | null // Target document with metadata
  replyingComment: HMComment | null  // Parent comment if reply
  replyParentAuthor: HMContactItem | null
  replyCount: number
}
```

### LoadedRefEvent

```typescript
type LoadedRefEvent = {
  id: string
  type: 'doc-update'
  author: HMContactItem
  time: HMTimestamp
  docId: UnpackedHypermediaId
  document: HMDocument         // Full document content
}
```

### LoadedCapabilityEvent

```typescript
type LoadedCapabilityEvent = {
  id: string
  type: 'capability'
  author: HMContactItem
  time: HMTimestamp
  delegates: HMContactItem[]   // Who received the capability
  capabilityId: UnpackedHypermediaId
  capability: HMCapability     // Role, account, path, etc.
  target: {
    id: UnpackedHypermediaId | null
    metadata: HMMetadata | null
  }
}
```

### LoadedContactEvent

```typescript
type LoadedContactEvent = {
  id: string
  type: 'contact'
  author: HMContactItem
  time: HMTimestamp
  contact: {
    id: UnpackedHypermediaId
    name: string
    subject: HMContactItem     // Who was added as contact
  }
}
```

### LoadedCitationEvent

```typescript
type LoadedCitationEvent = {
  id: string
  type: 'citation'
  citationType: 'd' | 'c'      // 'd' = document, 'c' = comment
  author: HMContactItem
  time: HMTimestamp
  source: HMContactItem        // Document/comment containing the citation
  target: HMContactItem        // Document being cited
  targetFragment?: string      // Block ID being cited
  comment?: HMComment | null   // Comment content (if citationType === 'c')
  replyCount?: number
}
```

## API: ListEvents

### Input Parameters

```typescript
type HMListEventsInput = {
  pageSize?: number           // Events per page (default: 5)
  pageToken?: string          // Pagination cursor
  trustedOnly?: boolean       // Filter to trusted accounts
  filterAuthors?: string[]    // Filter by author UIDs
  filterEventType?: string[]  // Filter by event types
  filterResource?: string     // Filter by resource ID
  currentAccount?: string     // Current user (for contact resolution)
}
```

### Default Event Type Filter

If `filterEventType` is not provided, these types are included:

```typescript
[
  'Ref',           // Document updates
  'Capability',    // Access changes
  'Comment',       // New comments
  'DagPB',         // IPFS nodes (filtered out during resolution)
  'Profile',       // Profile updates (filtered out during resolution)
  'Contact',       // Contact additions
  'comment/Embed', // Comment embeds
  'doc/Embed',     // Document embeds
  'doc/Link',      // Document links
  'doc/Button',    // Document buttons
]
```

### Output

```typescript
type HMListEventsOutput = {
  events: LoadedEvent[]       // Resolved events
  nextPageToken: string       // For pagination
}
```

## Event Resolution Flow

```
┌─────────────────────────────────────────┐
│       grpcClient.activityFeed.listEvents │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│            listEventsImpl()              │
│   (returns raw HMActivityEvent[])       │
└────────────────┬────────────────────────┘
                 │
                 ▼ for each event
┌─────────────────────────────────────────┐
│           getEventType(event)           │
│   (determines: comment, ref, etc.)      │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│           resolveEvent(event)           │
│   ┌─────────────────────────────────┐   │
│   │ switch on eventType:            │   │
│   │  'comment' → loadCommentEvent() │   │
│   │  'ref'     → loadRefEvent()     │   │
│   │  'capability' → loadCapability..│   │
│   │  'contact' → loadContactEvent() │   │
│   │  'doc/*', 'comment/*'           │   │
│   │           → loadCitationEvent() │   │
│   └─────────────────────────────────┘   │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│         LoadedEvent (or null)           │
│   (fully resolved with metadata)        │
└─────────────────────────────────────────┘
```

## Event Loading Details

### loadCommentEvent()

1. Fetch comment by CID from `grpcClient.comments.getComment()`
2. Resolve author via `resolveAccount()`
3. If reply, fetch parent comment and its author
4. Fetch target document metadata
5. Get reply count via `getCommentReplyCount()`
6. Return `LoadedCommentEvent`

### loadRefEvent()

1. Unpack resource ID from `event.newBlob.resource`
2. Resolve author via `resolveAccount()`
3. Fetch document via `grpcClient.documents.getDocument()`
4. Transform document via `prepareHMDocument()`
5. Return `LoadedRefEvent`

### loadCapabilityEvent()

1. Resolve author
2. Unpack capability ID
3. Fetch capability via `grpcClient.accessControl.getCapability()`
4. Fetch target document
5. Resolve delegate account
6. Filter out 'none' and 'agent' roles
7. Return `LoadedCapabilityEvent`

### loadContactEvent()

1. Parse `extraAttrs` JSON for tsid and name
2. Construct contact ID: `{author}/{tsid}`
3. Fetch contact via `grpcClient.documents.getContact()`
4. Resolve subject account
5. Resolve author account
6. Return `LoadedContactEvent`

### loadCitationEvent()

1. Determine citationType from sourceType ('d' or 'c')
2. Unpack source and target IDs
3. Resolve author
4. Fetch source document
5. Fetch target document
6. If comment citation, fetch comment and reply count
7. Return `LoadedCitationEvent`

## Event ID Generation

Events need unique IDs for deduplication:

```typescript
function getEventId(event: PlainMessage<Event>) {
  if (event.data.case === 'newBlob') {
    return `blob-${event.data.value.cid}`
  }
  if (event.data.case === 'newMention') {
    const {sourceBlob, mentionType, target} = event.data.value
    return `mention-${sourceBlob?.cid}-${mentionType}-${target}`
  }
  return undefined
}
```

## Pagination

The feed supports cursor-based pagination:

```typescript
let currentPageToken: string | undefined

while (true) {
  const {events, nextPageToken} = await grpcClient.activityFeed.listEvents({
    pageToken: currentPageToken,
    pageSize: 10,
  })

  // Process events...

  if (!nextPageToken) break
  currentPageToken = nextPageToken
}
```

## Usage in Notification System

The notify service uses the feed to detect new events:

```typescript
// Get events since last processed
const eventsToProcess = await loadEventsAfterEventId(lastProcessedEventId)

// Process each event
for (const event of eventsToProcess) {
  await evaluateEventForNotifications(event, subscriptions, appendNotification)
}

// Update cursor
setNotifierLastProcessedEventId(getEventId(events[0]))
```

## Error Handling

Event resolution failures are logged but don't stop processing:

```typescript
const resolvedEvents = await Promise.allSettled(
  response.events.map((event) =>
    resolveEvent(grpcClient, event, input.currentAccount),
  ),
)

// Filter out failed promises and null values
const events = resolvedEvents
  .filter((result) => result.status === 'fulfilled' && result.value)
  .map((result) => (result as PromiseFulfilledResult<LoadedEvent>).value)
```

## Timestamps

Events have two timestamps:
- `eventTime`: When the event occurred (from the blob)
- `observeTime`: When the daemon observed the event

For notification timing, use the newer of the two:

```typescript
const considerationTime =
  eventTime && observeTime
    ? Math.max(eventTime.getTime(), observeTime.getTime())
    : eventTime || observeTime
```

## Performance Considerations

1. **Parallel Resolution**: Events are resolved in parallel via `Promise.allSettled()`
2. **Fail-Fast**: Individual event failures don't block others
3. **Timeouts**: Notify service uses 60s timeout for immediate, 120s for batch
4. **Cursor Tracking**: Prevents reprocessing same events
