# Notifications Service Architecture

This is the canonical service-side map for Seed notifications and emails.

Start here, then read the client-specific docs:

- service entry-point overview: [`../README.md`](../README.md)
- web client: [`../../web/app/NOTIFICATIONS_WEB_ARCHITECTURE.md`](../../web/app/NOTIFICATIONS_WEB_ARCHITECTURE.md)
- desktop client:
  [`../../desktop/src/NOTIFICATIONS_DESKTOP_ARCHITECTURE.md`](../../desktop/src/NOTIFICATIONS_DESKTOP_ARCHITECTURE.md)

## What This Service Actually Does

The notify service has four jobs:

1. Persist canonical notification state in SQLite
   - schema + migrations: [`./db.ts`](./db.ts)
2. Turn daemon activity-feed events into notification objects
   - event loop + classification: [`./email-notifier.ts`](./email-notifier.ts)
3. Deliver emails
   - SMTP sender: [`./mailer.ts`](./mailer.ts)
   - email templates/rendering: [`../../emails/notifier.tsx`](../../emails/notifier.tsx)
4. Expose signed APIs for clients
   - unified state route: [`./routes/hm.api.notifications.tsx`](./routes/hm.api.notifications.tsx)

The startup path is:

- [`./entry.server.tsx`](./entry.server.tsx)
- [`initDatabase()` in `./db.ts`](./db.ts)
- [`initEmailNotifier()` in `./email-notifier.ts`](./email-notifier.ts)

## The Two Notification Systems

The notify service currently hosts two overlapping products.

### 1. Signed account-owned notification state

This is the newer system used by first-party web and desktop clients.

- transport:
  [`../../../packages/shared/src/models/notification-service.ts`](../../../packages/shared/src/models/notification-service.ts)
- server reducer/persistence: [`./notification-state.ts`](./notification-state.ts)
- route: [`./routes/hm.api.notifications.tsx`](./routes/hm.api.notifications.tsx)
- state model:
  [`../../../packages/shared/src/models/notification-state.ts`](../../../packages/shared/src/models/notification-state.ts)

This system owns:

- inbox payloads from [`notification_inbox`](./db.ts)
- read state from [`notification_read_state`](./db.ts) and [`notification_read_events`](./db.ts)
- account email config from [`notification_config`](./db.ts)
- verification flow from [`notification_email_verifications`](./db.ts)

### 2. Legacy public email subscriptions

This is the older site-level email system.

- subscribe route: [`./routes/hm.api.public-subscribe.$.tsx`](./routes/hm.api.public-subscribe.$.tsx)
- token management route: [`./routes/hm.api.email-notif-token.tsx`](./routes/hm.api.email-notif-token.tsx)
- settings page: [`./routes/hm.email-notifications.tsx`](./routes/hm.email-notifications.tsx)
- storage: [`email_subscriptions` and `emails` in `./db.ts`](./db.ts)

This system owns:

- site-level batch subscription flags
- global unsubscribe tokens
- the tokenized settings page linked from emails

These systems share the same database and the same notifier loop, but they do not share the same request protocol.

## SQLite Data Model

The center of gravity is [`./db.ts`](./db.ts). The tables that matter are:

- `emails`
  - global email identity, unsubscribe token, unsubscribe state
- `email_subscriptions`
  - legacy public site subscriptions keyed by `(id, email)`
- `notification_config`
  - canonical email config for an account-owned notification state
- `notification_email_verifications`
  - pending verification tokens for `notification_config`
- `notification_read_state`
  - watermark row per account
- `notification_read_events`
  - explicit read markers above the watermark
- `notification_inbox`
  - persisted `NotificationPayload` rows
- `notifier_status`
  - cursors and batch send timestamps

There is also `inbox_registration`, but see the suspect-code section below.

## Canonical Signed API

The current first-party clients talk to one signed endpoint:

- server: [`./routes/hm.api.notifications.tsx`](./routes/hm.api.notifications.tsx)
- client:
  [`../../../packages/shared/src/models/notification-service.ts`](../../../packages/shared/src/models/notification-service.ts)

The request shape is:

1. Build an unsigned payload with `action`, `signer`, `time`, and optional `accountUid`
2. CBOR-encode it
3. Sign the CBOR bytes
4. Send the same payload plus `sig`
5. Server re-encodes the unsigned payload and verifies the signature
6. Server resolves the effective account via [`./verify-delegation.ts`](./verify-delegation.ts)

The route supports two actions:

- `get-notification-state`
- `apply-notification-actions`

The response is a full snapshot:

- inbox page
- config state
- read state

On the server, those actions are implemented by:

- [`getNotificationStateSnapshot(...)`](./notification-state.ts)
- [`applyNotificationActionsForAccount(...)`](./notification-state.ts)

## Signature and Delegation Model

Signature verification is in [`./validate-signature.ts`](./validate-signature.ts).

- supports compressed P-256 keys
- also supports Ed25519 keys
- rejects bad signatures by re-verifying against the unsigned CBOR payload

Delegation resolution is in [`./verify-delegation.ts`](./verify-delegation.ts).

- if `accountUid` is absent, the account ID is derived directly from the signer key
- if `accountUid` is present and differs from the signer UID, the service asks the daemon whether the signer has an
  `AGENT` capability for that account

That is what allows the web app to use a local delegated session key instead of the account's root key.

## Event Processing Pipeline

The notifier loop is in [`./email-notifier.ts`](./email-notifier.ts). It is the real producer of both emails and
server-side inbox rows.

### Startup and schedules

[`initEmailNotifier()`](./email-notifier.ts):

- does one immediate run at startup
- starts an immediate loop every 15 seconds
- starts a batch loop every 30 seconds

Batch sending is gated by `batch_notifier_last_send_time` in [`notifier_status`](./db.ts):

- production interval: 4 hours
- development interval: 0.1 hours

### Feed cursors

The notifier uses `notifier_status` values from [`./db.ts`](./db.ts):

- `last_processed_event_id`
- `last_processed_batch_event_id`
- `batch_notifier_last_send_time`

Event IDs are synthesized by [`getEventId(...)`](./email-notifier.ts):

- `blob-${cid}` for `newBlob`
- `mention-${sourceBlob.cid}-${mentionType}-${target}` for `newMention`

Those IDs are reused as:

- notifier cursors
- inbox `feedEventId`
- read-state event IDs

### Pulling daemon events

New events are loaded by [`loadEventsAfterEventId(...)`](./email-notifier.ts), which pages through:

- [`grpcClient.activityFeed.listEvents(...)`](./notify-request.ts)

Important behavior:

- it stops after `MAX_EVENT_PAGES`
- it returns partial results on abort/error
- it falls back to fingerprint matching if exact event IDs do not match

## Event Evaluation

The central dispatcher is [`evaluateEventForNotifications(...)`](./email-notifier.ts).

It handles two daemon event families:

### `newMention`

- evaluated by [`evaluateMentionEventForNotifications(...)`](./email-notifier.ts)
- produces `mention`

This path:

- parses the mention target/source
- loads author metadata and source metadata
- builds the destination URL
- queues notifications only for subscriptions whose `id` matches the target account

### `newBlob`

Two blob types matter:

- `Ref`
  - loaded by [`loadRefEvent(...)`](./email-notifier.ts)
  - evaluated by [`evaluateDocUpdateForNotifications(...)`](./email-notifier.ts)
- `Comment`
  - loaded from daemon comments API
  - evaluated by [`evaluateNewCommentForNotifications(...)`](./email-notifier.ts)

Comment classification uses shared logic from:

- [`../../../packages/shared/src/models/notification-event-classifier.ts`](../../../packages/shared/src/models/notification-event-classifier.ts)

Routing by reason is centralized in:

- [`./notification-routing.ts`](./notification-routing.ts)

Current delivery kinds are:

- `mention` -> immediate
- `reply` -> immediate
- `discussion` -> immediate
- `site-new-discussion` -> batch
- `site-doc-update` -> batch
- `user-comment` -> ignored

## Subscription Resolution

The notifier builds two subscription sets.

### Immediate subscriptions

Built by [`getImmediateSubscriptions(...)`](./email-notifier.ts) from:

- [`getAllNotificationConfigs()`](./db.ts)
- [`getAllEmails()`](./db.ts)

Current rules:

- email must exist in `emails`
- email must not be globally unsubscribed
- `notification_config.verifiedTime` must be present
- mentions, replies, and discussions are all effectively enabled

That means the signed config is currently mostly "email on/off + verified/not verified", not a fine-grained preference
matrix.

### Batch subscriptions

Built by [`getBatchSubscriptions(...)`](./email-notifier.ts) from legacy [`email_subscriptions`](./db.ts).

Current legacy flags:

- `notifySiteDiscussions`
- `notifyOwnedDocChange`

Only `notifySiteDiscussions` is actually wired end to end today.

## Immediate Email Workflow

Immediate email processing is:

1. [`processImmediateNotifications(...)`](./email-notifier.ts)
2. [`collectNotificationsForEvents(...)`](./email-notifier.ts)
3. [`sendImmediateNotificationEmails(...)`](./email-notifier.ts)
4. [`sendEmail(...)`](./mailer.ts)

Immediate email templates come from:

- [`createMentionEmail(...)`](../../emails/notifier.tsx)
- [`createReplyEmail(...)`](../../emails/notifier.tsx)
- [`createDiscussionEmail(...)`](../../emails/notifier.tsx)

Before sending, immediate notifications may get an email action URL via:

- [`buildNotificationReadRedirectUrl(...)`](./notification-read-redirect.ts)

That link:

- marks the event read for the account
- then redirects to the real target document/comment URL

## Batch Email Workflow

Batch email processing is:

1. [`handleBatchNotifications(...)`](./email-notifier.ts)
2. [`sendBatchNotifications(...)`](./email-notifier.ts)
3. [`processBatchNotifications(...)`](./email-notifier.ts)
4. [`sendBatchNotificationEmails(...)`](./email-notifier.ts)
5. [`createNotificationsEmail(...)`](../../emails/notifier.tsx)

Current batch reasons produced by live code:

- `site-new-discussion`

Intended but not fully wired:

- `site-doc-update`

## Inbox Persistence

The inbox consumed by web/desktop clients is stored in:

- [`notification_inbox` in `./db.ts`](./db.ts)

Rows are written by:

- [`persistNotificationsForInboxAccounts(...)`](./notification-persistence.ts)

The conversion from internal notifier objects to shared client payloads happens in:

- [`notificationToPayload(...)`](./notification-persistence.ts)
- [`../../../packages/shared/src/models/notification-payload.ts`](../../../packages/shared/src/models/notification-payload.ts)

### Important current behavior

Today, inbox writes happen from [`processImmediateNotifications(...)`](./email-notifier.ts), after immediate
notifications are collected.

Practical consequence:

- immediate account-owned notifications are persisted to the inbox
- batch-only legacy site notifications are not clearly persisted by the active code path

This is one of the main places where the old architecture docs were overstating the current behavior.

## Read-State Workflow

Read-state semantics are defined in shared pure logic:

- [`../../../packages/shared/src/models/notification-read-logic.ts`](../../../packages/shared/src/models/notification-read-logic.ts)

Server persistence is in:

- [`mergeNotificationReadState(...)`](./db.ts)
- [`replaceNotificationReadState(...)`](./db.ts)

The model is watermark-based:

- `markAllReadAtMs` marks all events at or before a timestamp as read
- `readEvents` stores explicit reads above the watermark

This keeps "mark all as read" cheap and makes unread toggling reversible without one database row per notification.

## Email Config + Verification Workflow

The canonical config path is implemented in:

- shared state reducer:
  [`../../../packages/shared/src/models/notification-state.ts`](../../../packages/shared/src/models/notification-state.ts)
- server persistence: [`persistNotificationConfigState(...)` in `./notification-state.ts`](./notification-state.ts)

Verification email generation:

- [`createNotificationVerificationEmail(...)`](../../emails/notifier.tsx)

Verification link handling:

- route: [`./routes/hm.notification-email-verify.tsx`](./routes/hm.notification-email-verify.tsx)
- state transition: [`./notification-email-verification.ts`](./notification-email-verification.ts)

The verification flow is:

1. client applies `set-config`
2. server stores `notification_config`
3. server stores or updates `notification_email_verifications`
4. server sends verification email
5. user clicks verify link
6. server sets `verifiedTime`
7. immediate notifier now treats the config as eligible for emails

## Legacy Public Subscribe Workflow

The older public email flow is still active.

Subscribe:

- [`./routes/hm.api.public-subscribe.$.tsx`](./routes/hm.api.public-subscribe.$.tsx)

Welcome email:

- [`./emails.tsx`](./emails.tsx)
- [`createWelcomeEmail(...)`](../../emails/notifier.tsx)

Token settings:

- loader/action: [`./routes/hm.api.email-notif-token.tsx`](./routes/hm.api.email-notif-token.tsx)
- page: [`./routes/hm.email-notifications.tsx`](./routes/hm.email-notifications.tsx)

One-click unsubscribe:

- [`./routes/hm.api.unsubscribe.tsx`](./routes/hm.api.unsubscribe.tsx)

This token page shows both:

- legacy site subscriptions from `email_subscriptions`
- signed account-owned configs from `notification_config`

That UI split is real, not accidental.

## Suspect / Transitional / Likely Dead Code

These are the parts that deserve extra skepticism.

### The old signed routes look retained for compatibility, not current first-party use

Routes still present:

- [`./routes/hm.api.notification-config.tsx`](./routes/hm.api.notification-config.tsx)
- [`./routes/hm.api.notification-read-state.tsx`](./routes/hm.api.notification-read-state.tsx)
- [`./routes/hm.api.notification-inbox.tsx`](./routes/hm.api.notification-inbox.tsx)

But current first-party clients use:

- [`./routes/hm.api.notifications.tsx`](./routes/hm.api.notifications.tsx)

I would treat the older routes as compatibility or transitional surfaces until proven otherwise.

### `register-inbox` and `inbox_registration` appear unwired

The table and helpers exist in [`./db.ts`](./db.ts), but there are no live call sites for:

- `registerInboxAccount(...)`
- `getInboxRegisteredAccounts(...)`
- `isInboxRegistered(...)`

Also, the old inbox route's `register-inbox` branch currently returns `{registered: true}` without writing anything.

### `notifyOwnedDocChange` is exposed but not implemented

The flag exists in:

- schema/storage in [`./db.ts`](./db.ts)
- public subscribe route in [`./routes/hm.api.public-subscribe.$.tsx`](./routes/hm.api.public-subscribe.$.tsx)
- token settings route/page in [`./routes/hm.api.email-notif-token.tsx`](./routes/hm.api.email-notif-token.tsx) and
  [`./routes/hm.email-notifications.tsx`](./routes/hm.email-notifications.tsx)
- email welcome flow in [`./emails.tsx`](./emails.tsx)

But notifier wiring is still missing in [`evaluateDocUpdateForNotifications(...)`](./email-notifier.ts).

### Some notification reasons are richer in schema than in live production flow

The shared payload schema supports:

- `site-doc-update`
- `site-new-discussion`
- `user-comment`

But current live production code strongly suggests:

- `site-doc-update` is blocked by the TODO above
- `user-comment` is schema-only / fallback-only
- `site-new-discussion` is batch-oriented and not obviously persisted into the inbox by the active path

### Historical notes are stale

[`../../../../email-notification-signing-notes.md`](../../../../email-notification-signing-notes.md) documents the
earlier per-feature signed API shape and should be read as historical context, not the current implementation.

### `createDesktopNotificationsEmail(...)` looks unused

[`../../emails/notifier.tsx`](../../emails/notifier.tsx) exports `createDesktopNotificationsEmail(...)`, but there are
no production call sites in this repository.
