# @seed-hypermedia/client

Status: current.

`@seed-hypermedia/client` is the low-level TypeScript Hypermedia client. It owns protocol-shaped payload construction,
signing helpers, import/export helpers, and schema/types that are useful outside a specific app shell.

## Ownership map

| Area                     | Files                                                                                                                                                                                                                                                                      | Notes                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Public exports           | [`src/index.ts`](./src/index.ts)                                                                                                                                                                                                                                           | Keep exports deliberate; app-level models should usually live in `@shm/shared`. |
| Client facade            | [`src/client.ts`](./src/client.ts)                                                                                                                                                                                                                                         | Low-level client operations around Hypermedia objects and daemon/web APIs.      |
| Signing and capabilities | [`src/signing.ts`](./src/signing.ts), [`src/capability.ts`](./src/capability.ts), [`src/keyfile.ts`](./src/keyfile.ts), [`src/encryption.ts`](./src/encryption.ts)                                                                                                         | Cryptographic signing, keyfile handling, encryption helpers.                    |
| Blob payloads            | [`src/change.ts`](./src/change.ts), [`src/ref.ts`](./src/ref.ts), [`src/comment.ts`](./src/comment.ts), [`src/contact.ts`](./src/contact.ts), [`src/document-state.ts`](./src/document-state.ts)                                                                           | Build and interpret Hypermedia document/comment/contact/ref state.              |
| Imports/conversion       | [`src/markdown-to-blocks.ts`](./src/markdown-to-blocks.ts), [`src/blocks-to-markdown.ts`](./src/blocks-to-markdown.ts), [`src/pdf-to-blocks.ts`](./src/pdf-to-blocks.ts), [`src/tei-to-blocks.ts`](./src/tei-to-blocks.ts), [`src/file-to-ipfs.ts`](./src/file-to-ipfs.ts) | Import helpers and block conversions.                                           |
| Types/schemas            | [`src/hm-types.ts`](./src/hm-types.ts), [`src/editor-types.ts`](./src/editor-types.ts)                                                                                                                                                                                     | Runtime schemas and shared TS types close to protocol payloads.                 |
| Resolver/URLs            | [`src/hm-resolver.ts`](./src/hm-resolver.ts), [`src/auto-link.ts`](./src/auto-link.ts), [`src/base64.ts`](./src/base64.ts)                                                                                                                                                 | Hypermedia URL/ID helper logic.                                                 |

## Guidelines

- Keep this package app-agnostic: no Electron, Remix loader, React query, or UI dependencies.
- Prefer `@shm/shared` for higher-level product models and app-facing hooks.
- Add tests next to protocol/signing/import helpers; many files already have colocated `*.test.ts` coverage.

## Commands

```bash
pnpm --filter @seed-hypermedia/client test
pnpm --filter @seed-hypermedia/client typecheck
pnpm --filter @seed-hypermedia/client build
pnpm --filter @seed-hypermedia/client format:write
```
