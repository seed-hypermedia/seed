---
name: Desktop Assistant Write Access Plan
summary: Allow the in-app desktop assistant to create and update Seed content while keeping write actions explicit, inspectable, and safe by default.
---
<!-- id:v4SCh2XE -->
> **STATUS (2026-08-13): not built as designed, and the premise it rests on is gone.** <!-- id:7unABCn9 -->

\> <!-- id:b4kk7XY3 -->
  > This plan assumed a separate desktop assistant runtime with its own tool executor, distinct from the Agents service. <!-- id:MJWwmN3H -->
  > That separation no longer exists: the assistant panel is an ordinary agent session on the local agents server (see <!-- id:R2mnbOyx -->
  > `desktop-agent-unification.md`), so an assistant write is the same **write verb**, executed server-side and signed <!-- id:txhoEMrR -->
  > with the agent's selected `signingKeys`. <!-- id:XF9cy2GD -->

\> <!-- id:-NlyncIX -->
  > Consequently the **per-write inline confirmation card** and the **Auto-approve writes** toggle were never built, and <!-- id:nzgv8IS1 -->
  > nothing in the code today gates an individual write on a user decision. What stands in their place is coarser and <!-- id:lnKZy-Np -->
  > up-front: the **publish grant** — a per-agent permission (the "Publish Seed content" toggle) that decides whether that <!-- id:sOdQJfSf -->
  > agent may write signed public content at all. Memory and tool writes are never gated by it. An agent without the grant <!-- id:59WPTkVM -->
  > cannot publish; an agent with it does not ask each time. <!-- id:uwbx9Hj_ -->

\> <!-- id:wJXvk1oS -->
  > The user is not locked out of the loop, but the mechanism is different from this plan's: through the **symmetric log** <!-- id:zjIuppUt -->
  > the user runs `read`/`write`/`call` themselves from the composer's wrench palette, and those actions land on the same <!-- id:Putkh29x -->
  > log with a "You" chip. A confirmation step for agent-initiated writes remains a genuinely open design question — the <!-- id:Tp1TG0LK -->
  > nearest shipped precedent is the M6 design's **draft→active consent** for triggers, which is also not built yet. <!-- id:3Nf72Wo5 -->

\> <!-- id:vFSrp7OG -->
  > Read this document for the confirmation-card UX thinking, not for how writes work. <!-- id:Kxcbk38u -->

# Goal <!-- id:ddaW1z6j -->

Allow the in-app desktop assistant to create and update Seed content while keeping write actions explicit, inspectable, and safe by default. <!-- id:65Z9TIQP -->

The desktop assistant should be able to use the shared `write` tool API for selected write operations, especially: <!-- id:tfj-b5FZ -->
  - creating comments and threaded replies; <!-- id:xDO5LowA -->
  - creating documents; <!-- id:T2qBrQ0s -->
  - updating documents; <!-- id:vNJHuZ-a -->
  - later, publishing drafts or other write commands if they have clear product UX. <!-- id:m0AyfNSk -->

This is separate from the standalone Agents service, which already wires the `write` tool through server-side signing identities. The desktop assistant must write as the current local user/account and should use the same local signing/publishing paths as the existing desktop UI. <!-- id:FAYikQDZ -->

# UX Model <!-- id:9scJVkIv -->

Add a control in the assistant panel header, near the top right: <!-- id:84vA5dKz -->
  - label: `Auto-approve writes` or `Allow writes without asking`; <!-- id:sAfWH8NK -->
  - default: disabled; <!-- id:Z3hkkJXe -->
  - scope: current local desktop user/account, persisted locally or session-scoped depending on product preference. <!-- id:A4KfNUAj -->

Behavior: <!-- id:yJzFXqmw -->
  1. When disabled, every assistant write request becomes an inline confirmation card in the chat. <!-- id:lhRn8Hmz -->
  2. The user can approve or cancel the write. <!-- id:-NL8guqY -->
  3. When enabled, the assistant can execute supported writes immediately. <!-- id:XgHv-LBm -->
  4. The UI must make the enabled state visually obvious so users know the assistant can mutate content. <!-- id:jeotGAMV -->

# Confirmation Flow <!-- id:QXA8D7Ww -->

When the model calls `write` and auto-approval is disabled: <!-- id:u55kHnI0 -->
  1. The `write` tool executor creates a pending write request. <!-- id:76KeYRKp -->
  2. The chat displays an inline confirmation card with: <!-- id:mZlVCXE3 -->
     - write command, e.g. `comment.create`; <!-- id:hRam6d45 -->
     - target document/comment/resource; <!-- id:Kbj-7F3D -->
     - signer/current account; <!-- id:OfFqAkge -->
     - content preview; <!-- id:x_6PNa6w -->
     - relevant metadata such as title, path, reply parent, or dry-run status; <!-- id:db2IHFio -->
     - `Approve` and `Cancel` actions. <!-- id:y-wv3HSY -->
  3. The tool execution waits for the user decision. <!-- id:09gyM3i8 -->
  4. On approval, the write executes and the model receives the write result. <!-- id:tRGkL-tu -->
  5. On cancellation, the model receives a structured tool rejection result so it can explain that the user cancelled. <!-- id:itD6JZGv -->

This avoids inventing a second “proposal” tool. The model still uses the real `write` tool, but the local runtime gates execution. <!-- id:iGrYJvJH -->

# Runtime Architecture <!-- id:-KqfbUfy -->

## Current state <!-- id:L1ycn7OZ -->

The shared registry defines `write`, but desktop chat does not currently register a local executor. <!-- id:CO42evTu -->
  - Desktop assistant tools in `frontend/apps/desktop/src/app-chat.ts` currently include: <!-- id:EzZ9H-N0 -->
    - `search` <!-- id:VXOkFEkR -->
    - `read` <!-- id:FD8zpk0y -->
    - `list_activity_feed` <!-- id:7NYaEwat -->
    - `navigate` <!-- id:f7IT9ZA9 -->
  - Agent service tools in `agents/src/api-service.ts` include: <!-- id:q6hWz3Vq -->
    - `read` <!-- id:BVIcICHJ -->
    - `list_activity_feed` <!-- id:4AAwmYmQ -->
    - `write` <!-- id:wspfFCLX -->
    - `set_session_title` <!-- id:UC7bLDxQ -->

## Proposed state <!-- id:KBlcM93t -->

Add `write` to the desktop assistant `chatTools` map in `frontend/apps/desktop/src/app-chat.ts`. <!-- id:ANThgnRR -->

The executor should: <!-- id:beHsLoWi -->
  1. validate input against the shared registry schema; <!-- id:D8pWbYki -->
  2. restrict unsupported commands; <!-- id:ZdPECfGV -->
  3. resolve the current local account/signer; <!-- id:Fn-vW941 -->
  4. check the auto-approve setting; <!-- id:bvhyFzcF -->
  5. either execute immediately or create a pending confirmation; <!-- id:b4NE-Iac -->
  6. return a structured result compatible with existing write rendering. <!-- id:mMpon3xb -->

# Initial Command Scope <!-- id:MyeZQ20E -->

Start with a deliberately small supported subset. <!-- id:yNIzb4jl -->

## `comment.create` <!-- id:k2a6nkyW -->

Priority: highest. <!-- id:VA8c9YbK -->

Required behavior: <!-- id:ATSvBNbr -->
  - target the current document when the user says “comment on this” and document context is available; <!-- id:4zNQVIoR -->
  - support explicit `input.target` HM document URLs; <!-- id:8UN2AAKq -->
  - support threaded replies through `input.replyCommentId`; <!-- id:yY7msdZ9 -->
  - include enough preview data in confirmation cards to show the exact comment body and target; <!-- id:u0iJUtGz -->
  - publish using local desktop signing/publishing infrastructure. <!-- id:vneLf8zX -->

Potential implementation path: <!-- id:oc16EY9w -->
  - reuse `createComment` from `@seed-hypermedia/client/comment` if available in the desktop bundle; <!-- id:x9OMaKcf -->
  - publish the generated blobs through the same local publish path used by existing comment UI; <!-- id:Dy7We2md -->
  - convert simple model text/markdown into HM paragraph blocks for v1. <!-- id:GnJKc4rr -->

## `document.create` <!-- id:iqKGpXUk -->

Priority: medium. <!-- id:B7ip-DP8 -->

Required behavior: <!-- id:KjKZukuf -->
  - create a document under an explicit account/path or a safe default path chosen by the UI/runtime; <!-- id:iUHIb347 -->
  - preview title, path, and content; <!-- id:1d1JDCuS -->
  - avoid overwriting existing content; <!-- id:Ks2r3pbM -->
  - require confirmation unless auto-approval is enabled. <!-- id:ULMBfAMN -->

## `document.update` <!-- id:WtkhKRxG -->

Priority: medium, but more dangerous. <!-- id:1fKJy5c7 -->

Required behavior: <!-- id:nxBm6j1a -->
  - require an explicit target document; <!-- id:j5lK7Iy0 -->
  - fetch latest document/version before writing; <!-- id:O1tMXPuu -->
  - fail safely on version conflicts; <!-- id:o4ZV09P1 -->
  - preview replacement scope clearly. <!-- id:l4lNa4n2 -->

For v1, prefer full document replacement only if the confirmation makes that obvious. Fine-grained patching should wait until there is a reliable block-level diff UX. <!-- id:Ok_xx7su -->

# Out of Scope for v1 <!-- id:OvVy8YWW -->

Do not initially expose these commands to the desktop assistant: <!-- id:Otj05e7i -->
  - capability writes; <!-- id:CJ0vNSu8 -->
  - contact writes; <!-- id:ILb3C5WJ -->
  - profile writes; <!-- id:-MFPUyY8 -->
  - document redirects/moves; <!-- id:3g57xBl2 -->
  - destructive deletes; <!-- id:qPxNy0Lr -->
  - arbitrary draft mutation unless tied to a clear draft UX. <!-- id:d3aniOZB -->

These can remain agent-service-only until there is a dedicated safety review and product flow. <!-- id:-OYimftD -->

# Safety Rules <!-- id:3uSUhBPT -->

- Default to confirmation required. <!-- id:izANj9fO -->
- Never execute a write from a hidden or ambiguous target. <!-- id:EmCArEcx -->
- Prefer exact IDs and latest versions over inferred resources. <!-- id:40OTh55E -->
- Show the user the final content and target before approval. <!-- id:F-HavxDS -->
- Return structured cancellation/rejection results to the model. <!-- id:kYmYS3hL -->
- Log metadata only; do not log full private content or signed payloads by default. <!-- id:mK0_dhDa -->
- Keep destructive commands disabled for the desktop assistant until explicitly designed. <!-- id:ioohKi_s -->

# Data and State <!-- id:R4s55W7q -->

Needed state: <!-- id:rk63A0NK -->
  - auto-approve setting; <!-- id:JCEIc7lS -->
  - pending write requests keyed by session/tool call ID; <!-- id:6uTTPdyH -->
  - approval/cancellation resolution for an in-flight tool call; <!-- id:CN-QmEf5 -->
  - persisted chat parts/results so confirmed writes render after reload. <!-- id:BoqMIMWl -->

Recommended scope: <!-- id:2RhrDKNT -->
  - store auto-approve as local desktop preference; <!-- id:Jc9Q02vK -->
  - keep pending write promises in memory only; <!-- id:FvI4Pz1g -->
  - if the app restarts with pending writes, mark them cancelled/expired. <!-- id:7BJRVryH -->

# UI Implementation Notes <!-- id:Uv0Y_H_a -->

Files likely involved: <!-- id:b4DNpN8M -->
  - `frontend/apps/desktop/src/components/assistant-panel.tsx` <!-- id:VXusRVno -->
    - add the header checkbox/toggle; <!-- id:KZ_Yiqqh -->
    - render pending write confirmation actions; <!-- id:qcQMu4lC -->
    - pass approval/cancel actions to the chat model layer. <!-- id:VZwCqvcI -->
  - `frontend/apps/desktop/src/components/assistant-message-rendering.tsx` <!-- id:yutwF2at -->
    - extend `WriteToolCallBubble` to render pending/approved/rejected write states; <!-- id:4yWKw_-n -->
    - keep generic fallback for unknown write output shapes. <!-- id:q6nUrYWc -->
  - `frontend/apps/desktop/src/app-chat.ts` <!-- id:2NKAZ065 -->
    - register desktop `write` tool; <!-- id:dTSJbLtA -->
    - implement confirmation-gated executor; <!-- id:6D158zzE -->
    - implement supported local write commands. <!-- id:SoBVZYA4 -->
  - `frontend/apps/desktop/src/models/chat.ts` <!-- id:tSCKectb -->
    - subscribe to pending-write events; <!-- id:GW3wT8DP -->
    - expose approve/cancel mutations or IPC calls. <!-- id:GgBp4SKV -->

The confirmation card should be compact but explicit. It should show what will change, not just the raw JSON args. <!-- id:H6eInHDr -->

# Tool Result Shape <!-- id:d5QgEEd8 -->

Use existing write result conventions where possible: <!-- id:PUdgpps8 -->

```ts <!-- id:wMUuhP2W -->
type DesktopWriteResult = {
  type: 'hypermedia_write_result'
  command: string
  signer?: {
    publicKey?: string
    profileName?: string
  }
  result: Record<string, unknown>
}
```

For user rejection: <!-- id:aPkSmeGK -->

```ts <!-- id:iIpP-xXa -->
type DesktopWriteRejected = {
  type: 'hypermedia_write_error'
  command: string
  message: 'User rejected write request'
  details?: {
    reason: 'cancelled' | 'expired'
  }
}
```

Pending state can be represented in chat rendering metadata rather than returned to the model, because the model should only receive the final approved/rejected result. <!-- id:RdT1Rq9r -->

# Open Questions <!-- id:OMa3fePk -->

1. Should auto-approve be global, per account, or per chat session? <!-- id:1PGPOOB1 -->
2. Should auto-approve allow all supported writes or only non-destructive writes like `comment.create`? <!-- id:AnR4y97d -->
3. Should document writes always require confirmation even when auto-approve is enabled? <!-- id:dOjJVlJU -->
4. What is the preferred local API for publishing generated comment/document blobs from the main process? <!-- id:sraU-vxI -->
5. Should the assistant be allowed to write to private/local-only documents? <!-- id:HxehF8nK -->
6. Should markdown conversion support only paragraphs in v1, or a richer subset? <!-- id:W6C1qEnA -->

# Suggested Milestones <!-- id:8gq-xtkC -->

## Milestone 1: Confirmation infrastructure <!-- id:Op_c-GoN -->

- Add assistant header toggle. <!-- id:YXjs2a63 -->
- Add pending write event plumbing. <!-- id:lTrioEV8 -->
- Add inline approval/cancel card. <!-- id:WOI0zCrY -->
- Add tests for pending, approved, cancelled rendering. <!-- id:nlRF7_yO -->

## Milestone 2: `comment.create` <!-- id:cpiHMnZ0 -->

- Add local desktop `write` tool executor for `comment.create` only. <!-- id:2NWf96QZ -->
- Resolve current account/signer. <!-- id:HAid0QK0 -->
- Convert simple text to HM blocks. <!-- id:ec-cRqi_ -->
- Publish comments using existing local desktop publishing infrastructure. <!-- id:uEvkYep5 -->
- Add tests for confirmation required and auto-approved execution. <!-- id:q81gvWN6 -->

## Milestone 3: document creation/update <!-- id:D7wTIyuZ -->

- Add `document.create` with confirmation preview. <!-- id:a0kTlEgX -->
- Add guarded `document.update` with latest-version conflict checks. <!-- id:9jMBN2_u -->
- Add tests for safe failure and conflict handling. <!-- id:3agsPy6h -->

## Milestone 4: polish and hardening <!-- id:fXQZlqWr -->

- Improve previews and rendering. <!-- id:eBDv5aon -->
- Add persistence behavior for approved/rejected results. <!-- id:cI_FqJVo -->
- Add telemetry/logging with content redaction. <!-- id:3ro9sb54 -->
- Consider additional commands after safety review. <!-- id:bd97grtj -->
