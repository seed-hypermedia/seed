---
name: The notify service
summary: The Seed service that watches a daemon's activity feed, keeps each account's notification inbox and read state, sends email, and answers signed requests from the web app, the desktop app, the vault and the mobile app.
---
The notify service is how people hear about what happens on the network when they are not looking. It follows a [daemon](./daemon.md)'s activity feed, turns new [comments](../protocol/comments.md) and [mentions](../protocol/links-and-citations.md) into notifications, keeps an inbox and read state for each [account](../protocol/identity.md), and sends email for mentions, replies and discussions. The [web app](./web.md), the [desktop app](./desktop.md), the [vault](./vault.md) and the [mobile app](./mobile.md) all read their notification inbox from it. Notify always lives on a [site](../protocol/sites.md)'s own origin, at `/hm/api/notify`: the hosted instance is `https://hyper.media/hm/api/notify` (development: `https://dev.hyper.media/hm/api/notify`), and a self-hosted site serves it at `https://<site>/hm/api/notify`. The reverse proxy in front of the site routes that prefix to the service. <!-- id:Tf42QftB -->

Notifications are centralized. The desktop app does not discover its own notifications over peer-to-peer [sync](../protocol/network.md). The notify server is the one source, and read state syncs only when a client is online. <!-- id:qMcMuREL -->

This page is the map of the program. [The notify API](../build/notify-api.md) is the reference for its HTTP routes, how a client finds the service, and the read-state rules.

# Where the code is <!-- id:xPFu1LSJ -->

`frontend/apps/notify`, package `@shm/notify`: a headless [Bun](https://bun.sh) service with `Bun.serve`, `bun:sqlite`, `nodemailer` and Sentry (`@sentry/bun`). It serves no HTML; the email settings page is part of the [web app](./web.md). The email templates are a separate package, `frontend/apps/emails` (`@shm/emails`, MJML), which also builds every link an email carries (`notify-links.ts`). <!-- id:7_lMnDIv -->

<!-- id:l-lMhbHm -->
| Path <!-- col:qR4XvOrH --> | What it holds <!-- col:ifoNug0S --> <!-- id:tDmG-Goh --> |
| --- | --- |
| `app/main.ts` | Boot: opens the database, starts `Bun.serve` and the notifier loops. Bun loads `.env` from the working directory. <!-- id:JPaRGewy --> |
| `app/routes.ts` | The route table: canonical paths, legacy aliases, CORS preflight. <!-- id:g3EixSrS --> |
| `app/db.ts` | The SQLite schema, migrations and statements. <!-- id:n6NOF2qZ --> |
| `app/email-notifier.ts` | The loops that read the activity feed, classify events, write inbox rows and send email. <!-- id:oM6DMnjS --> |
| `app/notification-state.ts` | The unified state API: snapshot and actions. <!-- id:Ai6QJTgG --> |
| `app/validate-signature.ts`, `app/verify-delegation.ts` | Request signatures and agent-capability checks. <!-- id:OLo0GDuF --> |
| `app/mailer.ts` | The email sender: the hosting email relay when configured, SMTP otherwise. <!-- id:RJaXjCfh --> |
| `app/routes/` | One module per endpoint, exporting `GET`/`POST` handlers on standard `Request`/`Response`. <!-- id:-V5OkVr9 --> |
| `frontend/packages/shared/src/models/notification-*.ts` | The client transport, payload shape, read-state logic and [comment](../protocol/comments.md) classifier shared with every client. <!-- id:uCp0ziWT --> |

[`frontend/apps/notify/README.md`](https://github.com/seed-hypermedia/seed/blob/main/frontend/apps/notify/README.md) is the file-by-file map of the service and its clients. This page is the description of how the pieces work together. <!-- id:nTz1Cc8z -->

# How it talks to the daemon <!-- id:wp9QUfoF -->

The service holds one gRPC-web client to `DAEMON_HTTP_URL`, the [daemon](./daemon.md)'s HTTP port. It pages through `ActivityFeed.ListEvents` for new events, loads [comments](../protocol/comments.md), [documents](../protocol/documents.md) and [accounts](../protocol/identity.md) through the same typed API handlers the [web app](./web.md) uses, and asks `AccessControl.ListCapabilitiesForDelegate` whether a signing key holds an `AGENT` [capability](../protocol/permissions.md) for the account it claims. The hosted service reads from the hyper.media [gateway](../protocol/sites.md) daemon, so it sees what that node has synced. <!-- id:X4-kG_33 -->

# The notifier <!-- id:CR7nLeFw -->

At startup the service processes once, then runs two loops. <!-- id:UlekGsdQ -->

<!-- id:xHB15mhK -->
| Loop <!-- col:Xo-mIK5a --> | Every <!-- col:ThggTHbj --> | Produces <!-- col:hf-Ru_p9 --> <!-- id:42OYZc66 --> |
| --- | --- | --- |
| Immediate | 15 seconds | `mention`, `reply` and `discussion` notifications: an inbox row for the [account](../protocol/identity.md), then an email if the account has a verified address. <!-- id:_h-HlR2g --> |
| Batch | 30 seconds, sending at most every 4 hours (6 minutes in development) | `site-new-discussion` digest emails for legacy [site](../protocol/sites.md) subscribers. <!-- id:0pvjEkMS --> |

Each loop keeps a cursor in the `notifier_status` table. Event ids are derived from the [blob](../protocol/blobs.md), `blob-<cid>` or `mention-<cid>-<type>-<target>`, and the same id is the inbox row's key and the read-state key. A page loop is capped at 100 pages per pass. <!-- id:qVUSeN-v -->

Nobody gets email when a document changes. `site-doc-update` exists in the payload schema and the `notifyOwnedDocChange` flag exists in the settings, but the notifier does not deliver document updates. Batch-only notifications are not clearly written to the inbox. The notifier does not look at `Capability` blobs either, so granting someone a writer capability sends them nothing. <!-- id:f42bC6WP -->

The immediate loop advances its cursor in a `finally` block, so a pass that throws part way still marks its events processed. A transient daemon or SMTP failure can therefore drop the notifications in that batch. Inbox rows are written before email is attempted, so an email failure alone loses only the email. <!-- id:bO5micRm -->

# Storage <!-- id:5tYConwM -->

One SQLite file, `web-db.sqlite`, in `DATA_DIR` or the working directory. The tables that matter: <!-- id:zD8DMQE2 -->

<!-- id:5R9Zjvww -->
| Table <!-- col:CdmNCVME --> | Holds <!-- col:o9_Q5NBD --> <!-- id:-qkYr2JH --> |
| --- | --- |
| `notification_inbox` | Persisted notification payloads per [account](../protocol/identity.md). <!-- id:9Ai-A1XQ --> |
| `notification_read_state`, `notification_read_events` | A "read everything before this time" watermark per account, plus explicit reads above it. <!-- id:oy7MELj0 --> |
| `notification_config`, `notification_email_verifications` | An account's notification email and its verification. <!-- id:N5y98IXC --> |
| `inbox_registration` | Accounts registered for an inbox, used by the notifier and the [vault](./vault.md). <!-- id:bQTVOEvY --> |
| `emails`, `email_subscriptions` | Legacy public [site](../protocol/sites.md) subscriptions and one-click unsubscribe tokens. <!-- id:lYhPlq88 --> |
| `notifier_status` | Loop cursors and the last batch send time. <!-- id:CRVAQhLn --> |

The watermark design keeps "mark all as read" to one row and makes unread toggling reversible. [The notify API](../build/notify-api.md) gives the read-state rules. <!-- id:Ly-Oh-wd -->

# Configuration <!-- id:N5H-mCDa -->

<!-- id:FHnFndgr -->
| Variable <!-- col:r_cplJdn --> | Meaning <!-- col:fdcCv3x3 --> <!-- id:bmgVnQDx --> |
| --- | --- |
| `DAEMON_HTTP_URL`, `DAEMON_HTTP_PORT` | The [daemon](./daemon.md) to read. <!-- id:fD_7AHy_ --> |
| `PORT` | Listen port; 3000 by default and in the Docker image, 3560 in the hosted deployment, 3060 for `pnpm notify`. <!-- id:qqEcGHll --> |
| `DATA_DIR` | Where `web-db.sqlite` lives. <!-- id:21ohCkj5 --> |
| `SEED_BASE_URL` | The gateway [site](../protocol/sites.md) used for document links when a document's own site is unknown, and the email-link origin when `NOTIFY_SERVICE_HOST` is unset. <!-- id:dUCuD8GL --> |
| `NOTIFY_SERVICE_HOST` | This service's own public base URL, canonically `https://<site>/hm/api/notify` (an origin-only value is accepted). Email links use its origin. <!-- id:liIarWt- --> |
| `NOTIFY_SMTP_HOST`, `NOTIFY_SMTP_PORT`, `NOTIFY_SMTP_USER`, `NOTIFY_SMTP_PASSWORD`, `NOTIFY_SENDER` | Outgoing mail over SMTP, STARTTLS on port 587 by default (465 switches to implicit TLS, which is unreliable under Bun). Without host, user and password (and no relay), emails are logged and dropped. <!-- id:9NBHNLks --> |
| `NOTIFY_EMAIL_RELAY_URL`, `NOTIFY_EMAIL_RELAY_TOKEN` | The Seed hosting email relay: each email is one `POST <url>` with `Authorization: Bearer <token>` and a JSON body `{to, subject, text, html?}`; the relay sets the sender. Set together, they win over the SMTP variables, so an [enterprise](../operate/enterprise-node.md) instance needs no SMTP account. A reply other than 2xx fails the send like an SMTP rejection. <!-- id:kPQbruXE --> |
| `NOTIFY_TRUSTED_PREVALIDATORS` | [Vault](./vault.md) origins whose email prevalidation is trusted. <!-- id:IYib82x9 --> |
| `NOTIFY_SENTRY_DSN` | Error reporting. <!-- id:uhMVrRkx --> |

# Running it <!-- id:4HKQ7oti -->

```sh <!-- id:M5F1o83E -->
pnpm notify              # bun --watch on :3060, against the desktop dev daemon on 58001
pnpm notify:standalone   # its own daemon on 54000-54002 and notify on :3061
pnpm notify:build        # bun build: one self-contained bundle, build/main.js
pnpm --filter @shm/notify test   # vitest for the mocked suites, then bun test for *.bun.test.ts (bun:sqlite)
```

`./dev up` starts it as the `notify` pane and points the [vault](./vault.md) pane at it. Images are `seedhypermedia/notify:dev` from `main` and `seedhypermedia/notify:latest` for releases: `oven/bun` running the prebuilt bundle as uid 1001, port 3000, data in `/data` (set `DATA_DIR=/data`). The hosted services are `https://hyper.media/hm/api/notify` and `https://dev.hyper.media/hm/api/notify`. <!-- id:wMID-eRV -->

# Working with it <!-- id:Hsac-gBO -->

## In the Seed app <!-- id:K-vWsB87 -->

The [desktop app](./desktop.md) keeps a local optimistic notification store and syncs it with the `notifications` route, signing each request through the [daemon](./daemon.md)'s `SignData` RPC. <!-- id:Mip7OfDa -->

The store lives in the main process, in [`frontend/apps/desktop/src/app-notifications.ts`](https://github.com/seed-hypermedia/seed/blob/main/frontend/apps/desktop/src/app-notifications.ts), persisted in Electron app storage under the key `NotificationsState-v001`. For every key in the daemon's keystore it holds the last snapshot (inbox, read state, email config), a queue of actions not yet acknowledged, and the time and error of the last sync. A change in the interface is reduced into the local snapshot first, queued, and then synced. A sync fetches the server's snapshot, replays the queue on top, sends `apply-notification-actions` if the queue is not empty, and drops the actions the server applied. The loop runs every 30 seconds while a window is focused and every 5 minutes otherwise, and on demand. The renderer reads the local store over tRPC and never calls the notify service itself. So the desktop app can show state the server has not confirmed yet, and stale state while the service is unreachable. The files `app-notification-config.ts`, `app-notification-inbox.ts` and `app-notification-read-state.ts` next to it are thin tRPC facades over the one store. <!-- id:a8ZMcQxk -->

## Web API <!-- id:Pn8BiNdQ -->

The routes, the signing scheme and the way a [site](../protocol/sites.md) advertises its notify service are in [The notify API](../build/notify-api.md).

The [web app](./web.md)'s `/hm/notifications` page is the browser client, in [`frontend/apps/web/app/web-notifications.ts`](https://github.com/seed-hypermedia/seed/blob/main/frontend/apps/web/app/web-notifications.ts). It reads the notify URL stored next to the session key in IndexedDB. The browser signs the CBOR request with WebCrypto, adds `accountUid` because the session key is a delegate, fetches the snapshot into React Query, reduces each action into the cached snapshot before sending it, and refetches after the server answers. The browser never classifies feed events. It only renders the `NotificationPayload` rows the service persisted. <!-- id:AEsHsMYQ -->

The web app has a second, older way to turn on email: the unsigned subscribe form in `email-notifications.tsx`, also offered after commenting, which posts JSON to `/hm/api/public-subscribe` and creates a legacy [site](../protocol/sites.md) subscription for the address. It is a separate product path from the signed inbox, with its own token-based settings page (`/hm/email-notifications`, served by the web app, which calls `email-notif-token`). <!-- id:1fIXHbj_ -->

## SDK <!-- id:yJl1ieUn -->

The [SDK](../build/sdk.md) has no notify client. The transport lives in `@shm/shared` (`models/notification-service.ts`). A third party can reproduce it with the SDK's CBOR and signing helpers. <!-- id:eEWyZqRh -->

## Agents <!-- id:aLUTu-Ae -->

[Seed Agents](../agent.md) do not use the notify service. They watch the network themselves through the activity feed. See [triggers](../agent/triggers.md). <!-- id:UEEYnLed -->

# See also <!-- id:kO84rx1N -->

- [The vault](./vault.md), [The web app](./web.md), [The desktop app](./desktop.md) <!-- id:SLRSsEZi -->
- [The notify API](../build/notify-api.md), for the routes, URL resolution and read-state rules.
- [Comments](../protocol/comments.md), [Capability](../capability.md), [Sign in with Seed](../build/sign-in.md), [The daemon](./daemon.md) <!-- id:ktShPXtg -->
