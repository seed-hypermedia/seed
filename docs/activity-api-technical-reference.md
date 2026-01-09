# Activity API Technical Reference

## Overview

This document provides technical details about the Activity API implementation in the Seed codebase, intended to guide frontend integration for real-time data synchronization.

## API Endpoints

### ListEvents

**gRPC Service**: `ActivityFeed`
**Method**: `ListEvents(ListEventsRequest) → ListEventsResponse`
**File**: `proto/activity/v1alpha/activity.proto`

#### Request Parameters

```typescript
interface ListEventsRequest {
  pageSize?: number        // Default: 30 (server-side)
  pageToken?: string       // Cursor for pagination
  trustedOnly?: boolean    // Filter to trusted peers only
  filterAuthors?: string[] // Account UIDs (OR logic)
  filterEventType?: string[] // Event types (OR logic)
  filterResource?: string  // Resource IRI with wildcards (GLOB)
}
```

#### Response

```typescript
interface ListEventsResponse {
  events: Event[]
  nextPageToken: string
}
```

### Event Types

#### NewBlobEvent

Represents creation of a structural blob.

```typescript
interface NewBlobEvent {
  cid: string           // Content ID of the blob
  blobType: string      // Ref | Comment | Capability | Contact | Profile | DagPB
  author: string        // Account UID that created it
  resource: string      // Resource IRI (e.g., "hm://uid/path?v=version")
  extraAttrs: string    // JSON extra attributes
  blobId: number        // Internal database ID
  isPinned: boolean     // For link events
}
```

**Resource format for Ref events**: `hm://uid/path?v=version&l` (where `&l` suffix indicates latest version)

#### NewMention (Mention)

Represents a citation/reference between resources.

```typescript
interface Mention {
  source: string           // Source resource IRI
  sourceType: string       // doc/Link | doc/Embed | comment/Embed | etc.
  sourceContext: string    // Block ID or anchor
  sourceBlob: {
    cid: string
    author: string
    createTime: Timestamp
  }
  isExactVersion: boolean  // Pinned to specific version
  sourceDocument: string   // For comments: the containing document
  target: string           // Target resource IRI
  targetVersion: string    // Target version if specified
  targetFragment: string   // Block fragment or range
  mentionType: string      // embed | link | button
}
```

## Backend Implementation Details

**File**: `backend/api/activity/v1alpha/activity.go`

### Pagination Mechanism

The backend uses **structural timestamp in milliseconds** for pagination:

```go
// Cursor decoding
var cursorBlobID int64 = math.MaxInt64
if req.PageToken != "" {
    apiutil.DecodePageToken(req.PageToken, &cursorBlobID, nil)
}

// Query with cursor
WHERE structural_blobs.ts <= :cursor
ORDER BY structural_blobs.ts DESC
LIMIT :page_size

// Next page token
minTS := findMinimumTimestamp(cursorTS)
nextPageToken = apiutil.EncodePageToken(minTS-1, nil)
```

### Event Processing Pipeline

1. **Query NewBlob events** from `structural_blobs` table
2. **Query Mention events** from `resource_links` table
3. **Resolve versions** for Ref blobs (append `?v=version` to resource)
4. **Mark latest versions** with `&l` suffix
5. **Filter deleted resources** via `moved_resources` data
6. **Deduplicate** by (resource, type, author, eventTime)
7. **Sort by EventTime** (display order, not pagination order)
8. **Apply pageSize limit**

### Database Tables Involved

| Table | Purpose |
|-------|---------|
| `structural_blobs` | Typed blob metadata with timestamps |
| `blobs` | Raw blob data |
| `public_keys` | Author principal keys |
| `resource_links` | Links/mentions between resources |
| `resources` | Resource IRIs and metadata |
| `document_generations` | Latest document versions |

### Allowed Event Types (Backend Whitelist)

The backend validates event types against a hardcoded whitelist to prevent injection:

```go
// From activity.go line 164-175
validTypes := []string{
    "capability", "ref", "comment", "dagpb", "profile", "contact",
    "comment/target", "comment/embed",
    "doc/embed", "doc/link", "doc/button",
}
```

## Frontend Implementation

### Current gRPC Client Setup

**File**: `frontend/packages/shared/src/grpc-client.ts`

```typescript
type GRPCClient = {
  activityFeed: PromiseClient<typeof ActivityFeed>
  // ...
}
```

### Activity Service Types

**File**: `frontend/packages/shared/src/models/activity-service.ts`

```typescript
export type HMActivityEvent =
  | { newBlob: HMNewBlobEvent; account: string; eventTime: HMTimestamp; observeTime: HMTimestamp }
  | { newMention: Mention; account: string; eventTime: HMTimestamp; observeTime: HMTimestamp }

export type HMNewBlobEvent = {
  cid: string
  blobType: string
  author: string
  resource: string
  extraAttrs: string
  blobId: string
  isPinned: boolean
  mention?: Mention
}
```

### Calling the API

```typescript
// Direct gRPC call
const response = await grpcClient.activityFeed.listEvents({
  pageSize: 30,
  pageToken: cursor,
  filterEventType: ['Ref', 'Comment', 'Capability'],
  filterResource: 'hm://uid/*',  // Wildcard for all docs under uid
})

// Via shared implementation
import {listEventsImpl} from '@shm/shared/models/activity-service'

const events = await listEventsImpl(grpcClient, {
  pageSize: 30,
  filterResource: `hm://${uid}/*`,
})
```

## Resource IRI Patterns

### Format

```
hm://<account-uid>[/<path-segments>][?v=<version>][&l]
```

### Examples

| IRI | Description |
|-----|-------------|
| `hm://abc123` | Account root document |
| `hm://abc123/docs/readme` | Document at path `/docs/readme` |
| `hm://abc123/docs/*` | Wildcard: all docs under `/docs/` |
| `hm://abc123?v=bafk...` | Specific version |
| `hm://abc123?v=bafk...&l` | Latest version |

### Wildcard Matching (Backend)

The backend uses SQLite GLOB patterns:

```sql
WHERE resources.iri GLOB :filter_resource
```

- `*` matches any sequence of characters
- `?` matches single character
- `[abc]` matches character class

## Timestamps

### event_time

- Source: `structural_blobs.ts` (milliseconds since epoch)
- For Comments: Overridden to TSID timestamp
- Represents when the event actually occurred

### observe_time

- Source: `blobs.insert_time` (Unix seconds)
- When the blob was received locally
- Useful for detecting network lag

### Structural Timestamp

- Used for pagination (not display)
- Millisecond precision
- May differ from event_time due to HLC (Hybrid Logical Clock)

## Version Information

### Document Versions

For `Ref` events, the resource includes version info:

```
hm://uid/path?v=bafy...changeCID
```

### Latest Version Detection

Backend marks latest versions with `&l` suffix:

```go
if latest, ok := latestVersions[resource]; ok && latest == version {
    version += "&l"
}
```

Parse on frontend:

```typescript
const isLatest = resource.includes('&l')
const version = resource.match(/\?v=([^&]+)/)?.[1]
```

## Error Handling

### Page Token Out of Range

```go
// Backend returns error for invalid cursor
"Problem collecting activity feed, Probably token out of range or no feed at all"
```

**Frontend handling**: Reset cursor and retry

### Empty Resource Filter

If `filterResource` matches no resources, backend returns empty response:

```go
if len(initialEidsUpdated) == 0 {
    return &activity.ListEventsResponse{}, nil
}
```

## Performance Considerations

### Query Optimization

- Backend uses indexed queries on `structural_blobs.ts`
- Resource GLOB matching is efficient with proper indexes
- Author filtering uses hex-encoded principal for index usage

### Recommended Polling Intervals

| Use Case | Interval |
|----------|----------|
| Desktop app active sync | 3 seconds |
| Background sync | 30 seconds |
| Batch notifications | 4 hours |

### Page Size Guidelines

| Scenario | Recommended Size |
|----------|------------------|
| Initial cursor setup | 1-5 |
| Normal polling | 30 |
| Catch-up after disconnect | 100 |

## Event Deduplication

### Backend Deduplication

Events are deduplicated by:
- Resource IRI
- Event type
- Author
- EventTime (nanosecond precision)

### Frontend Deduplication

Use event ID for tracking:

```typescript
function getEventId(event: HMActivityEvent): string {
  if ('newBlob' in event) {
    return `blob-${event.newBlob.cid}`
  }
  if ('newMention' in event) {
    const {sourceBlob, mentionType, target} = event.newMention
    return `mention-${sourceBlob?.cid}-${mentionType}-${target}`
  }
  throw new Error('Unknown event type')
}
```

## Integration with React Query

### Query Key Structure

```typescript
// Activity feed query
queryKey: [queryKeys.ACTIVITY_FEED, filterResource, filterAuthors, filterEventType, currentAccount]
```

### Invalidation Targets

Map event types to query keys:

| Event Type | Query Keys to Invalidate |
|------------|-------------------------|
| `Ref` | ENTITY, RESOLVED_ENTITY, DOC_LIST_DIRECTORY |
| `Comment` | COMMENTS, DOCUMENT_DISCUSSION |
| `Capability` | CAPABILITIES, ACCOUNT_CAPABILITIES |
| `Contact` | CONTACTS_ACCOUNT, CONTACTS_SUBJECT |
| `doc/*` or `comment/*` | CITATIONS, DOC_CITATIONS |

## Subscriptions Service

### Subscribe to Resource

```typescript
await grpcClient.subscriptions.subscribe({
  account: uid,
  path: '/docs/readme',
  recursive: true,  // Include subdirectories
})
```

This triggers:
1. Database subscription record
2. Optional discovery sync (async by default)

### List Active Subscriptions

```typescript
const {subscriptions} = await grpcClient.subscriptions.listSubscriptions({
  pageSize: 100,
})

// Returns:
interface Subscription {
  account: string
  path: string
  recursive: boolean
  since: Timestamp  // When subscription started
}
```

## Debugging Tips

### Enable Activity Logging

```bash
# In daemon logs
SEED_LOG_LEVEL=debug ./dev run-desktop
```

### Check Event Flow

```typescript
// Add to activity poller
console.log('Event:', {
  type: event.newBlob?.blobType || 'mention',
  resource: event.newBlob?.resource || event.newMention?.target,
  eventTime: event.eventTime,
  observeTime: event.observeTime,
})
```

### Verify Cursor Progression

```typescript
console.log('Cursor:', {
  lastEventId: this.state.lastEventId,
  newEvents: events.length,
  nextPageToken: response.nextPageToken,
})
```
