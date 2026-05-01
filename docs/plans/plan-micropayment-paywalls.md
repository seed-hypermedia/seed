# Micropayment Paywalls — Design Doc

Status: Research / proposal. No code changes.
Owner: TBD.
Branch: `claude/research-micropayments-wTRWZ`.

## 1. Goal

Let a **site/space owner** define rules that require a small Lightning payment
(in sats) to perform a write action on their site. Use the existing — but
currently feature-flagged — Lightning/LNDHub stack to settle those payments.

User-confirmed scope:

- Phase 1 (MVP): **pay-per-action** for **comments** and **replies**.
- Phase 2: pay-per-action for **delegated publishing** (i.e. "publish under
  another account using a delegated capability").
- Phase 3: **subscriptions / petitions to join a space** (recurring or one-time
  membership fee). Designed for, but not built in MVP.

Recipient model: one rule per site, paid to the **site/space owner's wallet**.

## 2. Where this fits in the existing system

### 2.1 What's already there

- BOLT11 + LNDHub stack:
  - `backend/api/payments/v1alpha/{wallet.go,invoices.go}`
  - `backend/lndhub/`, `backend/lndhub/lndhubsql/`
  - `backend/wallet/walletsql/`
- DB: `wallets(id, account, address, name, type, login, password, token)` with
  `wallets.account` referencing the user's principal — see
  `backend/storage/schema.sql`.
- Frontend wallet UI: `frontend/apps/desktop/src/components/payment-settings.tsx`
  (create/import/export, fund, withdraw, transactions).
- Multi-recipient allocator with built-in 1% protocol fee:
  `frontend/packages/shared/src/models/payment-allocations.ts` — already shaped
  for split tipping; we'll reuse it.
- Feature flag: `LIGHTNING_API_URL` (default `https://ln.seed.hyper.media`).
  When unset, `frontend/packages/shared/src/models/payments.ts:11` short-circuits
  payment queries. Re-enabling is a configuration change, not new code.
- P2P "remote invoice request" RPC is **stubbed** with `Hm-24. Not implemented`
  in `backend/api/payments/v1alpha/wallet.go:189-251`. We rely on the existing
  LNDHub "create invoice on the recipient's wallet" path instead and **don't
  need P2P invoice requests for MVP**.

### 2.2 Where the gate lives

Seed is decentralized: a comment is a signed blob that propagates P2P. A peer
running their own daemon can always create a comment locally and gossip it. So
a paywall isn't really a "you cannot publish this comment" rule — it's a **rule
that the gateway / site host enforces about what it accepts and serves**.

Concretely, the existing `--public-only` flag (`backend/config/config.go:24`)
already establishes the gateway-mode pattern: the daemon running behind a
public site filters what it returns. Our paywall enforcement extends that
pattern.

This means MVP scope is:

1. **Site daemon** (the one behind the Remix `web` app for a site) refuses to
   accept and serve comments that arrive without a payment receipt.
2. **Comment authors** ask that site for an invoice, pay it, then attach the
   payment hash + preimage to their comment when they submit it.
3. **Other peers** that don't run paywall enforcement can still freely sync
   blobs — that's an inherent property of the network, not a bug.

We don't try to make the protocol cryptographically enforce payment. We just
make the canonical site refuse to serve unpaid content. (Subscriptions in
Phase 3 are similar: granted as a delegated capability on the site account.)

## 3. Architectural sketch

```
                          ┌─────────────────────────────────────┐
                          │   COMMENTER (desktop or web reader) │
                          └──┬──────────────────────────────────┘
                             │ 1. POST /paywall/quote { action, target }
                             │ 2. POST /paywall/invoice
                             ▼
   ┌─────────────────────────────────────────────────────┐
   │   SITE DAEMON (gateway mode)                        │
   │   - holds site owner's wallet credentials           │
   │   - has paywall_rules table                         │
   │   - issues invoice via LNDHub                       │
   │   - on settlement, mints PaymentReceipt blob        │
   │   - on CreateComment, requires receipt to be valid  │
   └────────────────────┬────────────────────────────────┘
                        │ create_invoice (existing)
                        ▼
                  ┌────────────────────┐
                  │  LNDHub server     │
                  │  ln.seed.hyper.media│
                  └──────────┬─────────┘
                             │ settles BOLT11
                             ▼
                  ┌────────────────────┐
                  │  Lightning Network │
                  └────────────────────┘
```

Phases of payment lifecycle:

1. **Quote.** Reader's client asks the site daemon "what does it cost to
   comment on this doc?" Daemon answers with the rule.
2. **Invoice.** Reader's client asks for an invoice (BOLT11). Daemon creates
   one against the site owner's LNDHub wallet, with a stable invoice memo of
   the form `seed-paywall:<action>:<target>:<nonce>`.
3. **Pay.** Reader pays via WebLN, NWC, or pasting the invoice into their
   wallet (desktop: built-in wallet UI we already have).
4. **Receipt.** When daemon sees the invoice settled (it polls the wallet,
   same way `addinvoice`/transaction history already does), it produces a
   **PaymentReceipt** — a signed/short-lived blob that authorizes one specific
   write action.
5. **Submit.** Reader publishes the comment (`CreateComment`) carrying the
   receipt token. The site daemon validates receipt → admits the comment.

## 4. Data model

### 4.1 New: paywall rule (per site)

A site's paywall rule is configurable metadata on the site's root document
(extending `HMMetadata`, surfaced in the desktop options panel —
`frontend/apps/desktop/src/components/options-panel.tsx`).

```ts
// frontend/packages/shared/src/hm-types.ts (or wherever HMMetadata lives)
export type HMSitePaywall = {
  enabled: boolean
  rules: {
    action: 'comment' | 'reply' | 'delegated-publish'
    priceSats: number
    // optional split — defaults to [{account: siteOwner, ratio: 1}]
    allocation?: PaymentAllocation
    // human-readable why-this-costs-money line shown to the payer
    reason?: string
  }[]
}
```

The rule lives in document metadata so it gossips with the site like any
other config. The site daemon reads it from its local index when answering
quote/invoice requests.

Phase 3 extends `action` with `'subscription'` and adds `period: 'monthly'
| 'yearly' | 'one-time'`.

### 4.2 New: paywall receipts (gateway-local)

Receipts don't need to be syncable blobs in MVP. They're consumed by the
gateway right after payment, then become dead weight. A small SQLite table on
the site daemon is enough.

```sql
-- backend/storage/schema.sql + new migration in storage_migrations.go
CREATE TABLE paywall_receipts (
  id INTEGER PRIMARY KEY,
  payment_hash BLOB NOT NULL UNIQUE,    -- BOLT11 r-hash
  payer_account INTEGER REFERENCES public_keys(id),
  site_account INTEGER NOT NULL REFERENCES public_keys(id),
  action TEXT NOT NULL,                 -- 'comment'|'reply'|'delegated-publish'|'subscription'
  target_path TEXT NOT NULL,            -- doc path on the site
  amount_sat INTEGER NOT NULL,
  reply_parent BLOB,                    -- optional CID for reply scoping
  paid_at INTEGER NOT NULL,
  consumed_at INTEGER,                  -- nullable; set when receipt is spent
  expires_at INTEGER NOT NULL           -- e.g. paid_at + 30 minutes
) STRICT;

CREATE INDEX paywall_receipts_by_hash ON paywall_receipts (payment_hash);
CREATE INDEX paywall_receipts_by_payer ON paywall_receipts (payer_account, site_account);
```

Receipts are single-use. `consumed_at` is set in the same transaction that
admits the comment, so a duplicate submission is rejected.

### 4.3 New: subscription grants (Phase 3 only — sketch)

For "petition to join a community", a successful payment creates a Capability
on the site account (proto already exists at
`proto/documents/v3alpha/access_control.proto`) — likely with a new role
`MEMBER`, scoped by time. Not detailed here.

## 5. Backend changes

All of these go in the **site daemon** (i.e. the daemon a site host runs).
Behavior is gated by a new flag analogous to `--public-only`:

```
--paywall-enabled  Enforce the site's paywall rules on writes
```

When unset, none of this changes existing behavior — important so dev
environments and non-monetized sites stay zero-friction.

### 5.1 New gRPC: `PaywallService`

```proto
// proto/payments/v1alpha/paywall.proto  (new file)
service Paywall {
  rpc Quote(QuoteRequest) returns (QuoteResponse);
  rpc CreateInvoice(CreateInvoiceRequest) returns (PaywallInvoice);
  rpc PollReceipt(PollReceiptRequest) returns (Receipt);
}

message QuoteRequest {
  string site_account = 1;
  string target_path = 2;
  string action = 3;          // "comment" | "reply" | "delegated-publish"
  string reply_parent = 4;    // optional, only for reply
}

message QuoteResponse {
  bool required = 1;
  uint64 amount_sat = 2;
  string reason = 3;
  repeated Allocation allocation = 4;
}

message Allocation { string account = 1; uint64 amount_sat = 2; }

message CreateInvoiceRequest {
  string site_account = 1;
  string target_path = 2;
  string action = 3;
  string payer_account = 4;   // optional but recommended
  string reply_parent = 5;
}

message PaywallInvoice {
  string payment_request = 1;
  bytes payment_hash = 2;
  int64 expires_at = 3;
}

message PollReceiptRequest { bytes payment_hash = 1; }
message Receipt {
  bool paid = 1;
  string token = 2;           // opaque receipt the comment publisher attaches
  int64 expires_at = 3;
}
```

Invoice creation reuses the existing `walletsrv.CreateInvoice` flow against
the site's wallet. The daemon already polls invoice status for the wallet UI
(see `backend/api/payments/v1alpha/invoices.go`); we just add a small index
into `paywall_receipts` when an invoice with our memo prefix settles.

### 5.2 Hook in `CreateComment`

```go
// backend/api/documents/v3alpha/comments.go (CreateComment)
if srv.cfg.PaywallEnabled {
    if err := srv.paywall.Authorize(ctx, paywall.Authorization{
        SiteAccount: space,
        TargetPath:  in.TargetPath,
        Action:      paywall.ActionComment, // or ActionReply if ReplyParent != ""
        Token:       in.PaywallReceiptToken, // new field on CreateCommentRequest
        AuthorAccount: kp.Principal(),
        ReplyParent: replyParent,
    }); err != nil {
        return nil, status.Errorf(codes.PermissionDenied, "paywall: %v", err)
    }
}
```

`paywall.Authorize` checks: token present, hash matches a receipt row,
not expired, not consumed, action+target match, payer matches author (or
absent if anonymous comments are allowed by the rule). On success, marks
`consumed_at`.

### 5.3 Hook in delegated publish (Phase 2)

The publish flow is client-driven (no `PublishDocument` RPC), but a site
daemon can refuse to **accept and serve** a doc whose author is using a
capability delegated from the site account, unless the same paywall token is
attached. The hook would be in the blob admit path (where capabilities are
already validated) — similar shape to the comment hook above.

### 5.4 Proto changes

- New: `proto/payments/v1alpha/paywall.proto` (above).
- Update: `proto/documents/v3alpha/comments.proto` —
  `CreateCommentRequest` gains `string paywall_receipt_token = N;`
- Regenerate via `./dev gen //proto/...`.

## 6. Frontend changes

### 6.1 Site owner — configuring the rule

New "Monetization" section in
`frontend/apps/desktop/src/components/options-panel.tsx`, only shown on the
site's **root** document (the doc with `metadata.siteUrl`). Persists into the
site's `HMMetadata.paywall` field via the existing `onMetadata` callback.

### 6.2 Reader — paying to comment

Hook in `frontend/apps/web/app/commenting.tsx` (and the desktop equivalent
`frontend/apps/desktop/src/components/commenting.tsx`):

1. Before submit, call `Paywall.Quote`. If `required=false`, business as
   usual.
2. Otherwise, replace the submit button with a paywall card: amount, reason,
   "Pay to comment" button.
3. On click, `Paywall.CreateInvoice` → present BOLT11. Three pay paths:
   - **Built-in wallet** (if user has set one up via `payment-settings.tsx`):
     pay directly via existing `payInvoice` mutation.
   - **WebLN** (`window.webln.sendPayment`, already used in
     `frontend/apps/notify/app/payments.tsx`).
   - **Manual** (copy/QR code + an "I've paid" button that polls
     `Paywall.PollReceipt`).
4. On settlement → receive `token`, attach to the original
   `publishComment(...)` call.

### 6.3 Shared

- New shared model in `frontend/packages/shared/src/models/paywall.ts` for
  the React Query hooks (`useQuote`, `useCreateInvoice`, `usePollReceipt`).
- Reuses `payment-allocations.ts` to render the split breakdown in the UI.

### 6.4 Feature gate

Until the LIGHTNING_API_URL flag is fully turned on in production, this whole
path can short-circuit just like `models/payments.ts` does today: if the env
var is missing, the paywall UI never renders and the backend flag stays off.
That gives us a safe progressive rollout.

## 7. Fat-marker mockups

These are deliberately rough — structure and copy, not visual design.

### 7.1 Site owner — Monetization panel

```
┌──── Site Settings ▾ ───────────────────────────────────────────────┐
│                                                                    │
│  General   Visibility   [ Monetization ]   Members   Domains       │
│  ─────────────────────────────────────────────────────             │
│                                                                    │
│   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓             │
│   ┃  💰  Charge readers to comment on this site     ┃             │
│   ┃                                                 ┃             │
│   ┃   ( ⦿ )  enabled                                ┃             │
│   ┃                                                 ┃             │
│   ┃   Comment              [  100 ] sats            ┃             │
│   ┃   Reply to a comment   [  100 ] sats            ┃             │
│   ┃   Publish under my acct[ 1000 ] sats   [+ rule] ┃             │
│   ┃                                                 ┃             │
│   ┃   Reason shown to payer:                        ┃             │
│   ┃   ┌─────────────────────────────────────────┐  ┃             │
│   ┃   │ Helps keep the spam out 🌱              │  ┃             │
│   ┃   └─────────────────────────────────────────┘  ┃             │
│   ┃                                                 ┃             │
│   ┃   Payments go to:                               ┃             │
│   ┃     • alice@ln.seed.hyper.media   100%          ┃             │
│   ┃   ( + add recipient — split with co-authors )   ┃             │
│   ┃                                                 ┃             │
│   ┃   Earnings (last 30d): 12,400 sats              ┃             │
│   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛             │
│                                                                    │
│   [ Save changes ]                                                 │
└────────────────────────────────────────────────────────────────────┘
```

### 7.2 Reader — write a comment

```
   ┌──────────────────────────────────────────────────────────────┐
   │  💬  Write a comment                                          │
   │  ┌────────────────────────────────────────────────────────┐  │
   │  │ this is a great paragraph                              │  │
   │  │                                                        │  │
   │  │                                                        │  │
   │  └────────────────────────────────────────────────────────┘  │
   │                                                              │
   │   ╭────────── 💰  This site requires payment ──────────╮     │
   │   │                                                    │     │
   │   │      100 sats   to post a comment                  │     │
   │   │      "Helps keep the spam out 🌱"                  │     │
   │   │                                                    │     │
   │   │   [  Pay 100 sats and post  ]                      │     │
   │   │                                                    │     │
   │   │   wallet balance: 1,240 sats   ▾                   │     │
   │   ╰────────────────────────────────────────────────────╯     │
   └──────────────────────────────────────────────────────────────┘
```

### 7.3 Reader — no built-in wallet, fall back to BOLT11

```
   ┌──────────────────────────────────────────────────────────────┐
   │   💰  Pay to comment                                          │
   │                                                              │
   │   Send 100 sats to:                                          │
   │                                                              │
   │           ┌─────────────────────┐                            │
   │           │   ░░ ▓▓▓░░▓▓▓ ░░    │   lnbc1u1pj...kqzy        │
   │           │   ▓░ ░▓▓░▓▓░ ▓▓    │   [ copy ]   [ open in    │
   │           │   ░░ ▓▓▓░▓▓▓ ░░    │     wallet ]              │
   │           └─────────────────────┘                            │
   │                                                              │
   │   ( ⏳ waiting for payment — expires in 2:54 )               │
   │                                                              │
   │   New to Lightning?  [ Set up a Seed wallet ]                │
   └──────────────────────────────────────────────────────────────┘
```

### 7.4 Phase 3 — petition to join a space

```
   ┌──────────────────────────────────────────────────────────────┐
   │   🤝  Join the "Plant Identification" space                   │
   │                                                              │
   │   Members can post documents and comment without per-action  │
   │   fees.                                                      │
   │                                                              │
   │     ⦿  One-time   2,000 sats                                 │
   │     ○  Monthly      500 sats / month                         │
   │                                                              │
   │   [  Pay and request membership  ]                           │
   │                                                              │
   │   Membership grants you a WRITER capability on the space     │
   │   for the duration above. Paid memberships are reviewed by   │
   │   the space owner before activation.                         │
   └──────────────────────────────────────────────────────────────┘
```

## 8. File touch list (estimates)

Backend (Go):

- `proto/payments/v1alpha/paywall.proto`  *new*
- `proto/documents/v3alpha/comments.proto`  add `paywall_receipt_token`
- `backend/api/payments/v1alpha/paywall.go`  *new* — service + Authorize()
- `backend/api/documents/v3alpha/comments.go`  add hook in `CreateComment`
- `backend/storage/schema.sql` + `backend/storage/storage_migrations.go`  add
  `paywall_receipts` table + migration
- `backend/config/config.go`  add `PaywallEnabled bool` flag
- `backend/api/payments/v1alpha/invoices.go`  small change to flag
  paywall-tagged invoices when polling

Frontend (TS):

- `frontend/packages/shared/src/hm-types.ts`  extend `HMMetadata`
- `frontend/packages/shared/src/models/paywall.ts`  *new*
- `frontend/apps/desktop/src/components/options-panel.tsx`  Monetization
  section
- `frontend/apps/desktop/src/components/commenting.tsx`  paywall-aware submit
- `frontend/apps/web/app/commenting.tsx`  same on the web reader
- `frontend/packages/ui/`  one or two small components (PaywallCard,
  InvoiceQR) — reuse existing styles

Tests:

- Go: integration test for `CreateComment` with/without receipt; unit tests
  for `paywall.Authorize` (expired, double-spend, mismatched action).
- TS: Vitest for the new shared model; Vitest for paywall-aware commenting
  flow; Playwright e2e for the desktop happy path.

## 9. Risks / open questions

1. **Anonymity vs. anti-double-spend.** If we let unauthenticated readers
   pay, the receipt-to-author binding gets weaker. MVP proposal: receipt
   is bound to the LNDHub-side `payer_account` field if present, else to a
   short-lived token (the daemon issues an opaque random token alongside the
   invoice and only it can later trade that token for a signed comment).
   Worth a thread before coding.
2. **P2P leak.** A peer who runs their own daemon can still mint a comment
   blob with no payment. The canonical site won't serve it, but other peers
   might — that's by design but worth documenting in the user-facing copy.
3. **Federated splits.** `payment-allocations.ts` already supports custom
   ratios. For the site-owner-only MVP the split is trivial (100% to owner),
   but allocator codepaths still apply the 1% Seed fee — confirm we want that
   on every paid action.
4. **Subscription enforcement.** Phase 3 needs a `MEMBER` role on the
   capability proto, and its expiry has to be respected in the comment
   gate. Not in MVP but flagged so we don't paint ourselves into a corner
   with the Phase 1 schema.
5. **Re-enabling the disabled flag.** This whole feature requires
   `LIGHTNING_API_URL` to be live in prod. Coordinate with the team that
   owns the LNDHub deployment before shipping.
6. **Refunds.** If a comment fails server-side validation **after** payment
   (e.g. the document was deleted between quote and submit), we need a
   policy: auto-refund via LNDHub `payinvoice` to the payer's account, or
   credit a "comment one of these instead" voucher. MVP: refund is manual,
   surface it in the wallet UI.

## 10. Out of scope (for this doc)

- On-chain BTC, Fedimint, Cashu, NWC remote-signer flows.
- Read-paywalls (encrypting document bodies). Mentioned only to confirm
  it's not in scope.
- Tip-jar without gating (already mostly possible with existing wallet UI;
  separate effort).
- Re-implementing the stubbed P2P invoice request RPC. Not needed for the
  site-host paywall; revisit when we want pure peer-to-peer tipping.
