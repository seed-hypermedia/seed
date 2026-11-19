---
name: The notify service
summary: The notify service is the Seed program that watches a daemon's activity feed, keeps each account's notification inbox and read state, sends email, and answers signed requests from the Seed apps.
---
The notify service tells people what happened on the network while they were not looking. For example, when someone replies to your [comment](../protocol/comments.md), notify adds a row to your inbox and sends you an email. The [web app](./web.md), the [desktop app](./desktop.md), the [vault](./vault.md) and the [mobile app](./mobile.md) all read their notification inbox from it. <!-- id:Tf42QftB -->

The service does four jobs:

- It follows the activity feed of a [daemon](./daemon.md).
- It turns new comments and [mentions](../protocol/links-and-citations.md) into notifications.
- It keeps an inbox and a read state for each [account](../protocol/identity.md).
- It sends email for mentions, replies and discussions.

Notify always lives on a [site](../protocol/sites.md)'s own origin, at `/hm/api/notify`. The hosted service is `https://hyper.media/hm/api/notify`, and the development one is `https://dev.hyper.media/hm/api/notify`. A self-hosted site serves it at `https://<site>/hm/api/notify`. The reverse proxy in front of the site sends that prefix to the service.

Notifications come from one place. The desktop app does not find its own notifications over peer-to-peer [sync](../protocol/network.md). The notify server is the only source, and read state syncs only when a client is online. <!-- id:qMcMuREL -->

This page is the map of the program. [The notify API](../build/notify-api.md) is the reference for its HTTP routes, for how a client finds the service, and for the read-state rules.

# Where the code is <!-- id:xPFu1LSJ -->

The code is in `frontend/apps/notify`, package `@shm/notify`. It is a [Bun](https://bun.sh) service with no user interface, built on `Bun.serve`, `bun:sqlite`, `nodemailer` and Sentry (`@sentry/bun`). It serves no HTML. The email settings page is part of the [web app](./web.md). The email templates are a separate package, `frontend/apps/emails` (`@shm/emails`, written in MJML). That package also builds every link an email carries (`notify-links.ts`). <!-- id:7_lMnDIv -->

<!-- id:l-lMhbHm -->
| Path <!-- col:qR4XvOrH --> | What it holds <!-- col:ifoNug0S --> <!-- id:tDmG-Goh --> |
| --- | --- |
| `app/main.ts` | Boot: opens the database, starts `Bun.serve` and the notifier loops. Bun loads `.env` from the working directory. <!-- id:JPaRGewy --> |
| `app/routes.ts` | The route table: canonical paths, legacy aliases, CORS preflight. <!-- id:g3EixSrS --> |
| `app/db.ts` | The SQLite schema, migrations and statements. <!-- id:n6NOF2qZ --> |
| `app/email-notifier.ts` | The loops that read the activity feed, classify events, write inbox rows and send email. <!-- id:oM6DMnjS --> |
| `app/notification-state.ts` | The unified state API: snapshot and actions. <!-- id:Ai6QJTgG --> |
| `app/validate-signature.ts`, `app/verify-delegation.ts` | The check of request signatures and of the `AGENT` [capability](../protocol/permissions.md) of a signing key. <!-- id:OLo0GDuF --> |
| `app/mailer.ts` | The email sender: the hosting email relay when configured, SMTP otherwise. <!-- id:RJaXjCfh --> |
| `app/routes/` | One module per endpoint, exporting `GET`/`POST` handlers on standard `Request`/`Response`. <!-- id:-V5OkVr9 --> |
| `frontend/packages/shared/src/models/notification-*.ts` | The code every client shares: the client transport, the payload shape, the read-state logic and the comment classifier. <!-- id:uCp0ziWT --> |

[`frontend/apps/notify/README.md`](https://github.com/seed-hypermedia/seed/blob/main/frontend/apps/notify/README.md) is the file-by-file map of the service and its clients. This page describes how the pieces work together. <!-- id:nTz1Cc8z -->

# How it talks to the daemon <!-- id:wp9QUfoF -->

The service holds one gRPC-web client to `DAEMON_HTTP_URL`, the [daemon](./daemon.md)'s HTTP port. It uses the daemon for three things: <!-- id:X4-kG_33 -->

- It reads `ActivityFeed.ListEvents`, page by page, for new events.
- It loads comments, [documents](../protocol/documents.md) and accounts through the same typed API handlers the [web app](./web.md) uses.
- It asks `AccessControl.ListCapabilitiesForDelegate` whether a signing key holds an `AGENT` capability for the account it claims.

The hosted service reads from the daemon of the hyper.media [gateway](../protocol/sites.md), so it sees what that node has synced.

# The notifier <!-- id:CR7nLeFw -->

When it starts, the service processes new events once. Then it runs two loops. <!-- id:UlekGsdQ -->

<!-- id:xHB15mhK -->
| Loop <!-- col:Xo-mIK5a --> | Every <!-- col:ThggTHbj --> | Produces <!-- col:hf-Ru_p9 --> <!-- id:42OYZc66 --> |
| --- | --- | --- |
| Immediate | 15 seconds | `mention`, `reply` and `discussion` notifications: an inbox row for the account, then an email if the account has a verified address. <!-- id:_h-HlR2g --> |
| Batch | 30 seconds, sending at most every 4 hours (6 minutes in development) | `site-new-discussion` digest emails for people who used the older site subscription form. <!-- id:0pvjEkMS --> |

Each loop keeps a cursor in the `notifier_status` table, so it knows where it stopped. An event id comes from the [blob](../protocol/blobs.md): `blob-<cid>` or `mention-<cid>-<type>-<target>`. The same id is the key of the inbox row and the key of the read state. One pass of a loop reads at most 100 pages. <!-- id:qVUSeN-v -->

Three things send no notification: <!-- id:f42bC6WP -->

- **A document change.** Nobody gets email when a document changes. `site-doc-update` is in the payload schema and the `notifyOwnedDocChange` flag is in the settings, but the notifier does not deliver document updates.
- **A digest in the inbox.** The batch loop only sends email. It does not write digest notifications to the inbox.
- **A new capability.** The notifier does not look at `Capability` blobs. So when you give someone a writer capability, they get nothing.

The immediate loop moves its cursor forward in a `finally` clause. So a pass that fails part way still marks its events as processed. A short daemon or SMTP failure can then lose the notifications of that pass. The loop writes inbox rows before it tries email, so an email failure alone loses only the email. <!-- id:bO5micRm -->

# Storage <!-- id:5tYConwM -->

The service keeps one SQLite file, `web-db.sqlite`, in `DATA_DIR` or in the working directory. These are the tables that matter: <!-- id:zD8DMQE2 -->

<!-- id:5R9Zjvww -->
| Table <!-- col:CdmNCVME --> | Holds <!-- col:o9_Q5NBD --> <!-- id:-qkYr2JH --> |
| --- | --- |
| `notification_inbox` | The saved notification payloads of each account. <!-- id:9Ai-A1XQ --> |
| `notification_read_state`, `notification_read_events` | A "read everything before this time" watermark per account, plus explicit reads above it. <!-- id:oy7MELj0 --> |
| `notification_config`, `notification_email_verifications` | An account's notification email and its verification. <!-- id:N5y98IXC --> |
| `inbox_registration` | Accounts registered for an inbox, used by the notifier and the [vault](./vault.md). <!-- id:bQTVOEvY --> |
| `emails`, `email_subscriptions` | The older public site subscriptions and the one-click unsubscribe tokens. <!-- id:lYhPlq88 --> |
| `notifier_status` | Loop cursors and the last batch send time. <!-- id:CRVAQhLn --> |

The watermark is one time per account: everything before it is read. So "mark all as read" changes one row, and you can still mark a single item as unread again. [The notify API](../build/notify-api.md) gives the read-state rules. <!-- id:Ly-Oh-wd -->

# Configuration <!-- id:N5H-mCDa -->

<!-- id:FHnFndgr -->
| Variable <!-- col:r_cplJdn --> | Meaning <!-- col:fdcCv3x3 --> <!-- id:bmgVnQDx --> |
| --- | --- |
| `DAEMON_HTTP_URL`, `DAEMON_HTTP_PORT` | The [daemon](./daemon.md) to read. <!-- id:fD_7AHy_ --> |
| `PORT` | The port to listen on: 3000 by default and in the Docker image, 3060 for `pnpm notify`. <!-- id:qqEcGHll --> |
| `DATA_DIR` | Where `web-db.sqlite` lives. <!-- id:21ohCkj5 --> |
| `SEED_BASE_URL` | The gateway site used for document links when a document's own site is unknown. It is also the origin of email links when `NOTIFY_SERVICE_HOST` is unset. <!-- id:dUCuD8GL --> |
| `NOTIFY_SERVICE_HOST` | This service's own public base URL, normally `https://<site>/hm/api/notify`. A value with only the origin also works. Email links use its origin. <!-- id:liIarWt- --> |
| `NOTIFY_SMTP_HOST`, `NOTIFY_SMTP_PORT`, `NOTIFY_SMTP_USER`, `NOTIFY_SMTP_PASSWORD`, `NOTIFY_SENDER` | Outgoing mail over SMTP. The default is STARTTLS on port 587. Port 465 switches to implicit TLS, which is unreliable under Bun. Without a host, user and password, and without a relay, the service logs each email and does not send it. <!-- id:9NBHNLks --> |
| `NOTIFY_EMAIL_RELAY_URL`, `NOTIFY_EMAIL_RELAY_TOKEN` | The Seed hosting email relay. Each email is one `POST <url>` with `Authorization: Bearer <token>` and a JSON body `{to, subject, text, html?, replyTo?}`. Any 2xx answer means the relay took it. Anything else fails the send. The relay sets the sender. When both variables are set, they win over the SMTP variables, so an [enterprise node](../operate/enterprise-node.md) needs no SMTP account. <!-- id:kPQbruXE --> |
| `NOTIFY_TRUSTED_PREVALIDATORS` | The [vault](./vault.md) origins that this service trusts when they say an email address is already verified. <!-- id:IYib82x9 --> |
| `NOTIFY_SENTRY_DSN` | Error reporting. <!-- id:uhMVrRkx --> |

# Running it <!-- id:4HKQ7oti -->

```sh <!-- id:M5F1o83E -->
pnpm notify              # bun --watch on :3060, against the desktop dev daemon on 58001
pnpm notify:standalone   # its own daemon on 54000-54002 and notify on :3061
pnpm notify:build        # bun build: one self-contained bundle, build/main.js
pnpm --filter @shm/notify test   # vitest for the mocked suites, then bun test for *.bun.test.ts (bun:sqlite)
```

`./dev up` starts it as the `notify` pane and points the [vault](./vault.md) pane at it. The images are `seedhypermedia/notify:dev`, built from `main`, and `seedhypermedia/notify:latest`, built for releases. An image is `oven/bun` running the built bundle as uid 1001 on port 3000, with data in `/data` (set `DATA_DIR=/data`). <!-- id:wMID-eRV -->

# Working with it <!-- id:Hsac-gBO -->

## In the Seed app <!-- id:K-vWsB87 -->

The [desktop app](./desktop.md) keeps a local notification store and syncs it with the `notifications` route. The store shows your change at once, before the server confirms it. The app signs each request through the [daemon](./daemon.md)'s `SignData` call. <!-- id:Mip7OfDa -->

The store is in the main process, in [`frontend/apps/desktop/src/app-notifications.ts`](https://github.com/seed-hypermedia/seed/blob/main/frontend/apps/desktop/src/app-notifications.ts). The app saves it in Electron app storage under the key `NotificationsState-v001`. For every key in the daemon's keystore, the store holds three things: <!-- id:a8ZMcQxk -->

- The last snapshot: the inbox, the read state and the email config.
- A queue of actions the server has not confirmed.
- The time and the error of the last sync.

A change in the interface goes through these steps:

1. The app applies the change to the local snapshot and adds it to the queue.
2. A sync fetches the server's snapshot and applies the queue on top of it.
3. If the queue is not empty, the sync sends `apply-notification-actions`.
4. The app drops the actions that the server applied.

The sync runs every 30 seconds while a window has focus, every 5 minutes when none has, and when the app asks for it. The renderer reads the local store over tRPC and never calls the notify service itself. So the desktop app can show state that the server has not confirmed, and old state while the service cannot be reached. The files `app-notification-config.ts`, `app-notification-inbox.ts` and `app-notification-read-state.ts` beside it are thin tRPC wrappers over the one store.

## Seed API <!-- id:Pn8BiNdQ -->

[The notify API](../build/notify-api.md) has the routes, the way requests are signed, and the way a site tells clients where its notify service is.

The [web app](./web.md)'s `/hm/notifications` page is the browser client, in [`frontend/apps/web/app/web-notifications.ts`](https://github.com/seed-hypermedia/seed/blob/main/frontend/apps/web/app/web-notifications.ts). It works like this: <!-- id:AEsHsMYQ -->

- It reads the notify URL stored beside the [session key](../build/sign-in.md) in IndexedDB.
- The browser signs the CBOR request with WebCrypto. It adds `accountUid`, because the session key signs for the account and is not the account's own key.
- It fetches the snapshot into React Query. It applies each action to the cached snapshot before it sends the action, and fetches again after the server answers.

The browser never classifies feed events. It only shows the `NotificationPayload` rows that the service saved.

The web app has a second, older way to turn on email. It is the unsigned subscribe form in `email-notifications.tsx`, which the app also offers after you comment. The form posts JSON to `/hm/api/public-subscribe` and creates a site subscription for the address. It is separate from the signed inbox. It has its own settings page, `/hm/email-notifications`, which the web app serves. A token in the link opens that page, and the page calls `email-notif-token`. <!-- id:1fIXHbj_ -->

## SDK <!-- id:yJl1ieUn -->

The [SDK](../build/sdk.md) has no notify client. The client code is in `@shm/shared` (`models/notification-service.ts`). You can write your own with the SDK's CBOR and signing helpers. <!-- id:eEWyZqRh -->

## Agents <!-- id:aLUTu-Ae -->

[Seed Agents](../agent.md) do not use the notify service. The [app environment](./app-environment.md) watches the activity feed itself. See [triggers](../trigger.md). <!-- id:UEEYnLed -->

# See also <!-- id:kO84rx1N -->

- [The vault](./vault.md), [The web app](./web.md), [The desktop app](./desktop.md) <!-- id:SLRSsEZi -->
- [The notify API](../build/notify-api.md), for the routes, URL resolution and read-state rules.
- [Comments](../protocol/comments.md), [Capability](../capability.md), [Sign in with Seed](../build/sign-in.md), [The daemon](./daemon.md) <!-- id:ktShPXtg -->
