---
name: Sign in with Seed
summary: Sign in with Seed lets another website act as a person's Hypermedia account without ever holding their key, by using a browser session key and a capability signed by the person's vault.
---
Sign in with Seed lets visitors of your website write on the Hypermedia network as themselves. Your website never sees the visitor's [account](../protocol/identity.md) key. It works in three moves: <!-- id:G1fhaFf2 -->

1. Your website makes a throwaway key in the browser, called the session key.
2. The visitor's [vault](../software/vault.md), the service that keeps their account key, signs a [capability](../protocol/permissions.md). A capability is a signed [blob](../protocol/blobs.md) that lets one key act for another. This one lets the session key act for the account.
3. From then on your website signs with the session key and attaches the capability.

If someone breaks into your website, they get only a session key with limited rights. The account key stays safe.

The flow runs only in a browser. A script or a server that must act for an account uses a bot key with a published capability. [Keys](./keys.md) describes that. <!-- id:OlXms388 -->

# Who takes part <!-- id:JMDSYzo1 -->

<!-- id:nhA7tCwi -->
- **The vault** keeps the account key, checks who the person is, and shows the consent screen. The hosted vault is at `https://hyper.media/vault/`, and its delegation page is `https://hyper.media/vault/delegate`. Any Seed web server that runs the vault serves the same path under its own origin. <!-- id:5yW6mLUG -->
- **The client site** is your website, at your origin. It creates an Ed25519 key with WebCrypto that cannot be exported, keeps it in IndexedDB, and never learns a secret. <!-- id:yfjZrfCC -->

You do not register your website anywhere first. The vault trusts the request because the session key signed it, it names your origin, and it is fresh. <!-- id:wvOYok_3 -->

# The steps <!-- id:Glp76trU -->

1. The person clicks "Sign in with Seed" on your website. You call `startAuth` and send the browser to the URL it returns. This must be a full-page navigation. The flow does not work in an iframe. <!-- id:J9Zlc0L7 -->
2. The vault signs the person in if needed, checks the request, and shows a consent screen that names your origin. <!-- id:akh05uNC -->
3. When the person approves, the vault signs a capability from the chosen account to your session key. The capability has the role `AGENT` and the label `Session key for <your origin>`. The vault then sends the browser back to your `redirect_uri`. <!-- id:fAIChmbc -->
4. On that page you call `handleCallback`. It checks the state value, verifies the capability's signature and [CID](../cid.md), and checks that the capability is from the account to your session key. Then it returns the session. <!-- id:14JDIhWt -->
5. You publish the capability blob to the Seed [site](../protocol/sites.md) you write to, so that [daemons](../software/daemon.md) can verify it. Then you sign [comments](../protocol/comments.md) and [documents](../protocol/documents.md) with `createSessionSigner(session)` and put the capability's CID on each one. <!-- id:AxmJO9wG -->

# The request <!-- id:dF8FlFRs -->

`startAuth` builds a URL on the vault's delegation page with these query parameters: <!-- id:oCR1C8mU -->

<!-- id:7X4g1ljt -->
| Parameter <!-- col:AXTyuUHf --> | Value <!-- col:EPbB0xex --> <!-- id:i13iWONs --> |
| --- | --- |
| `client_id` | your origin (default: `window.location.origin`); must be `https`, or `http` on `localhost` or `127.0.0.1` <!-- id:viScee2z --> |
| `redirect_uri` | where to come back to (default: the current page); same origin as `client_id` <!-- id:-QBBzobQ --> |
| `session_key` | the session key's [principal](../principal.md), `z6Mk…` <!-- id:is-3k7P8 --> |
| `state` | a random value of at least 128 bits, checked on return <!-- id:ET1U0W3B --> |
| `ts` | the request time in Unix milliseconds <!-- id:0hhKodHq --> |
| `email_prevalidation` | optional `1`, asks for proof of a verified email after consent; off by default in the SDK <!-- id:emailProofRequest --> |
| `email`, `site_name` | optional hints for the vault's screen; `site_name` is your own claim, and the vault shows it as a claim <!-- id:-pTdCAF1 --> |
| `invite` | optional invitation code for a vault that only accepts invited people; the vault creates the account before it delegates |
| `proof` | last, a signature by the session key over the URL exactly as it appears without `proof` <!-- id:X9XMwPwU --> |

The vault refuses a request when: <!-- id:wudTTld_ -->

- the `ts` is more than 24 hours old or more than a minute in the future;
- the redirect is on a different origin;
- the principal is malformed.

# The callback <!-- id:G9EQDkdQ -->

The vault sends the browser to `redirect_uri?data=<payload>&state=<state>`. When the person says no, it sends `?error=<code>&state=<state>`. `data` is [DAG-CBOR](../schema/dag-cbor.md), compressed with gzip and written as base64url. Decoded, it is: <!-- id:ckzlJSj6 -->

``` <!-- id:YH4uAr0p -->
{account, capability, capabilityCid, profile?, profileCid?, notifyServerUrl?}
```

`handleCallback` does these checks, in this order. Only then can you use the session. <!-- id:5aq9zVzw -->

1. It decodes the payload.
2. It encodes the capability and the [profile](../profile.md) again and compares their CIDs to the ones sent.
3. It verifies both signatures.
4. It checks that the capability's signer is the account and that its delegate is your session key.

## Proof of a verified email

When you set `requestEmailPrevalidation`, the vault tells the person on the consent screen that it shares their verified email. It then adds a fragment to the redirect: `#email_prevalidation=…`, which is base64url DAG-CBOR `{email, host, signer, sig}`. <!-- id:emailProofCallback -->

- `handleCallback` removes the fragment from the address bar at once, also when it fails.
- It returns the proof only after the delegation checks pass and the proof's issuer matches the vault's origin.
- Treat the proof as private. Do not log it or put it in query parameters.
- The service that receives the proof must still verify its signature and decide whether it trusts the issuer.
- Seed Hosting accepts this proof only for new accounts. An existing account must verify its email again.

# The SDK <!-- id:kZG846xF -->

Everything above is in the `auth` module of the [SDK](./sdk.md). You import it as `@seed-hypermedia/client/auth`. The protocol's constants and validators are in `hmauth`. <!-- id:_NUxWfkl -->

```ts <!-- id:Cyzqzahy -->
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

In the sample, `client` is a `createSeedClient(…)` for the site you write to, and `createComment` comes from `@seed-hypermedia/client`.

The functions: <!-- id:qZTzeVCT -->

- `startAuth(config, options?)` takes `{vaultUrl, clientId?, redirectUri?, email?, siteName?, requestEmailPrevalidation?, invite?}`.
- `handleCallback({vaultUrl})` returns `{accountPrincipal, capability, profile?, session, notifyServerUrl?, emailPrevalidation?} | null`.
- `getSession(vaultUrl)`, `signWithSession(session, bytes)` and `clearSession(vaultUrl)` manage the stored session. The SDK stores one session per vault URL.
- Pass `{store}` in `options` to replace IndexedDB with your own `AuthSessionStore`. The store must be able to hold a `CryptoKey`, which `localStorage` cannot.

The browser needs a secure context (`https`, or `localhost`), WebCrypto with Ed25519, IndexedDB and `CompressionStream`. <!-- id:4hIe5-wt -->

# After sign-in <!-- id:YBbwEDq4 -->

The capability is not a secret. What gives the right to act is holding the session's private key. You must do three things: <!-- id:7usff5Rz -->
  - **Publish the capability** once, with `PublishBlobs`, on the site you write to. A daemon that has not seen the capability rejects [Refs](../ref.md) and comments that name it. <!-- id:F_U0I4o9 -->
  - **Name it** on every write: `capability: capability.cid.toString()` in the input of `createComment`, `createVersionRef`, `createDocumentBlobs` and the other builders, or in `client.publishDocument`. <!-- id:mmGJCcxY -->
  - **Store** `accountPrincipal` and the capability CID next to the session. `getSession` only returns the key. <!-- id:_O-JB8_p -->

The [Seed web app](../software/web.md)'s own sign-in does the same. It also publishes a capability in the other direction and a profile alias, so that everyone can see the session key belongs to the account. Then it sends those blobs to the vault's origin. Another website can skip that. <!-- id:TG6kLcnh -->

To sign out, call `clearSession(vaultUrl)`. The capability stays valid on the network, because a capability cannot be taken back. That is why the vault delegates to a session key you can throw away, and never hands out the account key. The vault records the delegation and can show it to the person. <!-- id:EjeqZPXf -->

# What this is not <!-- id:ku2NGhRH -->

- It is not OAuth. No server talks to another server. The redirect carries everything. <!-- id:BbV4nDw5 -->
- It does not give a server a way to sign. A backend that must act for an account holds its own key and a capability. See [Keys](./keys.md). <!-- id:zf7JGE9M -->
- It does not, alone, let you read [private](../protocol/privacy.md) content. That needs a bearer token from a daemon. You get one by signing an authentication request with the account key or a delegated key. See [Privacy](../protocol/privacy.md). <!-- id:86cEfe6Z -->
- It is not how a second device joins an account in the Seed app. That uses capabilities too, with a different flow. See [Identity](../protocol/identity.md). <!-- id:aem07qyZ -->

# Working with it <!-- id:Y8_al4MS -->

## In the Seed app <!-- id:omoG5IX4 -->

The Seed web app signs its visitors in through the same vault flow. The [desktop app](../software/desktop.md) holds the account key itself and needs no delegation. <!-- id:ofPfIfwk -->

## CLI <!-- id:vUJvv8cl -->

The [CLI](./cli.md) has no sign-in screen. In its place, you give a bot key a capability from the account. [A key for a bot](./keys.md) has the commands. <!-- id:C-_4N5LB -->

## SDK <!-- id:hOdbK3Xd -->

`@seed-hypermedia/client/auth` and `@seed-hypermedia/client/hmauth`, as shown in "The SDK". <!-- id:2JttBeox -->

## Seed API <!-- id:7cKRXkKj -->

The vault's `/vault/delegate` page and your redirect page are ordinary web pages. The only API call in the flow is `POST /api/PublishBlobs`, which publishes the capability. See [Seed API](./web-api.md). <!-- id:iQIqx_JC -->

## Agents <!-- id:nvCY8ikE -->

[Seed Agents](../agent.md) do not use this flow. An agent signs with an identity of its own that the server holds, and it has a capability from the account. That is the same idea without a browser. An agent you run yourself in a browser could use this flow exactly as a website does. See [Using Seed from your own agent](./agents.md). <!-- id:mieGcINK -->

# See also <!-- id:6dmizUGd -->

- [Permissions](../protocol/permissions.md) <!-- id:WEKjClh2 -->
- [Identity](../protocol/identity.md) <!-- id:vg20rX3Y -->
- [Capability](../capability.md) <!-- id:NPFQXmkh -->
- [Keys](./keys.md) <!-- id:qsmZUcxH -->
- [SDK](./sdk.md) <!-- id:xynUkuN_ -->
- [Vault](../software/vault.md) <!-- id:LRqOMEYl -->
