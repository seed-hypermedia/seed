---
name: Sign in with Seed
summary: How a third-party website lets a person act as their Hypermedia account without ever holding their key, using a browser session key and a capability signed by the user's vault.
---
A website that wants its visitors to write as themselves on the Hypermedia network must never see the visitor's [account](../protocol/identity.md) key. Sign in with Seed solves this the way the protocol solves every trust question, with a signed [blob](../protocol/blobs.md). The site makes a throwaway key in the browser. The user's [vault](../apps/vault.md) signs a [capability](../capability.md) that lets that key act for the account. From then on the site signs with its own key and attaches the capability. If the site is compromised, the attacker gets only a session key with a scoped grant. The account key stays safe.

The flow is browser-only by design. A script or server that needs to act for an account uses a bot key with a published capability. See [Keys](./keys.md).

# The parties

- **The vault** keeps the account key, authenticates the person and shows the consent screen. The hosted vault is at `https://hyper.media/vault/`, and its delegation page is `https://hyper.media/vault/delegate`. Any Seed web server that runs the vault serves the same path under its own origin.
- **The client site** is your origin. It creates a non-extractable Ed25519 key with WebCrypto, keeps it in IndexedDB, and never learns anything secret.

Nothing is registered in advance. The vault trusts the redirect because the request is signed by the session key, is bound to your origin, and is fresh.

# The ceremony

1. The person clicks "Sign in with Seed" on your site. You call `startAuth` and navigate to the URL it returns, as a full-page navigation (the flow does not work in an iframe).
2. The vault authenticates the person if needed, checks the request, and shows consent naming your origin.
3. On approval the vault signs a capability from the chosen account to your session key, with role `AGENT` and the label `Session key for <your origin>`, and redirects back to your `redirect_uri`.
4. On that page you call `handleCallback`. It checks the state, verifies the capability's signature and [CID](../protocol/blobs.md), checks that the capability's delegate is your session key and that its signer is the account, and returns the session.
5. You publish the capability blob so [daemons](../apps/daemon.md) can verify it, then sign [comments](../protocol/comments.md) and [documents](../protocol/documents.md) with `createSessionSigner(session)`, putting the capability's CID on each.

# The request

`startAuth` builds a URL on the vault's delegation page with these query parameters:

| Parameter | Value |
| --- | --- |
| `client_id` | your origin (default: `window.location.origin`); must be `https`, or `localhost` |
| `redirect_uri` | where to come back to (default: the current page); same origin as `client_id` |
| `session_key` | the session key's [principal](../principal.md), `z6Mk…` |
| `state` | a random value of at least 128 bits, checked on return |
| `ts` | the request time in Unix milliseconds |
| `email`, `site_name` | optional hints for the vault's UI; `site_name` is claimed by you and shown as such |
| `proof` | last, a signature by the session key over the URL exactly as it appears without `proof` |

The vault refuses a proof older than 24 hours or more than a minute in the future, a redirect on a different origin, or a malformed principal.

# The callback

The vault redirects to `redirect_uri?data=<payload>&state=<state>`, or `?error=<code>&state=<state>` when the person declines. `data` is base64url of gzip of DAG-CBOR:

```
{account, capability, capabilityCid, profile?, profileCid?, notifyServerUrl?}
```

`handleCallback` decodes it, re-encodes the capability and the profile and compares their CIDs to the ones sent, verifies both signatures, and checks the two principal relationships. Only then does the session become usable.

# The SDK

Everything above is the `auth` module of the [SDK](./sdk.md), imported as `@seed-hypermedia/client/auth`. The protocol constants and validators are in `hmauth`.

```ts
import {startAuth, handleCallback, getSession, createSessionSigner, clearSession} from '@seed-hypermedia/client/auth'

const VAULT = 'https://hyper.media/vault/delegate'

// 1. the sign-in button
async function signIn() {
  location.href = await startAuth({vaultUrl: VAULT, siteName: 'My site'})
}

// 2. on every page load of the redirect page
const result = await handleCallback({vaultUrl: VAULT})   // null when this load is not a callback
if (result) {
  const {accountPrincipal, capability, profile, session} = result
  await client.publish({blobs: [{cid: capability.cid.toString(), data: capability.data}]})
  // remember accountPrincipal and capability.cid alongside the session
}

// 3. later, acting as the account
const session = await getSession(VAULT)
const signer = createSessionSigner(session!)
const comment = await createComment({docId, docVersion, content}, signer)
```

`startAuth(config, options?)` takes `{vaultUrl, clientId?, redirectUri?, email?, siteName?}`. `handleCallback({vaultUrl})` returns `{accountPrincipal, capability, profile?, session, notifyServerUrl?} | null`. `getSession(vaultUrl)`, `signWithSession(session, bytes)` and `clearSession(vaultUrl)` manage the stored session. Sessions are keyed by vault URL. Pass `{store}` in `options` to replace IndexedDB with your own `AuthSessionStore` (it must be able to hold a `CryptoKey`, which `localStorage` cannot).

Requirements: a secure context (`https`, or `localhost`), WebCrypto with Ed25519, IndexedDB and `CompressionStream`.

# After sign-in

The capability is not a secret. Authority comes from holding the session's private key. What you must do:

- **Publish the capability** with `PublishBlobs` on the site you write to, once. A daemon that has not seen the capability rejects [Refs](../ref.md) and comments that cite it.
- **Cite it** on every write: `capability: capability.cid.toString()` in the input of `createComment`, `createVersionRef`, `createDocumentBlobs` and the other builders, or in `client.publishDocument`.
- **Store** `accountPrincipal` and the capability CID next to the session. `getSession` only returns the key.

The [Seed web app](../apps/web.md)'s own sign-in does the same. It also publishes a reverse capability and a [profile](../protocol/identity.md) alias so that the session key is visibly linked to the account, then pushes those blobs to the vault's origin. A third-party site can skip that.

Signing out is `clearSession(vaultUrl)`. The capability stays valid on the network, because capabilities cannot be revoked today. That is why the delegation goes to a session key you can discard and never to the account key. The vault records the delegation and can show it to the person.

# What this is not

- It is not OAuth, and there is no server-to-server channel. The redirect carries everything.
- It does not give a server a way to sign. A backend that needs to act for an account holds its own key and a capability. See [Keys](./keys.md).
- It does not authenticate reads of [private](../protocol/privacy.md) content on its own. That needs a daemon bearer token, obtained by signing an authentication request with the account or a delegated key. See [Privacy](../protocol/privacy.md).
- Device linking inside the Seed app (a second device joining an account) uses the same capability mechanism with a different flow. See [Identity](../protocol/identity.md).

# Working with it

## In the Seed app

The Seed web app signs its visitors in through the same vault flow. The [desktop app](../apps/desktop.md) holds the account key itself and needs no delegation.

## CLI

The CLI has no interactive sign-in. Its equivalent is a bot key plus `seed-cli capability create --delegate <bot> --role AGENT` issued by the account, then `-a <account>` on writes. See [Seed CLI](./cli.md).

## SDK

`@seed-hypermedia/client/auth` and `@seed-hypermedia/client/hmauth`, as above.

## Web API

The vault's `/vault/delegate` page and the client's redirect page are ordinary pages. The only API call in the flow is `POST /api/PublishBlobs` to publish the capability. See [Seed API](./web-api.md).

## Agents

[Seed Agents](../agent.md) do not use this flow. An agent signs with a server-held identity of its own and holds a capability from the account, which is the headless shape of the same idea. An external agent running in a browser could use it exactly as a site does. See [Using Seed from your own agent](./agents.md).

# See also

- [Permissions](../protocol/permissions.md)
- [Identity](../protocol/identity.md)
- [Capability](../capability.md)
- [Keys](./keys.md)
- [SDK](./sdk.md)
- [Vault](../apps/vault.md)
