---
name: The notify API
summary: This page is the reference for the HTTP API of the notify service; it covers how a client finds the service, how requests are signed, the routes, the links in emails, and the rules that keep read state the same on every device.
---
The [notify service](../software/notify.md) is the program that keeps a notification inbox for each [account](../protocol/identity.md) and sends email. It also remembers which notifications the person has read. This page shows how a program talks to it: where the service is, how to sign a request, what each route does, and how read state from several devices is merged.

Its clients are the [web app](../software/web.md), the [desktop app](../software/desktop.md), the [vault](../software/vault.md) and the [mobile app](../software/mobile.md). Your own program can be a client too. The [SDK](./sdk.md) has no client for it. The Seed apps use `models/notification-service.ts` in `@shm/shared`.

# Finding the notify service

The notify service runs on the same origin as a [site](../protocol/sites.md), at `https://<site>/hm/api/notify`. The hosted one is `https://hyper.media/hm/api/notify`.

A site tells clients where its notify service is in `/hm/api/config`. The field `notifyServiceUrl` is the full base, such as `https://site.com/hm/api/notify`. The field `notifyServiceHost` is only the origin of that base, for older clients. The [web app](../software/web.md) sets both from `NOTIFY_SERVICE_HOST`. The web app's `/hm/notifications` page signs requests in the browser with the [session key](./sign-in.md) and stores the notify host it learned at sign-in. The mobile app reads the same field and uses the hosted service when the field is missing. <!-- id:qiXEWgy5 -->

The Seed clients build each request URL with `notifyEndpointUrl` from `@shm/shared/notify-url`. A leaf is the last part of a route, such as `notifications`.

- A base that ends in `/hm/api/notify` gets `<base>/<leaf>`.
- A base that is only an origin gets `<origin>/hm/api/<leaf>`.
- The old hostnames `notify.seed.hyper.media` and `notify-dev.seed.hyper.media` are mapped to the hyper.media and dev.hyper.media URLs.

Each client chooses its base in its own order:

| Client | Where the base comes from |
| --- | --- |
| Web app, in the browser | The notify URL the [vault](../software/vault.md) callback names at [sign-in](./sign-in.md) as `notifyServerUrl`, stored in IndexedDB next to the session key. It follows the signed-in session, not the page, and not the site's `NOTIFY_SERVICE_HOST`. |
| Desktop app | The vault's notify setting if the account has one, saved in the synced vault state. Otherwise the build default `VITE_NOTIFY_SERVICE_HOST`: `https://hyper.media/hm/api/notify` in release builds, `https://dev.hyper.media/hm/api/notify` in dev builds. A site's email subscribers come from the service that site advertises. |
| Mobile app | The vault's notify setting, then the chosen site's `notifyServiceUrl` (or `notifyServiceHost`), then `https://hyper.media/hm/api/notify`. |
| Vault | `SEED_VAULT_DEFAULT_NOTIFY_SERVER`, `https://hyper.media/hm/api/notify` when unset. The sign-in callback hands sites only the notify origin. |

# Signed requests <!-- id:pJLQwr0D -->

**Where the routes are.** The main address of every route is `/hm/api/notify/<leaf>`. The API routes also answer at a second address, `/hm/api/<leaf>`. That one is for clients that hold only the origin of the service and add `/hm/api/<leaf>` to it.

**Browsers.** Every response carries `Access-Control-Allow-Origin: *`, and `OPTIONS` answers the CORS preflight on every path.

**How to sign.** A signed route takes a POST body of [DAG-CBOR](../schema/dag-cbor.md). <!-- id:On90zZsQ -->

1. Build the payload `{action, signer, time, accountUid?}`.
2. Encode it as DAG-CBOR and sign those bytes.
3. Send the payload with the signature added as `sig`.

The service encodes the payload again without `sig` and checks the [signature](../signature.md). It accepts Ed25519 signers and compressed P-256 signers.

**Acting for another account.** If `accountUid` is not the signer, the signer must hold an `AGENT` [capability](../protocol/permissions.md) for that account. This is how a browser [session key](./sign-in.md) acts for an account whose key is in the vault.

# Routes

<!-- id:9K1PbjAc -->
| Leaf (canonical `/hm/api/notify/<leaf>`) <!-- col:lE0SQ0Xs --> | Alias <!-- col:mTERIR0z --> | Kind and use <!-- col:TKZRhITy --> <!-- id:vUKhNiUm --> |
| --- | --- | --- |
| `notifications` | `/hm/api/notifications` | signed POST: `get-notification-state`, `apply-notification-actions`, `get-email-subscribers`; web, desktop, mobile; returns inbox, email config and read state in one snapshot <!-- id:K35l0hct --> |
| `notification-inbox`, `notification-config` | `/hm/api/notification-inbox`, `/hm/api/notification-config` | signed POST; the vault: inbox registration, email config, trusted email prevalidation <!-- id:4-30R4gv --> |
| `notification-read-state` | `/hm/api/notification-read-state` | signed POST; compatibility only, no first-party client calls it <!-- id:TuX0LW4r --> |
| `public-subscribe`, `public-subscribe/*` | `/hm/api/public-subscribe*` | unsigned JSON POST; [site](../protocol/sites.md) email subscriptions <!-- id:MncOIYda --> |
| `email-notif-token` | `/hm/api/email-notif-token` | token GET/POST; read and change the settings behind an email's admin token, for the web app's settings page <!-- id:eU5Wuokf --> |
| `unsubscribe` | `/hm/api/unsubscribe` | token; POST is the RFC 8058 one-click unsubscribe, GET unsubscribes and redirects to the settings page <!-- id:xuF-MMYl --> |
| `verify-email` | none | email link (GET): verifies the notification email, then redirects to the settings page <!-- id:U9FYAb_Z --> |
| `read-redirect` | none | email link (GET): marks the notification read, then redirects to `redirectTo` (only `http:`/`https:` targets; otherwise the settings page) <!-- id:ZI1Ctfrl --> |
| `health` | none | GET, `200 {status: "ok", service: "notify", commit}` <!-- id:t8T8X0L_ --> |

The Seed apps use the `notifications` route. A client works in four steps:

1. It fetches the snapshot.
2. It applies each action to its own copy, so the screen changes at once.
3. It sends `apply-notification-actions`.
4. It fetches the snapshot again.

A client never decides what kind of notification an event is. It shows the `NotificationPayload` rows the service stored.

# Links in emails

The service builds email links from the origin of `NOTIFY_SERVICE_HOST`, or of `SEED_BASE_URL` when that is not set. So the links always point at the site that runs the notify service: <!-- id:s4HAEswK -->

<!-- id:uMPueuEC -->
| Link <!-- col:9DqyAAGy --> | URL <!-- col:X2XLbnZ0 --> <!-- id:zLOgMXL6 --> |
| --- | --- |
| Unsubscribe and Manage notifications (footer) | `<origin>/hm/email-notifications?token=<adminToken>`, the [web app](../software/web.md)'s settings page. Never the unsubscribe endpoint: link scanners prefetch body links with GET. <!-- id:KvbqDYtl --> |
| `List-Unsubscribe` header (RFC 8058 one-click POST) | `<origin>/hm/api/notify/unsubscribe?token=<adminToken>` <!-- id:lDOnY_5q --> |
| Open a mention, reply or discussion | `<origin>/hm/api/notify/read-redirect?token=…&accountId=…&eventId=…&eventAtMs=…&redirectTo=<comment url>` <!-- id:Z2tC7bh2 --> |
| Verify the notification email | `<origin>/hm/api/notify/verify-email?token=<verification token>`, which redirects to `/hm/email-notifications?token=<adminToken>&verification=<result>` <!-- id:Qh11RiJn --> |
| Welcome email's site link | `<origin>` <!-- id:wRGrvkxn --> |

The redirects use a relative `Location`. So the browser stays on the public origin the email pointed at, whatever host the proxy forwards to. <!-- id:5qQG-W9O -->

# Email prevalidation

A vault that has already verified a person's email can say so. It signs `{email, signer, host}` with its [daemon](../software/daemon.md)'s key. The notify service then skips its own verification email, but only when both of these hold: <!-- id:FftEpzmA -->

- the host is listed in `NOTIFY_TRUSTED_PREVALIDATORS`;
- the service fetched the host's `/hm/api/config` and its `signerAccountUid` matches the signer.

[The vault](../software/vault.md) describes the signing side.

# Read state rules <!-- id:ezr7MpOk -->

Read state is `{markAllReadAtMs, readEvents}` for each account. `markAllReadAtMs` is the watermark: the time of the last "mark all as read". The same functions in `@shm/shared` (`models/notification-read-logic.ts`) compute read state on the server, in the desktop app and in the browser. The rules make every device reach the same answer, whatever order the actions arrive in. <!-- id:hOMlAsco -->
  - An event is read when its time is at or below the watermark, or when it is listed in `readEvents`. So an old event that arrives after "mark all as read" is already read. <!-- id:t2HkOEr1 -->
  - Merging takes the higher watermark, unions the read events keyed by event id with the later time winning, and then drops every entry at or below the merged watermark. `readEvents` only grows with items read one by one since the last "mark all as read". <!-- id:RWoMciou -->
  - Marking an event unread below the watermark lowers the watermark to just before that event and re-lists the events between as explicit reads, so nothing else flips to unread. The client's optimistic copy only knows the page it loaded, so the service rebuilds that list from the whole inbox before it applies the toggle. A toggle that trusted the client's list would un-read every notification it did not load, such as the notifications of other [spaces](../protocol/spaces.md) in the web app, which loads one space. <!-- id:ounpLhRS -->
  - Watermarks are wall-clock times from the device that set them. A device with a clock in the future marks more as read than intended. A watermark that is a time has this cost. <!-- id:oW_JB0oC -->

After every read-state write the service compares the read status of each notification before and after. A write that un-reads more notifications than its unread toggles is a bug in these rules, and it is reported to Sentry as `notify read marks regressed` with the account, the signing key, the page scope, the action types, both watermarks and a sample of the event ids. Unexpected request failures go to Sentry the same way, since clients swallow the error response. <!-- id:rdAudit01 -->

Event ids and times are the notifier's own (`feedEventId`, computed from the [blob](../protocol/blobs.md)). So a feed page that arrives twice or out of order never splits one notification into two. <!-- id:6Wc9NicA -->

# See also

- [The notify service](../software/notify.md), the program behind this API: its loops, storage and configuration.
- [Site services](./site-services.md), for `/hm/api/config` and the other routes a site serves.
- [Sign in with Seed](./sign-in.md), for session keys and the `AGENT` capability a delegate needs.
- [Signature](../signature.md) and [Capability](../capability.md).
- [The vault](../software/vault.md), which registers inboxes and prevalidates email.
