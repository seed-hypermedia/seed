# Prompt injection map

This document lists the places where Seed agent and assistant prompt text is defined, assembled, or passed into model
providers. Use it when changing assistant behavior so the hosted Agents runtime and the desktop local assistant do not
drift accidentally.

## Hosted Agents service

### Shared assistant instructions

File: `agents/protocol/src/index.ts`

- `seedAssistantSystemPrompt()` contains shared Seed assistant instructions intended for both hosted agent sessions and
  the desktop local assistant.
- These instructions cover Seed/HM behavior, profile/account reads, Markdown links, pasted Markdown link handling, and
  the hidden session-title tool instruction when requested by options.

### Agent-specific system prompt assembly

File: `agents/src/api-service.ts`

- `Service.#agentSystemPrompt()` builds the final hosted-agent system prompt used for a session.
- It combines:
  1. the user-configured agent prompt from `AgentDefinition.systemPrompt`, stored as Seed blocks and converted to
     resolved Markdown;
  2. `seedAssistantSystemPrompt({includeTitleToolInstruction: true})`;
  3. optional `<available_signing_identities>` JSON plus signing instructions when the agent has selected signing keys.
- `GetSession` returns this generated prompt as `systemPromptMarkdown` for UI inspection.

### Pi SDK prompt injection boundary

File: `agents/src/api-service.ts`

- `createSeedPiResourceLoader(systemPrompt)` injects the assembled hosted-agent prompt into Pi via `getSystemPrompt()`.
- The same loader intentionally disables Pi discovery prompt sources:
  - `getAgentsFiles()` returns none;
  - `getPrompts()` returns none;
  - `getAppendSystemPrompt()` returns an empty array;
  - skills/extensions/themes are also empty.
- This keeps hosted Agents from implicitly loading local/global Pi `AGENTS.md`, prompt templates, skills, or extensions.

### Trigger-created sessions

File: `agents/src/api-service.ts`

- `triggerPromptMessage()` creates the initial user message for trigger-created sessions.
- It injects:
  - the trigger prompt converted to resolved Markdown;
  - a `<trigger_context>` JSON block containing trigger/firing/activity details;
  - a `<trigger_instructions>` block for behavior such as threaded comment replies.
- This is not a system prompt, but it is model-facing prompt text and should be reviewed with system-prompt changes.

### Tool descriptions

File: `agents/protocol/src/tool-registry.ts`

- Tool `description` and JSON-schema field descriptions are model-facing instructions.
- The registry is shared by hosted Agents and the desktop local assistant where runtimes overlap.
- Keep `read`, `search`, `list_activity_feed`, `write`, and `set_session_title` descriptions aligned with the shared
  assistant prompt.

## Desktop local assistant

### Local assistant system prompt

File: `frontend/apps/desktop/src/app-chat.ts`

- The desktop local assistant builds a system prompt in `sendMessage`.
- It includes the base Seed assistant behavior and optional `## Current window` context derived from the active desktop
  route/document/comment/draft.
- Desired direction: use `seedAssistantSystemPrompt()` from `@seed-hypermedia/agents-protocol` for the shared base text,
  then append only desktop-specific current-window context locally.

### Provider request options

File: `frontend/apps/desktop/src/chat-provider-options.ts`

- This file does not define prompt text, but it decides how the system prompt is sent to providers.
- OpenAI login/Codex-style providers receive it as `instructions`.
- Standard providers receive it as `system`.

## Agent creation defaults and UI inspection

### Default new-agent prompt

File: `frontend/apps/desktop/src/pages/agents/dialogs.tsx`

- New hosted agents currently default to `You are a helpful agent.`.
- This is user-editable and becomes `AgentDefinition.systemPrompt`.

### Agent prompt editing

File: `frontend/apps/desktop/src/pages/agents/detail.tsx`

- The Prompt tab edits `AgentDefinition.systemPrompt` using Seed block editing.
- Saved prompt blocks are converted/normalized by the hosted Agents API before use.

### Current system prompt dialog

File: `frontend/apps/desktop/src/pages/agents/session.tsx`

- The session header can display `systemPromptMarkdown` returned by `GetSession`.
- This is the best UI path for inspecting the exact hosted-agent prompt that would be used to continue a session.

## Protocol/docs references

- Protocol prompt-bearing fields: `agents/protocol/src/index.ts`
  - `AgentDefinition.systemPrompt`
  - `AgentPromptBlock`
  - `GetSessionResponse.systemPromptMarkdown`
  - trigger prompt types
- API semantics: `agents/docs/signed-api.md`
- Tool prompt behavior: `agents/docs/tools.md`
- Pi runtime boundary: `agents/docs/pi-sdk-migration.md`
- Provider behavior: `agents/docs/model-providers.md`

## Change checklist

When changing model-facing prompt behavior:

1. Update shared instructions first when behavior should apply to both assistant systems.
2. Keep hosted-agent assembly in `Service.#agentSystemPrompt()` minimal and predictable.
3. Keep desktop-only current-window context in `frontend/apps/desktop/src/app-chat.ts`.
4. Update tool descriptions in `agents/protocol/src/tool-registry.ts` when the behavior depends on tool use.
5. Inspect a live hosted session via `GetSession.systemPromptMarkdown` or the session UI dialog.
6. Update this document if a prompt source is added, removed, or moved.
