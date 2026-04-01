# Notifications System Review

This document is a code-review and redesign memo for the current notifications stack. It is intentionally more
opinionated than the architecture docs.

Read alongside:

- overview: [`./README.md`](./README.md)
- notify service map: [`./app/NOTIFICATIONS_SERVICE_ARCHITECTURE.md`](./app/NOTIFICATIONS_SERVICE_ARCHITECTURE.md)
- web client map: [`../web/app/NOTIFICATIONS_WEB_ARCHITECTURE.md`](../web/app/NOTIFICATIONS_WEB_ARCHITECTURE.md)
- desktop client map:
  [`../desktop/src/NOTIFICATIONS_DESKTOP_ARCHITECTURE.md`](../desktop/src/NOTIFICATIONS_DESKTOP_ARCHITECTURE.md)

## Executive Summary

The current system has one strong center and one weak center.

The strong center is the newer signed notification-state protocol:

- shared request transport:
  [`../../packages/shared/src/models/notification-service.ts`](../../packages/shared/src/models/notification-service.ts)
- shared state model and reducer:
  [`../../packages/shared/src/models/notification-state.ts`](../../packages/shared/src/models/notification-state.ts)
- server reducer and persistence: [`./app/notification-state.ts`](./app/notification-state.ts)
- unified signed route: [`./app/routes/hm.api.notifications.tsx`](./app/routes/hm.api.notifications.tsx)

That path is relatively easy to explain: fetch one snapshot, reduce actions optimistically, persist canonical state on
the server, return the new snapshot.

The weak center is the producer pipeline in [`./app/email-notifier.ts`](./app/email-notifier.ts). That file currently
mixes:

- feed polling
- cursor management
- daemon API fan-out
- notification classification
- inbox projection
- email rendering input assembly
- delivery timing

That coupling makes the system harder to reason about and less robust than the signed state API that sits on top of it.

## Highest-Priority Findings

### 1. Event cursors advance even when processing fails

Code:

- batch loop: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 276-285
- immediate loop: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 361-369
- feed loader returns partial results on failure: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 1384-1391

Why this is risky:

- immediate processing catches errors and still calls `markEventsAsProcessed(...)`
- batch processing catches errors and still updates `last_processed_batch_event_id`
- the feed loader can return a partial event slice after timeout/error, which is then eligible to be marked as processed

That means transient failures can permanently drop notifications.

This is the single biggest robustness problem in the current system.

### 2. Delivery, inbox persistence, and cursor advancement are not atomic

Code:

- immediate send path: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 630-656 and 690-721
- cursor advancement: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 343-375
- inbox persistence: [`./app/notification-persistence.ts`](./app/notification-persistence.ts)

Why this is risky:

- immediate emails are sent before inbox rows are persisted
- if sending fails midway, the function exits before `persistNotificationsForInboxAccounts(...)`
- the outer loop still advances the cursor

So the system can end up in any of these states:

- email delivered, inbox missing
- some emails delivered, some not delivered
- nothing persisted, but cursor moved forward

The root problem is that the system treats "send email now" as the primary unit of work instead of "persist a durable
notification record, then deliver projections from it".

### 3. The "old event" guard can silently drop immediate notifications after downtime

Code:

- age gate: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 818-826

Why this is risky:

- the skip window is tied to `emailBatchNotifIntervalHours`
- that same gate runs inside the shared evaluator for all delivery kinds
- if the service is down longer than the batch interval, older mention/reply/discussion events are skipped too

The current behavior is effectively "do not backfill anything older than the batch cadence", even for immediate
account-owned notifications.

### 4. Batch notifications are not persisted to the inbox, despite comments claiming they already were

Code:

- immediate inbox projection: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 702-721
- batch path comment: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 724-738

Why this is risky:

- only the immediate path persists inbox notifications
- the batch path explicitly does not
- the comment says batch events were already persisted earlier, which is not true for batch-only reasons such as
  `site-new-discussion`

This creates conceptual drift between "email reasons we support" and "inbox reasons we actually persist".

### 5. Inbox pagination can skip records with identical timestamps

Code:

- schema and index: [`./app/db.ts`](./app/db.ts), lines 302-310
- inbox page query: [`./app/db.ts`](./app/db.ts), lines 463-473 and 872-891

Why this is risky:

- pagination uses `beforeMs`
- SQL pages with `eventAtMs < ?`
- ordering is only `ORDER BY eventAtMs DESC`

If page N ends on timestamp `T` and there are more rows with the same `eventAtMs = T`, page N+1 will skip them.

This is a lower-level bug than the cursor issues, but it is a real correctness problem.

### 6. The service is still hosting two different notification products

Code:

- signed state route: [`./app/routes/hm.api.notifications.tsx`](./app/routes/hm.api.notifications.tsx)
- public subscribe route: [`./app/routes/hm.api.public-subscribe.$.tsx`](./app/routes/hm.api.public-subscribe.$.tsx),
  lines 13-19 and 37-47
- token settings route: [`./app/routes/hm.api.email-notif-token.tsx`](./app/routes/hm.api.email-notif-token.tsx)
- token settings page: [`./app/routes/hm.email-notifications.tsx`](./app/routes/hm.email-notifications.tsx)

The system is harder to understand because it combines:

- account-owned signed notifications
- public email-only site subscriptions

Those are both valid product surfaces, but they are not the same model, and today they share a runtime more than they
share a coherent domain.

## Recommended Target Architecture

The main structural change should be: make notification production durable before delivery.

### Target mental model

1. Feed ingestion
   - read daemon events
   - normalize them into stable internal events
   - advance cursors only after the normalized events are durably recorded
2. Notification projection
   - turn normalized events into canonical per-account or per-email notification records
   - write those records once
3. Delivery projection
   - derive inbox rows and email jobs from the canonical notification records
   - retry email jobs independently
4. Client state API
   - keep serving one canonical signed snapshot for first-party clients
5. Legacy compatibility
   - map old public subscription flows onto the same subscription domain or isolate them clearly as a separate module

### Concrete restructuring direction

`./app/email-notifier.ts` is doing too many jobs. A more understandable split would be:

- `notification-feed.ts`
  - feed polling
  - cursor management
  - retry policy
- `notification-evaluator.ts`
  - pure or mostly-pure classification from normalized event input to notification candidates
- `notification-subscriptions.ts`
  - account/email subscription resolution
- `notification-projector.ts`
  - persist canonical notification records
  - persist inbox projections
- `notification-email-jobs.ts`
  - enqueue/send/retry email delivery
- `notification-runner.ts`
  - orchestration only

That refactor would make it much easier to test each layer independently.

### Data model direction

The current tables are enough for the read-state API, but not ideal for robust production. A stronger model would add a
durable per-notification record or job table, for example:

- `notification_events`
  - normalized source events, keyed by stable event ID
- `notification_records`
  - canonical account/email notifications, keyed by `(recipient, eventId, reason)`
- `notification_email_jobs`
  - delivery attempts, status, retry timing

The inbox should then be a projection of `notification_records`, not a side effect of successful immediate email sends.

## Layered Review

### 1. Product Boundary Review

Relevant code:

- signed API: [`./app/routes/hm.api.notifications.tsx`](./app/routes/hm.api.notifications.tsx)
- shared transport:
  [`../../packages/shared/src/models/notification-service.ts`](../../packages/shared/src/models/notification-service.ts)
- public subscribe flow: [`./app/routes/hm.api.public-subscribe.$.tsx`](./app/routes/hm.api.public-subscribe.$.tsx)
- token settings UI: [`./app/routes/hm.email-notifications.tsx`](./app/routes/hm.email-notifications.tsx)

What is working:

- first-party clients now have one clear signed endpoint
- the public email-only flow still exists as a compatibility path

What is confusing:

- both flows are called "notifications", but they do not represent the same ownership model
- signed state is account-centric
- public subscriptions are email-centric
- the settings page mixes both by showing public subscriptions and "my notifications" in one token view

Recommended restructure:

- explicitly name these as two products in code structure:
  - `account_notifications`
  - `public_email_subscriptions`
- either route both through one shared subscription model, or isolate them into separate service modules with a thin
  shared delivery layer

Review judgment:

- the coexistence is real, not dead code
- the confusion is architectural, not just naming

### 2. Signed State API Review

Relevant code:

- server route: [`./app/routes/hm.api.notifications.tsx`](./app/routes/hm.api.notifications.tsx)
- server state reducer: [`./app/notification-state.ts`](./app/notification-state.ts)
- shared state model:
  [`../../packages/shared/src/models/notification-state.ts`](../../packages/shared/src/models/notification-state.ts)
- shared hooks: [`../../packages/shared/src/models/notifications.ts`](../../packages/shared/src/models/notifications.ts)

What is strong:

- one snapshot shape for inbox, config, and read state
- one mutation model reused by web, desktop, and server
- reducer-driven optimistic state is easy to follow

What is limited:

- `NotificationConfigState` only models email + verification, not per-reason preferences
- richer legacy flags such as `notifyOwnedDocChange` live outside the signed canonical model
- verification email sending is coupled directly into config persistence in
  [`./app/notification-state.ts`](./app/notification-state.ts), lines 67-110 and 128-145

Recommended restructure:

- keep this API as the canonical surface
- decide whether signed config should remain intentionally narrow or become the one true preference model
- if preferences expand, move legacy booleans into the shared canonical state rather than keeping two parallel config
  vocabularies

Review judgment:

- this is the clearest part of the current system
- future cleanup should preserve this path rather than replacing it

### 3. Subscription Model Review

Relevant code:

- immediate subscriptions: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 389-405
- batch subscriptions: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 407-425
- legacy subscription storage: [`./app/db.ts`](./app/db.ts), lines 323-374
- signed config storage: [`./app/db.ts`](./app/db.ts), lines 375-417

What is happening now:

- immediate notifications are effectively "verified email on/off for this account"
- batch notifications come from legacy `email_subscriptions`
- the runtime combines them only at evaluation time

What looks suspect:

- `notifyOwnedDocChange` is exposed in storage and UI, but the producer still has a TODO in
  [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 903-919
- `site-doc-update` exists in routing and payload code, but the corresponding end-to-end producer path is incomplete

Recommended restructure:

- define one internal subscription type with fields for:
  - recipient kind
  - account scope or site scope
  - delivery channels
  - reason preferences
- let signed config and public subscribe routes each populate that same domain model

Review judgment:

- today there is not one notification subscription system; there are two partially overlapping ones

### 4. Event Ingestion and Evaluation Review

Relevant code:

- feed loading: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 1352-1437
- event dispatcher: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 807-888
- mention evaluation: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 950-1090
- comment evaluation: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 1092-1311
- ref/doc evaluation: [`./app/email-notifier.ts`](./app/email-notifier.ts), lines 890-920 and 1440-1514

What is good:

- routing by reason is centralized in [`./app/notification-routing.ts`](./app/notification-routing.ts)
- shared comment classification logic is reused from
  [`../../packages/shared/src/models/notification-event-classifier.ts`](../../packages/shared/src/models/notification-event-classifier.ts)

What is hard to follow:

- evaluation is not just classification; it also performs many daemon/network lookups
- mention/comment evaluation interleaves enrichment, filtering, and fan-out
- several per-subscription loops do extra account lookups inside the loop

Examples:

- mention path loads author metadata, source metadata, comment data, then loads subject account metadata inside the
  subscription loop at lines 1013-1015 and 1055-1059
- comment path loads author metadata, target doc metadata, parent chain, then may load subject account metadata again
  inside the loop at lines 1125-1157, 1183-1191, and 1205-1220

Recommended restructure:

- separate normalization from fan-out
- add request-scoped caches for account/doc/comment lookups
- make the evaluator return candidate notifications first, then enrich/persist/deliver in later phases

Review judgment:

- the complexity here is both conceptual and operational
- this is the right place to reduce branching and I/O coupling

### 5. Inbox and Read-State Review

Relevant code:

- inbox persistence: [`./app/notification-persistence.ts`](./app/notification-persistence.ts)
- inbox table/query: [`./app/db.ts`](./app/db.ts), lines 302-310 and 872-891
- read-state persistence: [`./app/db.ts`](./app/db.ts), lines 760-845
- signed server snapshot: [`./app/notification-state.ts`](./app/notification-state.ts), lines 113-146

What is strong:

- read-state modeling is reasonably disciplined
- the watermark plus explicit event set is a sensible compromise
- server and clients share the same reducer semantics

What is weak:

- inbox persistence is downstream of immediate email success
- inbox pagination cursor is not stable across timestamp ties
- batch-only notification reasons are not clearly part of the inbox contract

Recommended restructure:

- make inbox rows a projection from canonical notification records
- paginate with a compound cursor such as `(eventAtMs, feedEventId)` instead of only `beforeMs`
- define clearly whether batch/public notifications belong in first-party inbox state

Review judgment:

- the read-state layer is cleaner than the inbox-production layer
- the inbox contract is currently under-specified

### 6. Email Rendering and Delivery Review

Relevant code:

- SMTP sender: [`./app/mailer.ts`](./app/mailer.ts)
- immediate email builders: [`../emails/notifier.tsx`](../emails/notifier.tsx)
- batch email builder: [`../emails/notifier.tsx`](../emails/notifier.tsx), lines 600-833

What is good:

- rendering is mostly isolated from the service runtime
- templates are richer than the legacy route structure might suggest
- unsubscribe and read-redirect URLs are explicitly attached rather than buried in templates

What looks risky or suspect:

- `sendEmail(...)` logs and returns if no transporter is configured, in [`./app/mailer.ts`](./app/mailer.ts), lines
  42-45
- callers treat that as success, so misconfiguration can look like successful processing
- `createDesktopNotificationsEmail(...)` is exported from [`../emails/notifier.tsx`](../emails/notifier.tsx), lines
  840-920, but I did not find first-party call sites in this repo
- email/template support for `site-doc-update` is ahead of the producer actually generating those notifications

Recommended restructure:

- treat delivery as a job with explicit success/failure status
- keep email rendering separate, but make it consume persisted notification records rather than live evaluator objects
- either wire `createDesktopNotificationsEmail(...)` back into a real path or remove it

Review judgment:

- the templates are ahead of the core delivery architecture

### 7. Web Client Review

Relevant code:

- web adapter: [`../web/app/web-notifications.ts`](../web/app/web-notifications.ts)
- session source of notify host: [`../web/app/auth-session.ts`](../web/app/auth-session.ts)
- callback persistence: [`../web/app/routes/hm.auth.callback.tsx`](../web/app/routes/hm.auth.callback.tsx)
- shared hooks: [`../../packages/shared/src/models/notifications.ts`](../../packages/shared/src/models/notifications.ts)

What is strong:

- the web client is thin
- browser-side signing is isolated to one file
- all state meaning comes from the shared protocol and reducer

What could be simpler:

- the only truly web-specific concerns are signer construction and host lookup
- the rest of `web-notifications.ts` is mostly wrappers around shared hooks
- the notify host being stored on local identity/session is correctable but easy to miss when reading the app for the
  first time

Recommended restructure:

- keep the web adapter tiny: signer + host + maybe optimistic mutation wrapper
- document the session-derived host more aggressively, because it is a real behavior dependency
- if the wrapper layer keeps growing, move more of it into the shared package and keep only platform primitives in web

Review judgment:

- the web side is relatively healthy
- most of the confusion users feel here is inherited from the service/product split

### 8. Desktop Client Review

Relevant code:

- unified store and sync engine: [`../desktop/src/app-notifications.ts`](../desktop/src/app-notifications.ts)
- thin facades: [`../desktop/src/app-notification-config.ts`](../desktop/src/app-notification-config.ts),
  [`../desktop/src/app-notification-read-state.ts`](../desktop/src/app-notification-read-state.ts),
  [`../desktop/src/app-notification-inbox.ts`](../desktop/src/app-notification-inbox.ts)

What is strong:

- the desktop app now has one local-first store instead of three separate notification protocols
- sync logic is understandable once `app-notifications.ts` is recognized as the center of gravity
- queued local actions map directly onto the shared mutation model

What still looks transitional:

- the wrapper filenames suggest larger subsystem boundaries than still exist
- `NotificationIngestStatus` in [`../desktop/src/app-notifications.ts`](../desktop/src/app-notifications.ts), lines
  59-65 and 188-201 still exposes `cursorEventId: null`, which looks like compatibility shape from the older ingest
  model
- config mutation helpers duplicate some of the queue/update flow instead of going through one common path

Recommended restructure:

- treat `app-notifications.ts` as the canonical desktop notification module
- collapse or rename the thin wrapper files when compatibility constraints allow
- trim leftover "ingest" vocabulary now that the desktop side syncs a full snapshot rather than ingesting a separate
  inbox stream

Review judgment:

- desktop is much easier to understand than older docs implied
- most remaining confusion is naming and compatibility scaffolding

## Suspect, Transitional, or Likely Dead Code

### `inbox_registration` looks unwired

Code:

- table and prepared statements: [`./app/db.ts`](./app/db.ts), lines 311-315 and 475-485
- exported helpers: [`./app/db.ts`](./app/db.ts), lines 894-905
- old route action: [`./app/routes/hm.api.notification-inbox.tsx`](./app/routes/hm.api.notification-inbox.tsx), lines
  57-59

I did not find live first-party call sites for:

- `registerInboxAccount(...)`
- `getInboxRegisteredAccounts(...)`
- `isInboxRegistered(...)`

This looks like dead or abandoned transitional design.

### Old per-feature signed routes look compatibility-only

Code:

- [`./app/routes/hm.api.notification-config.tsx`](./app/routes/hm.api.notification-config.tsx)
- [`./app/routes/hm.api.notification-read-state.tsx`](./app/routes/hm.api.notification-read-state.tsx)
- [`./app/routes/hm.api.notification-inbox.tsx`](./app/routes/hm.api.notification-inbox.tsx)

The first-party clients now use the unified signed route:

- [`./app/routes/hm.api.notifications.tsx`](./app/routes/hm.api.notifications.tsx)

These older routes may still be useful for compatibility, but they no longer describe the main architecture.

### `site-doc-update` and `user-comment` are richer in schema than in live production

Code:

- routing: [`./app/notification-routing.ts`](./app/notification-routing.ts)
- inbox payload conversion: [`./app/notification-persistence.ts`](./app/notification-persistence.ts)
- shared titles/routes:
  [`../../packages/shared/src/models/notification-helpers.ts`](../../packages/shared/src/models/notification-helpers.ts)

Current state:

- `site-doc-update` has routing and payload support, but producer wiring is incomplete
- `user-comment` appears to be schema/fallback support rather than an actively generated path

### `createDesktopNotificationsEmail(...)` appears unused

Code:

- export: [`../emails/notifier.tsx`](../emails/notifier.tsx), lines 840-920

I did not find a production call site in this repo.

## Suggested Cleanup Order

1. Fix cursor correctness before changing product shape.
   - stop advancing cursors after failed or partial processing
   - separate durable persistence from email delivery
2. Decide the canonical subscription model.
   - either unify signed and public flows internally, or isolate them more explicitly
3. Stabilize inbox semantics.
   - define which reasons belong in inbox
   - fix timestamp-tie pagination
4. Delete or quarantine transitional code.
   - inbox registration
   - old per-feature signed routes if no compatibility users remain
   - unused email builders
5. Only then expand features like `notifyOwnedDocChange`.

If the goal is "easier to understand" first, the biggest win is not a UI rewrite or a client rewrite. It is shrinking
[`./app/email-notifier.ts`](./app/email-notifier.ts) into a pipeline with explicit durable boundaries.
