---
name: The notify service
summary: The Seed service that watches a daemon's activity feed, keeps each account's notification inbox and read state, sends email, and answers signed requests from the web app, the desktop app, the vault and the mobile app.
---
The notify service is how people hear about what happens on the network when they are not looking. It follows a [daemon](./daemon.md)'s activity feed, turns new [comments](../protocol/comments.md) and [mentions](../protocol/comments.md) into notifications, keeps an inbox and read state for each [account](../protocol/identity.md), and sends email for mentions, replies and discussions. The [web app](./web.md), the [desktop app](./desktop.md), the [vault](./vault.md) and the [mobile app](./mobile.md) all read their notification inbox from it. The hosted instance is `https://notify.seed.hyper.media`. <!-- id:Tf42QftB -->

Notifications are centralized on purpose, for now. The desktop app no longer discovers its own notifications over peer-to-peer [sync](../protocol/network.md). The notify server is the one source, and read state syncs only when a client is online. The team treats this as temporary. The plan is private peer-to-peer sync of subscriptions and read state. <!-- id:qMcMuREL -->

# Where the code is <!-- id:xPFu1LSJ -->

`frontend/apps/notify`, package `@shm/notify`: Remix 2.17 on Node with Vite, `better-sqlite3`, `nodemailer`, Sentry. The email templates are a separate package, `frontend/apps/emails` (`@shm/emails`, react-email and MJML). <!-- id:7_lMnDIv -->

<!-- id:l-lMhbHm -->
| Path <!-- col:qR4XvOrH --> | What it holds <!-- col:ifoNug0S --> <!-- id:tDmG-Goh --> |
| --- | --- |
| `app/entry.server.tsx` | Boot: loads `.env`, opens the database, starts the notifier loops. <!-- id:JPaRGewy --> |
| `app/db.ts` | The SQLite schema, migrations and statements. <!-- id:n6NOF2qZ --> |
| `app/email-notifier.ts` | The loops that read the activity feed, classify events, write inbox rows and send email. <!-- id:oM6DMnjS --> |
| `app/notification-state.ts` | The unified state API: snapshot and actions. <!-- id:Ai6QJTgG --> |
| `app/validate-signature.ts`, `app/verify-delegation.ts` | Request signatures and agent-capability checks. <!-- id:OLo0GDuF --> |
| `app/mailer.ts` | The SMTP sender. <!-- id:RJaXjCfh --> |
| `app/routes/` | Every HTTP route, listed below. <!-- id:-V5OkVr9 --> |
| `frontend/packages/shared/src/models/notification-*.ts` | The client transport, payload shape, read-state logic and [comment](../protocol/comments.md) classifier shared with every client. <!-- id:uCp0ziWT --> |

Read `frontend/apps/notify/README.md` first, then `app/NOTIFICATIONS_SERVICE_ARCHITECTURE.md` for the service. The client halves are in `frontend/apps/web/app/NOTIFICATIONS_WEB_ARCHITECTURE.md` and `frontend/apps/desktop/src/NOTIFICATIONS_DESKTOP_ARCHITECTURE.md`. `NOTIFICATIONS_REVIEW.md` is a restructuring memo, `docs/notifications/local-first-read-state-edge-cases.md` covers offline read state, and `email-notification-signing-notes.md` at the repository root is historical: it describes an earlier per-feature API that no longer matches the code. <!-- id:nTz1Cc8z -->

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

Some pieces exist only in name. `site-doc-update` exists in the payload schema and the `notifyOwnedDocChange` flag exists in the settings, but the notifier has a TODO where document-update delivery should be, so nobody gets document-change email today. Batch-only notifications are not clearly written to the inbox. <!-- id:f42bC6WP -->

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

The watermark design keeps "mark all as read" to one row and makes unread toggling reversible. <!-- id:Ly-Oh-wd -->

# The HTTP API <!-- id:pJLQwr0D -->

All routes live under `/hm/api` and `/hm` on the notify host. The signed routes take a POST body of [DAG-CBOR](https://ipld.io/specs/codecs/dag-cbor/spec/): the client builds `{action, signer, time, accountUid?}`, signs the CBOR encoding, and sends it with `sig`. The service re-encodes the unsigned payload to verify the [signature](../signature.md). If `accountUid` differs from the signer, the signer must hold an `AGENT` [capability](../protocol/permissions.md) for that [account](../protocol/identity.md), which is how a browser [session key](../build/sign-in.md) acts for the account held in the [vault](./vault.md). The service accepts Ed25519 and compressed P-256 signers. <!-- id:On90zZsQ -->

<!-- id:9K1PbjAc -->
| Route <!-- col:lE0SQ0Xs --> | Kind <!-- col:mTERIR0z --> | Used by <!-- col:TKZRhITy --> <!-- id:vUKhNiUm --> |
| --- | --- | --- |
| `/hm/api/notifications` | signed: `get-notification-state`, `apply-notification-actions` | web, desktop, mobile; returns inbox, email config and read state in one snapshot <!-- id:K35l0hct --> |
| `/hm/api/notification-inbox`, `/hm/api/notification-config` | signed | the vault: inbox registration, email config, trusted email prevalidation <!-- id:4-30R4gv --> |
| `/hm/api/notification-read-state` | signed | compatibility only; no first-party client calls it <!-- id:TuX0LW4r --> |
| `/hm/api/public-subscribe/*` | unsigned | legacy [site](../protocol/sites.md) email subscriptions <!-- id:MncOIYda --> |
| `/hm/api/email-notif-token`, `/hm/email-notifications?token=` | token | the settings page linked from emails <!-- id:eU5Wuokf --> |
| `/hm/api/unsubscribe` | token | one-click unsubscribe, RFC 8058 <!-- id:xuF-MMYl --> |
| `/hm/notification-email-verify` | link | email verification <!-- id:U9FYAb_Z --> |
| `/hm/notification-read-redirect` | link | marks an email's notification read, then redirects to the [comment](../protocol/comments.md) <!-- id:ZI1Ctfrl --> |

**Email prevalidation.** A vault that has already verified a person's email signs `{email, signer, host}` with its [daemon](./daemon.md)'s key. The notify service accepts that instead of sending a verification email only when the host is in `NOTIFY_TRUSTED_PREVALIDATORS`, and only after fetching the host's `/hm/api/config` and checking that `signerAccountUid` matches the signer. <!-- id:FftEpzmA -->

# Configuration <!-- id:N5H-mCDa -->

<!-- id:FHnFndgr -->
| Variable <!-- col:r_cplJdn --> | Meaning <!-- col:fdcCv3x3 --> <!-- id:bmgVnQDx --> |
| --- | --- |
| `DAEMON_HTTP_URL`, `DAEMON_HTTP_PORT` | The [daemon](./daemon.md) to read. <!-- id:fD_7AHy_ --> |
| `PORT` | Listen port; the Docker image uses 3000, the hosted deployment 3560. <!-- id:qqEcGHll --> |
| `DATA_DIR` | Where `web-db.sqlite` lives. <!-- id:21ohCkj5 --> |
| `SEED_BASE_URL` | The public [site](../protocol/sites.md) used to build links in emails. <!-- id:dUCuD8GL --> |
| `NOTIFY_SERVICE_HOST` | This service's own public URL, used in email links. <!-- id:liIarWt- --> |
| `NOTIFY_SMTP_HOST`, `NOTIFY_SMTP_PORT`, `NOTIFY_SMTP_USER`, `NOTIFY_SMTP_PASSWORD`, `NOTIFY_SENDER` | Outgoing mail. Without host, user and password, emails are logged and dropped. <!-- id:9NBHNLks --> |
| `NOTIFY_TRUSTED_PREVALIDATORS` | [Vault](./vault.md) origins whose email prevalidation is trusted. <!-- id:IYib82x9 --> |
| `NOTIFY_SENTRY_DSN` | Error reporting. <!-- id:uhMVrRkx --> |

# Running it <!-- id:4HKQ7oti -->

```sh <!-- id:M5F1o83E -->
pnpm notify              # Remix dev server on :3060, against the desktop dev daemon on 58001
pnpm notify:standalone   # its own daemon on 54000-54002 and notify on :3061
pnpm --filter @shm/notify test
```

`./dev up` starts it as the `notify` pane and points the [vault](./vault.md) pane at it. Images are `seedhypermedia/notify:dev` from `main` and `seedhypermedia/notify:latest` for releases. The hosted services are `notify.seed.hyper.media` and `notify-dev.seed.hyper.media`. <!-- id:wMID-eRV -->

# Working with it <!-- id:Hsac-gBO -->

## In the Seed app <!-- id:K-vWsB87 -->

The [desktop app](./desktop.md) keeps a local optimistic notification store and syncs it with `/hm/api/notifications`, signing each request through the [daemon](./daemon.md)'s `SignData` RPC. The notify host comes from `VITE_NOTIFY_SERVICE_HOST`, `https://notify.seed.hyper.media` in release builds. Account settings can override it, and the override is saved in the synced [vault](./vault.md) state. <!-- id:Mip7OfDa -->

## Web API <!-- id:Pn8BiNdQ -->

A [site](../protocol/sites.md) advertises its notify service as `notifyServiceHost` in `/hm/api/config` (see [The web API](../build/web-api.md)), set from `NOTIFY_SERVICE_HOST` on the [web app](./web.md). The web app's `/hm/notifications` page signs requests in the browser with the [session key](../build/sign-in.md) and stores the notify host it learned at sign-in. The [mobile app](./mobile.md) reads the same field and falls back to the hosted service. <!-- id:qiXEWgy5 -->

## SDK <!-- id:yJl1ieUn -->

The [SDK](../build/sdk.md) has no notify client. The transport lives in `@shm/shared` (`models/notification-service.ts`). A third party can reproduce it with the SDK's CBOR and signing helpers. <!-- id:eEWyZqRh -->

## Agents <!-- id:aLUTu-Ae -->

[Seed Agents](../agent.md) do not use the notify service. They watch the network themselves through the activity feed. See [triggers](../agent/triggers.md). <!-- id:UEEYnLed -->

# Where this is going <!-- id:yyVBTJBG -->

As of September 2026, the team plans three changes. None of them is built. <!-- id:D5odp_vC -->
  - Move subscriptions and read state out of this central server into private peer-to-peer [sync](../protocol/network.md) once [private documents](../protocol/privacy.md) mature. <!-- id:B4Mbt39y -->
  - Restore the link between an email and the [account](../protocol/identity.md) that subscribes. It was dropped in 2025 and later called a mistake. <!-- id:JyQPdkoX -->
  - Replace the legacy [site](../protocol/sites.md) subscriptions with per-site options for document changes, [discussions](../protocol/comments.md), comments and mentions. <!-- id:8985JUGG -->

# See also <!-- id:kO84rx1N -->

- [The vault](./vault.md), [The web app](./web.md), [The desktop app](./desktop.md) <!-- id:SLRSsEZi -->
- [Comments](../protocol/comments.md), [Capability](../capability.md), [Sign in with Seed](../build/sign-in.md), [The daemon](./daemon.md) <!-- id:ktShPXtg -->
