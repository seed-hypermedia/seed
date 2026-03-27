# Notifications Service Architecture

This app is the notification backend for both the web and desktop clients. The code is split between three jobs:

- store notification-related state in SQLite
- translate daemon activity feed events into notification payloads and emails
- expose signed APIs for inbox, read state, and per-account email config

The main startup path is `entry.server.tsx`, which calls `initDatabase()` from `db.ts` and `initEmailNotifier()` from
`email-notifier.ts`.

## The two subscription systems

The first thing to understand is that this service currently has two overlapping notification models.

### 1. `notification_config`

This is the newer signed, account-owned config used by the web and desktop apps.

- stored in `db.ts` table `notification_config`
- accessed through `routes/hm.api.notification-config.tsx`
- authenticated by a signature over a CBOR payload
- optionally uses delegation through `verify-delegation.ts`
- currently drives immediate "my notifications" behavior

In practice this means:

- mentions are enabled
- replies are enabled
- top-level discussion notifications are enabled
- email address must be verified through `notification_email_verifications`

### 2. `email_subscriptions`

This is the older email subscription model, mostly for public site-level subscriptions.

- stored in `db.ts` table `email_subscriptions`
- created through `routes/hm.api.public-subscribe.$.tsx`
- managed by tokenized email settings routes like `hm.api.email-notif-token.tsx`
- keyed by `(accountId, email)`
- drives batch/digest-style site notifications

This is why the email settings page in `hm.email-notifications.tsx` shows two sections:

- "Site Activity" from legacy `email_subscriptions`
- "My Notifications" from signed `notification_config`

That split is real in the data model, not just in the UI.

## SQLite data model

`db.ts` is the actual center of gravity for this app. The tables that matter most are:

- `emails`
  - global email records, unsubscribe token, unsubscribe state
- `email_subscriptions`
  - legacy site-level batch subscriptions
- `notification_config`
  - signed per-account immediate notification config
- `notification_email_verifications`
  - pending verification tokens for `notification_config`
- `notification_read_state`
  - per-account watermark-based read state
- `notification_read_events`
  - per-account per-event read overrides above the watermark
- `notification_inbox`
  - persisted server-side inbox payloads
- `inbox_registration`
  - accounts that asked the server to persist inbox items for them
- `notifier_status`
  - cursors and batch send timestamps for the notifier loops

The migration history in `db.ts` also shows how the design evolved:

- early versions were email-only
- later versions added read state
- later still added inbox persistence and signed config

## Request auth model

The signed APIs all follow the same basic pattern:

1. client builds a CBOR payload with `signer`, `time`, `action`, and optional `accountUid`
2. client signs the encoded payload
3. service validates the signature in `validate-signature.ts`
4. service rejects stale requests older than 20 seconds
5. service resolves the effective account through `resolveAccountId()`

`resolveAccountId()` is important because it handles both modes:

- direct mode: signer key is the account
- delegated mode: signer key is acting for `accountUid`, and the daemon must confirm an `AGENT` capability

That delegated path is what lets the web app talk to the notify service with a local session key instead of the
account's root key.

## Event processing pipeline

`email-notifier.ts` runs the core event-processing loop. It polls the daemon activity feed and reuses the same event
evaluation logic for email delivery and inbox persistence.

### Startup and scheduling

`initEmailNotifier()` starts two loops:

- immediate loop every 15 seconds
- batch loop every 30 seconds, but it only sends when the batch interval has elapsed

The batch interval is:

- 4 hours in production
- 0.1 hours in development

The service stores feed cursors in `notifier_status`:

- `last_processed_event_id`
- `last_processed_batch_event_id`
- `batch_notifier_last_send_time`

### Event IDs and cursors

The notifier invents stable IDs in `getEventId()`:

- `blob-${cid}` for `newBlob`
- `mention-${sourceBlob.cid}-${mentionType}-${target}` for `newMention`

Those IDs are reused for:

- feed cursors
- inbox payload `feedEventId`
- read-state event markers

That shared ID scheme is what ties together the inbox and read-state systems.

### Event evaluation

`evaluateEventForNotifications()` handles two daemon event families:

- `newMention`
  - handled by `evaluateMentionEventForNotifications()`
- `newBlob`
  - `Ref` blobs go through `loadRefEvent()` and `evaluateDocUpdateForNotifications()`
  - `Comment` blobs go through `evaluateNewCommentForNotifications()`

The routing decision is centralized in `notification-routing.ts`:

- `mention`, `reply`, `discussion` => `immediate`
- `site-doc-update`, `site-new-discussion` => `batch`
- `user-comment` => ignored

For comment events, the actual reason classification comes from shared code in
`@shm/shared/models/notification-event-classifier`.

### Immediate notifications

Immediate notifications are built from verified `notification_config` records through `getImmediateSubscriptions()`.

That path currently means:

- verified config only
- one email address per account
- mention/reply/discussion emails
- email links can mark a notification read through `notification-read-redirect.ts`

### Batch notifications

Batch notifications are built from legacy `email_subscriptions` through `getBatchSubscriptions()`.

That path currently exists for:

- `site-new-discussion`
- intended `site-doc-update`

The digest email is sent through `createNotificationsEmail()`.

## Inbox persistence

The server-side inbox is not generated by the client. It is generated here and stored in SQLite.

The path is subtle:

1. client calls `register-inbox` on `hm.api.notification-inbox`
2. service stores the account in `inbox_registration`
3. immediate notifier loop calls `persistNotificationsForInboxRegisteredAccounts()`
4. that function replays the same event evaluator against synthetic "inbox subscriptions"
5. `notification-persistence.ts` converts internal `Notification` objects into `NotificationPayload`
6. payloads are inserted into `notification_inbox`

Important detail: batch processing does not persist inbox items directly. The code relies on the immediate pass to do
that first, then the batch loop only sends emails later.

That is why `processBatchNotifications()` contains this comment:

- inbox persistence already happened in the immediate pass

## Client-facing APIs

The notify service currently exposes four main behaviors.

### Signed APIs

- `hm.api.notification-config.tsx`
  - get/set/remove email config
  - resend verification email
- `hm.api.notification-read-state.tsx`
  - get merged read state
  - merge a new read-state snapshot
- `hm.api.notification-inbox.tsx`
  - register account for inbox persistence
  - fetch paginated inbox items

All three use the same signed CBOR request pattern.

### Token/public APIs

- `hm.api.public-subscribe.$.tsx`
  - create legacy site-level email subscriptions
- `hm.api.unsubscribe.tsx`
  - one-click unsubscribe
- `hm.api.email-notif-token.tsx`
  - token-based settings management
- `hm.notification-email-verify.tsx`
  - verify `notification_config` email address
- `hm.notification-read-redirect.tsx`
  - mark a notification read from an email link, then redirect

## What is confusing or unfinished

These are the places where the code looks transitional or harder to trust at a glance.

### `notifyOwnedDocChange` is exposed but not really implemented

The flag exists in:

- `db.ts`
- public subscribe payloads
- token settings UI
- email settings page
- notification routing

But `email-notifier.ts` still has a TODO in `evaluateDocUpdateForNotifications()`:

- `// if (sub.notifyOwnedDocChange) {} // TODO: implement this`

So today the service appears to have schema and UI support for document-update notifications, but not the actual
event-to-notification wiring.

### Inbox persistence is coupled to the immediate loop

This works, but it is indirect.

- the inbox is persisted by re-running event evaluation with synthetic subscriptions
- batch-only concepts are persisted during the immediate pass
- the batch loop assumes persistence already happened

You can follow it, but it is not obvious until you read both `processImmediateNotifications()` and
`processBatchNotifications()`.

### Some reason types look more aspirational than live

`NotificationPayload` supports:

- `site-doc-update`
- `site-new-discussion`
- `user-comment`

But in the current service code:

- `site-doc-update` is blocked by the TODO above
- inbox subscriptions prefer `discussion` over `site-new-discussion`
- `user-comment` only appears in the fallback conversion helper and not from active notifier routing

### There is real legacy/new overlap

The notify app is serving:

- a new signed per-account notification system
- an older tokenized email subscription system

The overlap is intentional for now, but it makes the overall design harder to explain because "notifications" does not
mean one thing in this app.
