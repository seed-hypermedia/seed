---
name: Running an invite-only vault
summary: How an operator of a private Enterprise site makes the vault accept only invited people, mints reader and writer invitations through the admin API, and what the vault server learns about accounts in this mode.
---
The Enterprise Edition runs the [vault](../software/vault.md) on a private [site](../protocol/sites.md) where only invited people may create an account. Two settings turn this on: `SEED_VAULT_INVITE_ONLY=true` and `SEED_VAULT_ADMIN_SECRET`, a bearer secret for the admin API. Signing in to an existing account is unchanged. <!-- id:lAvvk6qI -->

This page is for the operator of such a site. It covers minting invitations, what the invited person sees, the admin listing, and the account lookup the site uses to decide membership. [Self-hosting](./self-hosting.md) describes the enterprise profile that sets these values, and [the vault](../software/vault.md) lists every flag and route.

# Minting an invitation <!-- id:IwsFv0N1 -->

Every invitation is for one person. An operator mints one with `POST /vault/api/admin/invitations` (`Authorization: Bearer <admin secret>`, body `{email, role?, send?}`; in invite-only mode `email` is required and `count`, if given, must be 1). It returns a random code and a ready-to-share link of the form `<site>/hm/sign-in?invite=<code>&email=<url-encoded email>` (the site is `--web-base-url`, or the vault's own origin). The site's sign-in page starts a delegation to the vault with the invitation attached, so creating the account and signing in to the site are one flow and the person lands on the site as a member. Outside invite-only mode the link is `<origin>/vault?invite=<code>`. <!-- id:zMHfxcAg -->

`role` is `reader` (the default: vault membership, which the site's sign-in gate turns into read access) or `writer`.

Unless `send` is false the vault emails the link to that address through its configured sender (the hosting relay on an enterprise node). The response says `emailed: true`, or `emailed: false` with an `emailError` when the send failed. The link is returned either way, so the operator can pass it on by hand.

A writer invitation also grants a WRITER [capability](../protocol/permissions.md) on the site's space. Once the person has an account, the vault learns its public ID from the account-claim call described below, signs the capability with the `enterprise-owner` key in the daemon's keystore, and records the grant in `invitation_grants` so it happens once per account. A failed grant is retried on the next claim.

Only that address can register with the code: `registerStart` and `registerVerify` both refuse any other email, and a code with no email attached is refused outright.

`GET /vault/api/invitations/:code` is public and answers `{email, valid: true}` for an unused code and 404 for an unknown, used or unbound one. It never reveals anything else.

# What the invited person sees

Reaching the vault with an invitation shows the invited-user screen instead of the usual sign-in form: "You've been invited to \<relying-party name>", the email fixed and not editable, and a single Continue button. The name is the `--rp-name` setting, which `/vault/api/config` reports as `relyingPartyName`, or the host name when it is empty. A link straight to `/vault?invite=…` is first bounced through the site, so that the delegation is in place. <!-- id:cRCNqFwi -->

There is no code field, no terms line and no sign-in option, because the invitation already says who the person is and they have no account to sign in to. The app takes the email from the link and then from the lookup, so a link that lost its query string still works, and a used or invalid code shows a plain message with no form.

Continue sends the email and the code to `POST /vault/api/register/invited`, which creates the account at once and starts the session. The link was itself emailed to that address, so there is no second verification code. The invitation is marked used in the same database transaction that creates the account, so a code works exactly once. From there the flow is the usual one: pick a passkey or password, set up the vault.

Without `?invite=` in the URL the regular sign-in screen is unchanged, and in invite-only mode it says that a code is required to create a new account.

# Listing invitations

`GET /vault/api/admin/invitations` reports, for each invitation, the role, whether and when it was used, the writer `grants` made so far (the accounts that have received the capability), and `accounts`: the account IDs the invited person's app has reported, so an operator can find the person's profile on the site. <!-- id:RZpkLnU2 -->

# Account lookup and what the server learns

`GET /vault/api/admin/accounts/:accountUid` tells a site which vault user, if any, holds a given public [account](../protocol/identity.md) ID: `200 {accountUid, email, createTime}` or `404`. The [web app](../software/web.md) uses it at sign-in to decide membership. <!-- id:2VgxpDWK -->

For this to work the vault keeps one piece of per-account state in plaintext: a table of public account IDs per vault user. The app reports its IDs after it decrypts the vault and after every save (`POST /vault/api/vault-accounts`). Every entry carries a signature by that account's key over `seed-vault-account:<origin>:<vault user id>:<account id>`, so a user cannot register an ID they do not control. An ID already registered to another user is refused.

The account keys themselves never leave the encrypted blob. But on an invite-only vault the server knows which public accounts belong to which email.

# See also

- [The identity vault](../software/vault.md), for the zero-knowledge design, the routes and the flags.
- [Self-hosting](./self-hosting.md), for the enterprise profile and `seed-deploy`.
- [The web app](../software/web.md), for `/hm/api/enterprise-bootstrap` and the sign-in gate.
- [Permissions](../protocol/permissions.md), for the WRITER capability an invitation grants.
- [Sign in with Seed](../build/sign-in.md), for the delegation that the invitation link starts.
