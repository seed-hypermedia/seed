# Seed Builder Guide

Status: current.

This is the canonical docs index for people and agents building or fixing Seed. Start here when the work crosses
subsystem boundaries or when you are not sure where a behavior is owned.

## Read order

1. [`AGENTS.md`](../AGENTS.md) for repo-wide rules and validation expectations.
2. [`docs/domain/glossary.md`](./domain/glossary.md) for shared product/protocol language.
3. [`docs/architecture/overview.md`](./architecture/overview.md) for runtime boundaries and sources of truth.
4. [`docs/code-map.md`](./code-map.md) for "if touching X, start in these files" maps.
5. The relevant subsystem README or doc listed below.

## Repo map

| Path                                                                | What lives here                                                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`backend/**`](../backend/README.md)                                | Go daemon, gRPC/HTTP APIs, blob/index/storage, P2P, local vault storage, tests.   |
| [`frontend/apps/web`](../frontend/apps/web/README.md)               | Remix public/site web app, SSR loaders, web editing, daemon HTTP integration.     |
| [`frontend/apps/desktop`](../frontend/apps/desktop/README.md)       | Electron shell, main/preload/renderer wiring, local daemon lifecycle, desktop UI. |
| [`frontend/apps/notify`](../frontend/apps/notify/README.md)         | Notification service routes, email verification, inbox/config/read-state APIs.    |
| [`frontend/packages/shared`](../frontend/packages/shared/README.md) | Shared TS API adapters, routes, models, document machine, query ownership.        |
| [`frontend/packages/client`](../frontend/packages/client/README.md) | Low-level Hypermedia client: signing, blob payloads, import/export helpers.       |
| [`frontend/packages/editor`](../frontend/packages/editor/README.md) | TipTap/BlockNote editor, readonly viewer, comment editor, editor extensions.      |
| [`frontend/packages/ui`](../frontend/packages/ui)                   | Shared React UI components and document/resource surfaces.                        |
| [`proto/**`](../proto/README.md)                                    | Protobuf service contracts and generated Go/TS API source.                        |
| [`vault/**`](../vault/README.md)                                    | Remote identity vault service and SPA; use Bun here, not pnpm.                    |
| [`ops/**`](../ops)                                                  | Deployment tooling; uses pinned Bun version from `ops/package.json`.              |
| [`docs/plans/**`](./plans)                                          | Planning documents. Treat as proposals unless the status index says otherwise.    |

## Doc status convention

Use these labels in indexes and new docs:

| Status       | Meaning                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| `current`    | Intended to describe the present system or current workflow.                          |
| `plan`       | Proposed or in-progress work. Do not treat as shipped behavior without checking code. |
| `historical` | Useful context about previous decisions or shipped changes; may be stale in details.  |
| `superseded` | Replaced by another doc; keep only for traceability.                                  |

## Current docs index

| Doc                                                                                                               | Status     | Notes                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------- |
| [`docs/dev-setup.md`](./dev-setup.md)                                                                             | current    | Concise local setup and common commands.                                   |
| [`docs/domain/glossary.md`](./domain/glossary.md)                                                                 | current    | Canonical domain vocabulary.                                               |
| [`docs/architecture/overview.md`](./architecture/overview.md)                                                     | current    | Runtime/component map and source-of-truth table.                           |
| [`docs/code-map.md`](./code-map.md)                                                                               | current    | Starting points by feature area.                                           |
| [`docs/templates/feature-brief.md`](./templates/feature-brief.md)                                                 | current    | Template for non-trivial feature/fix briefs.                               |
| [`docs/local-ci-with-agent-ci.md`](./local-ci-with-agent-ci.md)                                                   | current    | Local GitHub Actions parity workflow before pushing.                       |
| [`docs/vault-session-key-delegation.md`](./vault-session-key-delegation.md)                                       | current    | Vault delegation protocol explanation.                                     |
| [`docs/document-lifecycle-explained.md`](./document-lifecycle-explained.md)                                       | current    | User-facing document lifecycle explanation.                                |
| [`docs/notifications/local-first-read-state-edge-cases.md`](./notifications/local-first-read-state-edge-cases.md) | current    | Notification read-state edge cases and policy.                             |
| [`docs/sentry-dashboard-setup.md`](./sentry-dashboard-setup.md)                                                   | current    | Sentry project/token setup checklist.                                      |
| [`docs/all-documents-page-spec.md`](./all-documents-page-spec.md)                                                 | plan       | Implementation spec; verify against code before assuming shipped behavior. |
| [`docs/copy-link-submenu.md`](./copy-link-submenu.md)                                                             | historical | Records copy-link submenu changes.                                         |
| [`docs/draft-context-unification.md`](./draft-context-unification.md)                                             | plan       | Draft context cleanup proposal.                                            |
| [`docs/subscriptions-master-plan.md`](./subscriptions-master-plan.md)                                             | plan       | Performance/subscription architecture proposal.                            |

## Plan docs index

All docs in `docs/plans/**` are status `plan` unless this table is updated.

| Plan doc                                                                                  | Status | Notes                                                          |
| ----------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| [`docs/plans/editor-big-plan.md`](./plans/editor-big-plan.md)                             | plan   | Unified document lifecycle/editor target design.               |
| [`docs/plans/editor-macro-plan.md`](./plans/editor-macro-plan.md)                         | plan   | Macro migration plan for the editor renderer.                  |
| [`docs/plans/plan-comment-performance.md`](./plans/plan-comment-performance.md)           | plan   | Web comment performance instrumentation and optimization plan. |
| [`docs/plans/plan-editor-document-features.md`](./plans/plan-editor-document-features.md) | plan   | Editor extension migration proposal.                           |
| [`docs/plans/plan-editor-migration-steps.md`](./plans/plan-editor-migration-steps.md)     | plan   | Incremental editor migration steps.                            |
| [`docs/plans/plan-web-desktop-sharing.md`](./plans/plan-web-desktop-sharing.md)           | plan   | Web/desktop document sharing refactor plan and ledger.         |
| [`docs/plans/reactions-plan.md`](./plans/reactions-plan.md)                               | plan   | Proposed reactions model.                                      |

## Common workflows

| Workflow                       | Start with                                                                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add proto/API field            | [`proto/README.md`](../proto/README.md), [`docs/code-map.md#protocodegen`](./code-map.md#protocodegen).                                                                                       |
| Change storage schema          | [`backend/storage/AGENTS.md`](../backend/storage/AGENTS.md), [`docs/code-map.md#storage-migrations`](./code-map.md#storage-migrations).                                                       |
| Change document UI             | [`frontend/README.md`](../frontend/README.md), [`docs/code-map.md#document-publishediting`](./code-map.md#document-publishediting).                                                           |
| Change notification behavior   | [`docs/code-map.md#notifications`](./code-map.md#notifications), notification architecture docs linked there.                                                                                 |
| Change vault/identity behavior | [`docs/domain/glossary.md#vault-vs-account-hierarchy`](./domain/glossary.md#vault-vs-account-hierarchy), [`docs/code-map.md#identityvaultdelegation`](./code-map.md#identityvaultdelegation). |
