---
name: The notify API
summary: The HTTP API of the notify service, with how a client finds a site's notify service, how requests are signed, every route, the links emails carry, and the rules that keep read state the same on every device.
---
The [notify service](../software/notify.md) keeps each [account](../protocol/identity.md)'s notification inbox and read state and sends email. This page is the reference for talking to it: where it lives, how a request is signed, what each route does, and how read state merges. The [web app](../software/web.md), the [desktop app](../software/desktop.md), the [vault](../software/vault.md) and the [mobile app](../software/mobile.md) are its clients, and a third party can be one too. There is no client for it in the [SDK](./sdk.md); the transport is `models/notification-service.ts` in `@shm/shared`.

# Finding the notify service

Notify lives on a [site](../protocol/sites.md)'s own origin, at `https://<site>/hm/api/notify`. The hosted instance is `https://hyper.media/hm/api/notify`.

A [site](../protocol/sites.md) advertises its notify service in `/hm/api/config` as `notifyServiceUrl` (the canonical base, such as `https://site.com/hm/api/notify`) and, for older clients, `notifyServiceHost` (that base's origin), set from `NOTIFY_SERVICE_HOST` on the [web app](../software/web.md). The web app's `/hm/notifications` page signs requests in the browser with the [session key](./sign-in.md) and stores the notify host it learned at sign-in. The [mobile app](../software/mobile.md) reads the same field and falls back to the hosted service. <!-- id:qiXEWgy5 -->

Every client builds its request URLs with `notifyEndpointUrl` from `@shm/shared/notify-url`. A canonical base (one that ends in `/hm/api/notify`) gets `<base>/<leaf>`. An origin-only base gets `<origin>/hm/api/<leaf>`. The same module maps the hostnames `notify.seed.hyper.media` and `notify-dev.seed.hyper.media` to the hyper.media and dev.hyper.media URLs.

Each client picks its base in its own order:

| Client | Where the base comes from |
| --- | --- |
| Web app, in the browser | The notify URL the [vault](../software/vault.md) callback names at [sign-in](./sign-in.md) as `notifyServerUrl`, stored in IndexedDB next to the session key. It follows the signed-in session, not the page, and not the site's `NOTIFY_SERVICE_HOST`. |
| Desktop app | The vault's notify setting if the account has one, saved in the synced vault state. Otherwise the build default `VITE_NOTIFY_SERVICE_HOST`: `https://hyper.media/hm/api/notify` in release builds, `https://dev.hyper.media/hm/api/notify` in dev builds. A site's email subscribers come from the service that site advertises. |
| Mobile app | The vault's notify setting, then the chosen site's `notifyServiceUrl` (or `notifyServiceHost`), then `https://hyper.media/hm/api/notify`. |
| Vault | `SEED_VAULT_DEFAULT_NOTIFY_SERVER`, `https://hyper.media/hm/api/notify` when unset. The sign-in callback hands sites only the notify origin. |

# Signed requests <!-- id:pJLQwr0D -->

Every route is canonical under `/hm/api/notify/<leaf>`. The API leaves are also served at the alias `/hm/api/<leaf>`, for clients that hold an origin-only notify URL and append `/hm/api/<leaf>`. Every response carries `Access-Control-Allow-Origin: *`, and `OPTIONS` answers the CORS preflight on every path. The signed routes take a POST body of [DAG-CBOR](https://ipld.io/specs/codecs/dag-cbor/spec/): the client builds `{action, signer, time, accountUid?}`, signs the CBOR encoding, and sends it with `sig`. The service re-encodes the unsigned payload to verify the [signature](../signature.md). If `accountUid` differs from the signer, the signer must hold an `AGENT` [capability](../protocol/permissions.md) for that [account](../protocol/identity.md), which is how a browser [session key](./sign-in.md) acts for the account held in the [vault](../software/vault.md). The service accepts Ed25519 and compressed P-256 signers. <!-- id:On90zZsQ -->

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

The `notifications` route is the one first-party clients use. A client fetches the snapshot, reduces each action into its local copy, sends `apply-notification-actions`, and refetches. Clients never classify feed events. They render the `NotificationPayload` rows the service persisted.

# Links in emails

Email links are built from the origin of `NOTIFY_SERVICE_HOST` (falling back to `SEED_BASE_URL`), so they always point at the site that hosts notify: <!-- id:s4HAEswK -->

<!-- id:uMPueuEC -->
| Link <!-- col:9DqyAAGy --> | URL <!-- col:X2XLbnZ0 --> <!-- id:zLOgMXL6 --> |
| --- | --- |
| Unsubscribe and Manage notifications (footer) | `<origin>/hm/email-notifications?token=<adminToken>`, the [web app](../software/web.md)'s settings page. Never the unsubscribe endpoint: link scanners prefetch body links with GET. <!-- id:KvbqDYtl --> |
| `List-Unsubscribe` header (RFC 8058 one-click POST) | `<origin>/hm/api/notify/unsubscribe?token=<adminToken>` <!-- id:lDOnY_5q --> |
| Open a mention, reply or discussion | `<origin>/hm/api/notify/read-redirect?token=…&accountId=…&eventId=…&eventAtMs=…&redirectTo=<comment url>` <!-- id:Z2tC7bh2 --> |
| Verify the notification email | `<origin>/hm/api/notify/verify-email?token=<verification token>`, which redirects to `/hm/email-notifications?token=<adminToken>&verification=<result>` <!-- id:Qh11RiJn --> |
| Welcome email's site link | `<origin>` <!-- id:wRGrvkxn --> |

The redirects use a relative `Location`, so they resolve on the public origin the email pointed at whatever host the proxy forwards to. <!-- id:5qQG-W9O -->

# Email prevalidation

A vault that has already verified a person's email signs `{email, signer, host}` with its [daemon](../software/daemon.md)'s key. The notify service accepts that instead of sending a verification email only when the host is in `NOTIFY_TRUSTED_PREVALIDATORS`, and only after fetching the host's `/hm/api/config` and checking that `signerAccountUid` matches the signer. <!-- id:FftEpzmA -->

[The vault](../software/vault.md) describes the signing side.

# Read state rules <!-- id:ezr7MpOk -->

Read state is `{markAllReadAtMs, readEvents}` per account, and the same pure functions in `@shm/shared` (`models/notification-read-logic.ts`) decide it on the server, in the desktop app and in the browser. The rules are chosen so that every device converges on the same answer whatever order the actions arrive in. <!-- id:hOMlAsco -->
  - An event is read when its time is at or below the watermark, or when it is listed in `readEvents`. An old event that arrives after "mark all as read" is therefore already read. <!-- id:t2HkOEr1 -->
  - Merging takes the higher watermark, unions the read events keyed by event id with the later time winning, and then drops every entry at or below the merged watermark. `readEvents` only grows with items read one by one since the last "mark all as read". <!-- id:RWoMciou -->
  - Marking an event unread below the watermark lowers the watermark to just before that event and re-lists the events between as explicit reads, so nothing else flips to unread. The client's optimistic copy only knows the page it loaded, so the service rebuilds that list from the whole inbox before it applies the toggle. A toggle that trusted the client's list would un-read every notification it did not load, such as other spaces' notifications in the web app, which loads one space. <!-- id:ounpLhRS -->
  - Watermarks are wall-clock times from the device that set them. A device with a clock in the future marks more as read than intended. This is the accepted cost of a timestamp watermark. <!-- id:oW_JB0oC -->

After every read-state write the service compares the read status of each notification before and after. A write that un-reads more notifications than its unread toggles is a bug in these rules, and it is reported to Sentry as `notify read marks regressed` with the account, the signing key, the page scope, the action types, both watermarks and a sample of the event ids. Unexpected request failures go to Sentry the same way, since clients swallow the error response. <!-- id:rdAudit01 -->

Event ids and times are the notifier's own (`feedEventId`, derived from the blob), so duplicate or reordered feed pages never split one notification into two. <!-- id:6Wc9NicA -->

# See also

- [The notify service](../software/notify.md), the program behind this API: its loops, storage and configuration.
- [The web API](./web-api.md), for `/hm/api/config` and the other site services.
- [Sign in with Seed](./sign-in.md), for session keys and the `AGENT` capability a delegate needs.
- [Signature](../signature.md) and [Capability](../capability.md).
- [The vault](../software/vault.md), which registers inboxes and prevalidates email.
