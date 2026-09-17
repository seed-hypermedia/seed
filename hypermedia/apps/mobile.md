---
name: The Seed mobile app
summary: The Expo and React Native app for iOS, Android and the web that reads documents and discussions from a Seed site, keeps identities in an on-device vault, and chats with Seed Agents.
---
The Seed mobile app puts Hypermedia on a phone. It opens [documents](../protocol/documents.md) from a Seed [site](../protocol/sites.md), shows their [discussions](../protocol/comments.md), lets you comment as one of your identities, shows your notifications, and lets you talk to your agents. It runs no [daemon](./daemon.md) and keeps no copy of the network. Every read and write goes through a site's [Seed API](../build/web-api.md). It is under active development and builds for iOS, Android and the web from one codebase. <!-- id:aDm-H60i -->

# Where the code is <!-- id:qaYxfJDr -->

`frontend/apps/mobile`, package `@shm/mobile`: Expo 54, React Native 0.81 with the new architecture, React 19, React Navigation, React Query 4, MMKV for storage on native and `localStorage` on the web. <!-- id:XYdhlZ4S -->

<!-- id:X1BwpdMa -->
| Path <!-- col:rt1wTHAX --> | What it holds <!-- col:MuwKipGt --> <!-- id:JJAURxXU --> |
| --- | --- |
| `index.ts`, `App.tsx` | The entry point and providers. <!-- id:Pa9b-_e5 --> |
| `src/navigation/RootNavigator.tsx` | The screen stack. <!-- id:WeEhsO6T --> |
| `src/screens/` | Server select, [account](../protocol/identity.md), identities, [vault](./vault.md), vault connect, [document](../protocol/documents.md), [comment](../protocol/comments.md), notifications. <!-- id:nMUYLxTv --> |
| `src/components/` | React Native renderers for [blocks](../protocol/blocks.md), embeds, query blocks, discussions and the comment composer. <!-- id:FW-GGQM_ --> |
| `src/client/` | The [Seed API](../build/web-api.md) client for the chosen server and its `/hm/api/config`. <!-- id:KuSkleI_ --> |
| `src/vault/` | The on-device vault: encrypted envelope, secure key storage, vault connect, remote sync. <!-- id:7SQRlCKS --> |
| `src/agents/` | The agents screens. <!-- id:TVQVAzLe --> |
| `src/notifications/notify.ts` | The signed client for the [notify service](./notify.md). <!-- id:MzFsXA5o --> |
| `dev/mock-agents-server.ts` | A scripted [agents server](./agents.md) for UI work. <!-- id:b3PVL8zR --> |

## Why it sits outside the pnpm workspace <!-- id:klVaYLDA -->

The root pnpm workspace pins React 18 for the desktop and web apps, and React Native 0.81 needs React 19. So `pnpm-workspace.yaml` excludes this app, and it installs its own dependencies with npm. It still uses repository code without publishing it: <!-- id:9Z0Vi2P6 -->
  - `@seed-hypermedia/client` is aliased to `frontend/packages/client` in `metro.config.js`, `tsconfig.json` and `jest.config.js`. The client's own dependencies resolve from the root `node_modules`, so run `pnpm install` at the root first. <!-- id:sPsIwfBa -->
  - `@shm/ui/agents/*` is mapped to the shared agents code, limited to `.ts` files so an accidental import of a web component fails at bundle time. <!-- id:xpG76AYZ -->
  - Metro's `resolveRequest` forces one copy of `react` and `@tanstack/react-query`; otherwise a shared module resolves React 18 from the root and its hooks break. <!-- id:WwwNlgDl -->
  - Metro watches only a short list of package folders. Watching the repository root crawls over a million files and crash-loops watchman, so a new cross-package import means adding its folder to that list. <!-- id:3P5DvcLF -->

# How it talks to the network <!-- id:vp3jwNvF -->

The app talks to one server at a time, chosen on the server screen and saved on the device. The default is `https://dev.hyper.media`; add `https://hyper.media` or any Seed [site](../protocol/sites.md) to use production data. <!-- id:6NAuJtfu -->
  - **Reads** use `createSeedClient(serverUrl)` from the [SDK](../build/sdk.md): `Resource`, `InteractionSummary` and the other typed `/api/<Key>` requests. The [documents](../protocol/documents.md) and [discussions](../protocol/comments.md) it renders are the same data the [web app](./web.md) shows. See [The web API](../build/web-api.md). <!-- id:TY75zC5p -->
  - **Writes** are signed on the phone. The comment composer builds a [comment](../comment.md) [blob](../protocol/blobs.md) with the SDK's `createComment` and sends it with `publish`, the `PublishBlobs` action. <!-- id:ERlOuHIt -->
  - **Site config** comes from the server's `/hm/api/config`, which is also how the app learns the site's [notify service](./notify.md). <!-- id:9cdxxreq -->

# Identities and the vault <!-- id:scPuECkp -->

The app keeps identities in its own device [vault](./vault.md), a TypeScript port of the [daemon](./daemon.md)'s vault in `backend/storage/vault`. Private keys are stored in the platform keychain through `expo-secure-store` with the `WHEN_UNLOCKED_THIS_DEVICE_ONLY` access setting, so the keychain does not copy them to other devices. On the web build, which is for development and tests, the secret store falls back to browser storage. <!-- id:JCMx1aka -->

You get an identity into the app in one of three ways: <!-- id:DJUJweEh -->
  1. **Create** a new key on the device. <!-- id:8QFULcF3 -->
  2. **Import** a 12-word [recovery phrase](../protocol/identity.md). The derivation matches the daemon: BIP-39 seed, SLIP-10 path `m/44'/104109'/0'`, Ed25519. See [Keys](../build/keys.md). <!-- id:U23PWR6y -->
  3. **Connect a remote vault**, `https://hyper.media/vault` by default. The app runs the same vault connect handshake as the [desktop app](./desktop.md) and then syncs identities with the remote vault, merging changes from both sides. The handshake is described on [the vault](./vault.md) page. You can also import an unencrypted `.seedkey` file exported from the desktop app; password-protected exports need Argon2id, which the app's JavaScript engine cannot run. <!-- id:7uPmNHPG -->

# Running it <!-- id:BXoG5SJY -->

```sh <!-- id:BE0BZAN9 -->
pnpm mobile:install      # npm install inside the app; run pnpm install at the root first
pnpm mobile              # Expo dev server: scan the QR code, or press w for the web build
pnpm mobile:web          # web build only
pnpm mobile:test         # jest unit tests
pnpm mobile:typecheck
```

The `ios/` and `android/` folders are generated and are not in git. Create them with `npx expo prebuild`, then run `npx expo run:ios` or `npx expo run:android`. Release builds go through Expo Application Services (`eas.json`); `npm run submit` builds and submits the iOS app. The bundle id is `media.hyper.seed.mobile` and the URL scheme is `hm`. <!-- id:4G2VLZZc -->

The end-to-end tests live in the repository's `tests/` package. `mobile-web.integration.test.ts` drives the web build with Playwright against a real [daemon](./daemon.md) and [web app](./web.md), and `mobile-vault.integration.test.ts` covers the [vault](./vault.md). <!-- id:lNLgFsqL -->

# Working with it <!-- id:6-mjxoeu -->

## In the Seed app <!-- id:aKT52ua8 -->

The mobile app shares identities with the [desktop app](./desktop.md) only through a connected remote [vault](./vault.md). It does not read the desktop app's local data. <!-- id:tRSh-x3_ -->

## SDK <!-- id:Tkvxnjn3 -->

The app is a working example of the [SDK](../build/sdk.md) in React Native: the client, `createComment`, CBOR and signing all run under React Native with a few shims. <!-- id:RGqpKXJ4 -->

## Web API <!-- id:yD0N6wpY -->

Everything the app shows comes from a [site](../protocol/sites.md)'s `/api/<Key>` routes and `/hm/api/config`. Images come from the site service `/hm/api/image/<cid>`, which resizes them. <!-- id:4YRR-bHB -->

## Agents <!-- id:UHV5HLBL -->

The Agents screens list your agents, open sessions and chat. They reuse the platform-neutral half of the shared agents code, the signed client, React Query models, chat row model and tool summaries, and only rewrite the views. The [agents server](./agents.md) defaults to `https://agentic.seed.hyper.media`, overridable with `EXPO_PUBLIC_SEED_AGENT_SERVER_URL` or in the app. <!-- id:r9o8K8r_ -->

For UI work without spending tokens, `npm run mock-agents` serves a scripted agents server on `http://localhost:3052` that streams replies, shows pending tool calls, advances a plan and parks a run for an answer. It does not verify signatures, binds to loopback only, and must never be deployed. <!-- id:zIZYXZ2C -->

# See also <!-- id:K0b69uPH -->

- [The vault](./vault.md), [Seed Agents](./agents.md), [The web app](./web.md) <!-- id:T-OJb71Q -->
- [Keys](../build/keys.md), [The SDK](../build/sdk.md) <!-- id:M-OQQ1N9 -->
