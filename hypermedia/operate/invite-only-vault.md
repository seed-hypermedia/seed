---
name: Running an invite-only vault
summary: This page explains how the operator of an enterprise node makes the vault accept only invited people, creates reader and writer invitations through the admin API, and what the vault server learns about accounts in this mode.
---
An [enterprise node](./enterprise-node.md) runs the [vault](../software/vault.md) on a private [site](../protocol/sites.md) where only invited people may create an account. The vault is the service that keeps people's account keys and signs them in. Two settings turn this mode on: `SEED_VAULT_INVITE_ONLY=true` and `SEED_VAULT_ADMIN_SECRET`, a secret token for the admin API. Signing in to an account that already exists works as before. <!-- id:lAvvk6qI -->

The quickest way to invite someone is `seed-deploy invite <email>` on the node. It calls the admin API described here.

This page is for the operator of such a site. It covers creating invitations, what the invited person sees, the list of invitations, and the lookup the site uses to decide who is a member. The [enterprise node](./enterprise-node.md) page describes the profile that sets these values, and [the vault](../software/vault.md) lists the flags and routes.

# Minting an invitation <!-- id:IwsFv0N1 -->

Every invitation is for one person. To create one, send `POST /vault/api/admin/invitations`: <!-- id:zMHfxcAg -->

- the header is `Authorization: Bearer <admin secret>`;
- the body is `{email, role?, send?}`;
- in invite-only mode `email` is required, and `count`, if you send it, must be 1.

The answer holds a random code and a link that is ready to share. The link has the form `<site>/hm/sign-in?invite=<code>&email=<url-encoded email>`. The site is `--web-base-url`, or the vault's own origin.

The link opens the site's sign-in page. That page starts a delegation to the vault with the invitation attached. So creating the account and signing in to the site are one flow, and the person arrives on the site as a member. Outside invite-only mode the link is `<origin>/vault?invite=<code>`.

`role` is `reader` or `writer`. `reader` is the default. It makes the person a member of the vault, and the site's sign-in check turns that into read access.

Unless `send` is false, the vault emails the link to that address through the sender it is configured with. On an enterprise node that is the hosting relay. The answer says `emailed: true`, or `emailed: false` with an `emailError` when the send failed. The link is in the answer either way, so you can pass it on by hand.

A writer invitation also gives a WRITER [capability](../protocol/permissions.md) on the site's [space](../protocol/spaces.md). It works like this:

1. The person gets an account. The vault learns the account's public ID from the account-claim call described below.
2. The vault signs the capability with the `enterprise-owner` key in the [daemon](../software/daemon.md)'s keystore.
3. The vault records the grant in `invitation_grants`, so it happens once per account.

If a grant fails, the vault tries again on the next claim.

Only the invited address can register with the code. `registerStart` and `registerVerify` both refuse any other email, and they refuse a code that has no email attached.

`GET /vault/api/invitations/:code` is open to everyone. It answers `{email, valid: true}` for an unused code, and `404` for a code that is unknown, used or without an email. It never shows anything else.

# What the invited person sees

A person who reaches the vault with an invitation sees the invited-user screen, not the usual sign-in form. It says "You've been invited to \<relying-party name>", shows the email fixed, and has one Continue button. The name is the `--rp-name` setting, which `/vault/api/config` reports as `relyingPartyName`, or the host name when the setting is empty. A link straight to `/vault?invite=…` is first sent through the site, so that the delegation is in place. <!-- id:cRCNqFwi -->

The screen has no code field, no terms line and no sign-in option. The invitation already says who the person is, and they have no account to sign in to. The app takes the email from the link, and then from the lookup. So a link that lost its query string still works. A used or invalid code shows a plain message with no form.

Continue sends the email and the code to `POST /vault/api/register/invited`. That call creates the account at once and starts the session. There is no second verification code, because the link was itself emailed to that address. The invitation is marked used in the same database transaction that creates the account, so a code works exactly once. After that the flow is the usual one: choose a passkey or a password, and set up the vault.

Without `?invite=` in the URL, the usual sign-in screen shows. In invite-only mode it says that a code is needed to create a new account.

# Listing invitations

`GET /vault/api/admin/invitations` returns, for each invitation: <!-- id:RZpkLnU2 -->

- the role;
- whether it was used, and when;
- `grants`: the accounts that have received the writer capability so far;
- `accounts`: the account IDs that the invited person's app has reported. With these an operator can find the person on the site.

# Account lookup and what the server learns

`GET /vault/api/admin/accounts/:accountUid` tells a site which vault user, if any, holds a given public [account](../protocol/identity.md) ID. It answers `200 {accountUid, email, createTime}` or `404`. The [web app](../software/web.md) uses it at sign-in to decide whether the person is a member. <!-- id:2VgxpDWK -->

For this to work, the vault keeps one thing about each account in plain text: a table of the public account IDs of each vault user.

- The app reports its IDs after it decrypts the vault and after every save, with `POST /vault/api/vault-accounts`.
- Every entry carries a signature by that account's key over `seed-vault-account:<origin>:<vault user id>:<account id>`. So a user cannot register an ID they do not control.
- The vault refuses an ID that is already registered to another user.

The account keys themselves never leave the encrypted data. But on an invite-only vault the server knows which public accounts belong to which email.

# See also

- [The identity vault](../software/vault.md), for the zero-knowledge design, the routes and the flags.
- [Enterprise node](./enterprise-node.md), for the profile, and [self-hosting](./self-hosting.md), for `seed-deploy`.
- [The web app](../software/web.md), for `/hm/api/enterprise-bootstrap` and the sign-in gate.
- [Permissions](../protocol/permissions.md), for the WRITER capability an invitation grants.
- [Sign in with Seed](../build/sign-in.md), for the delegation that the invitation link starts.
