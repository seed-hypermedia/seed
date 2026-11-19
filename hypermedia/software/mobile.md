---
name: The Seed mobile app
summary: The Seed mobile app is the Expo and React Native app for iOS, Android and the web that reads documents and discussions from a Seed site, keeps identities in a vault on the device, and chats with Seed Agents.
---
The Seed mobile app puts Hypermedia on a phone. People use it to read, to comment and to talk to their [agents](../agent.md) when they are away from the desktop app. It builds for iOS, Android and the web from one codebase. <!-- id:aDm-H60i -->

The app does five things:

- It opens [documents](../protocol/documents.md) from a Seed [site](../protocol/sites.md).
- It shows their [discussions](../protocol/comments.md).
- It lets you comment as one of your [identities](../protocol/identity.md).
- It shows your notifications.
- It lets you chat with your agents.

The app runs no [daemon](./daemon.md) and keeps no copy of the network. Every read and write goes through a site's [Seed API](../build/web-api.md).

# Where the code is <!-- id:qaYxfJDr -->

The code is in `frontend/apps/mobile`, package `@shm/mobile`. It is built with Expo, React Native with the new architecture, React 19, React Navigation and React Query. It stores data with MMKV on a phone and with `localStorage` on the web. <!-- id:XYdhlZ4S -->

<!-- id:X1BwpdMa -->
| Path <!-- col:rt1wTHAX --> | What it holds <!-- col:MuwKipGt --> <!-- id:JJAURxXU --> |
| --- | --- |
| `index.ts`, `App.tsx` | The entry point and providers. <!-- id:Pa9b-_e5 --> |
| `src/navigation/RootNavigator.tsx` | The screen stack. <!-- id:WeEhsO6T --> |
| `src/screens/` | Server select, [account](../protocol/identity.md), identities, [vault](./vault.md), vault connect, [document](../protocol/documents.md), [comment](../protocol/comments.md), notifications. <!-- id:nMUYLxTv --> |
| `src/components/` | The React Native views for [blocks](../protocol/blocks.md), [embeds](../block/embed.md), [query blocks](../block/query.md) and discussions, and the comment composer. <!-- id:FW-GGQM_ --> |
| `src/client/` | The [Seed API](../build/web-api.md) client for the chosen server and its `/hm/api/config`. <!-- id:KuSkleI_ --> |
| `src/vault/` | The vault on the device: the encrypted envelope, secure key storage, vault connect and remote sync. <!-- id:7SQRlCKS --> |
| `src/agents/` | The agents screens. <!-- id:TVQVAzLe --> |
| `src/notifications/notify.ts` | The signed client for the [notify service](./notify.md). <!-- id:MzFsXA5o --> |
| `dev/mock-agents-server.ts` | A fake [app environment](./app-environment.md) with scripted answers, for UI work. <!-- id:b3PVL8zR --> |

## Why it sits outside the pnpm workspace <!-- id:klVaYLDA -->

The root pnpm workspace uses React 18 for the desktop app, and this app's React Native version needs React 19. So `pnpm-workspace.yaml` leaves this app out, and the app installs its own dependencies with npm. It still uses code from the repository without publishing it: <!-- id:9Z0Vi2P6 -->
  - `@seed-hypermedia/client`, the [SDK](../build/sdk.md), is aliased to `frontend/packages/client` in `metro.config.js`, `tsconfig.json` and `jest.config.js`. The client's own dependencies resolve from the root `node_modules`, so run `pnpm install` at the root first. <!-- id:sPsIwfBa -->
  - `@shm/ui/agents/*` points at the shared agents code. Only `.ts` files are allowed, so an import of a web component by mistake fails when the app is bundled. <!-- id:xpG76AYZ -->
  - Metro's `resolveRequest` forces one copy of `react` and `@tanstack/react-query`. Without it, a shared module loads React 18 from the root and its hooks break. <!-- id:WwwNlgDl -->
  - Metro watches only a short list of package folders. If it watched the repository root, it would read over a million files and watchman would crash again and again. So when you import from a new package, add its folder to that list. <!-- id:3P5DvcLF -->

# How it talks to the daemon <!-- id:vp3jwNvF -->

It runs no daemon. The app talks to one Seed [site](../protocol/sites.md) at a time. You choose the site on the server screen, and the app saves the choice on the device. <!-- id:6NAuJtfu -->
  - **Reads** use `createSeedClient(serverUrl)` from the [SDK](../build/sdk.md): `Resource`, `InteractionSummary` and the other typed `/api/<Key>` requests. The [documents](../protocol/documents.md) and [discussions](../protocol/comments.md) it renders are the same data the [web app](./web.md) shows. See [Seed API](../build/web-api.md). <!-- id:TY75zC5p -->
  - **Writes** are signed on the phone. The comment composer builds a [comment](../comment.md) [blob](../protocol/blobs.md) with the SDK's `createComment`. It sends the blob with `publish`, which is the `PublishBlobs` action of the [Seed API](../build/web-api.md). <!-- id:ERlOuHIt -->
  - **Site config** comes from the server's `/hm/api/config`. This is also how the app learns the site's [notify service](./notify.md). [The notify API](../build/notify-api.md) gives the order in which the app looks. <!-- id:9cdxxreq -->

# Configuration

- **Server.** The default server is `https://dev.hyper.media`. Add `https://hyper.media` or any Seed site on the server screen to use production data.
- **App environment.** The default is `https://hyper.media/hm/api/apps`. Override it with `EXPO_PUBLIC_SEED_APPS_ENVIRONMENT_URL` at build time, or in the app.
- **Remote vault.** `https://hyper.media/vault` by default.

# Identities and the vault <!-- id:scPuECkp -->

The app keeps identities in its own vault on the device. That vault is a TypeScript port of the [daemon](./daemon.md)'s local vault in `backend/storage/vault`. It can sync with a remote [vault](./vault.md), the Seed service that stores encrypted keys. <!-- id:JCMx1aka -->

The app stores private [keys](../protocol/identity.md) in the platform keychain through `expo-secure-store`, with the `WHEN_UNLOCKED_THIS_DEVICE_ONLY` access setting. So the keychain does not copy them to other devices. The web build is for development and tests, and there the secret store uses browser storage.

You get an identity into the app in one of three ways: <!-- id:DJUJweEh -->
  1. **Create** a new key on the device. <!-- id:8QFULcF3 -->
  2. **Import** a 12-word [recovery phrase](../protocol/identity.md). The derivation matches the daemon: BIP-39 seed, SLIP-10 path `m/44'/104109'/0'`, Ed25519. See [Keys](../build/keys.md). <!-- id:U23PWR6y -->
  3. **Connect a remote vault**, `https://hyper.media/vault` by default. The app runs the same vault connect handshake as the [desktop app](./desktop.md). Then it syncs identities with the remote vault and merges changes from both sides. [The vault](./vault.md) page describes the handshake. <!-- id:7uPmNHPG -->

You can also import an unencrypted `.seedkey` file that the desktop app exported. The app cannot import an export with a password, because that needs Argon2id, which the app's JavaScript engine cannot run.

# Running it <!-- id:BXoG5SJY -->

```sh <!-- id:BE0BZAN9 -->
pnpm mobile:install      # npm install inside the app; run pnpm install at the root first
pnpm mobile              # Expo dev server: scan the QR code, or press w for the web build
pnpm mobile:web          # web build only
pnpm mobile:test         # jest unit tests
pnpm mobile:typecheck
```

The `ios/` and `android/` folders are generated and are not in git. Create them with `npx expo prebuild`, then run `npx expo run:ios` or `npx expo run:android`. Run these commands inside `frontend/apps/mobile`. Release builds go through Expo Application Services (`eas.json`). `npm run submit` builds the iOS app and submits it. The bundle id is `media.hyper.seed.mobile` and the URL scheme is `hm`. <!-- id:4G2VLZZc -->

The end-to-end tests live in the repository's `tests/` package. `mobile-web.integration.test.ts` drives the web build with Playwright against a real [daemon](./daemon.md) and [web app](./web.md), and `mobile-vault.integration.test.ts` covers the [vault](./vault.md). <!-- id:lNLgFsqL -->

# Working with it <!-- id:6-mjxoeu -->

## In the Seed app <!-- id:aKT52ua8 -->

The mobile app shares identities with the [desktop app](./desktop.md) in one way only: both connect to the same remote [vault](./vault.md). The mobile app does not read the desktop app's local data. <!-- id:tRSh-x3_ -->

## SDK <!-- id:Tkvxnjn3 -->

The app is a working example of the [SDK](../build/sdk.md) in React Native. The client, `createComment`, CBOR and signing all run under React Native with a few small patches. <!-- id:RGqpKXJ4 -->

## Seed API <!-- id:yD0N6wpY -->

Everything the app shows comes from a [site](../protocol/sites.md)'s `/api/<Key>` routes and `/hm/api/config`. [Images](../protocol/files.md) come from the site service `/hm/api/image/<cid>`, which resizes them. See [Seed API](../build/web-api.md). <!-- id:4YRR-bHB -->

## Agents <!-- id:UHV5HLBL -->

The Agents screens list your [Seed Agents](../agent.md), open [sessions](../agent/session.md) and let you chat. They reuse the part of the shared agents code that does not depend on a platform: the signed client, the React Query models, the chat row model and the tool summaries. Only the views are written again for React Native. [Configuration](#configuration) says which [app environment](./app-environment.md) the app talks to. <!-- id:r9o8K8r_ -->

For UI work that spends no model tokens, run `npm run mock-agents` inside `frontend/apps/mobile`. It serves a fake app environment on `http://localhost:3052` with scripted answers. It streams replies, shows tool calls that wait, moves a plan forward and pauses a run to wait for an answer. It does not check signatures and it binds to loopback only. Never deploy it. <!-- id:zIZYXZ2C -->

# See also <!-- id:K0b69uPH -->

- [The vault](./vault.md), [The app environment](./app-environment.md), [The web app](./web.md), [The notify service](./notify.md) <!-- id:T-OJb71Q -->
- [Keys](../build/keys.md), [The SDK](../build/sdk.md) <!-- id:M-OQQ1N9 -->
