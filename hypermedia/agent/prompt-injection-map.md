---
name: Prompt Injection Map
summary: A map of every place model-facing text is written, assembled, or sent to a provider, for anyone changing agent behaviour or reviewing where untrusted text reaches the model.
---
This page lists every place model-facing text is defined, assembled, or handed to a provider. Use it when you change agent behavior, and when you review anything that puts untrusted content in front of the model. <!-- id:aKrz9t71 -->

"Injection" has two senses here. The first is what _we_ inject: the system prompt and ephemeral blocks. The second is what _others_ could inject: fetched pages, [comments](../protocol/comments.md), [child](./child.md) results, and model-authored tool descriptions. Because of the second list, every framed block that carries foreign text is escaped. <!-- id:YfjVwUy_ -->

# What we inject <!-- id:rLfZntdz -->

## Shared assistant instructions <!-- id:f8iaAGxd -->

File: `agents/protocol/src/index.ts` <!-- id:lqdhE1St -->
  - `seedAssistantSystemPrompt({currentTime?, contextLines?})` (line 14) holds the shared Seed instructions: HM resource types, [hm:// link](../protocol/urls.md) formatting, the exact-block-ID rule, [profile](../protocol/identity.md) and `:profile` reads, `:attributes`, reading the activity feed with `read activity:`, and directory-then-children exploration. <!-- id:56_qVS9y -->
  - It takes no tool-specific options. There is no title-tool instruction. A separate model call generates session titles, and the agent holds no tool for it. <!-- id:_fKTuXFj -->

## Agent system prompt assembly <!-- id:w4IWxXTE -->

File: `agents/src/api-service.ts`, `Service.#agentSystemPrompt()` (line 4169). In order: <!-- id:JwABxkZY -->
  1. the user-configured `AgentDefinition.systemPrompt`, stored as Seed [blocks](../protocol/blocks.md) and converted to resolved markdown; <!-- id:iORcX3ZN -->
  2. `seedAssistantSystemPrompt({currentTime})`; <!-- id:z67VE1ZB -->
  3. the **memory prompt** (line 4184). It is always included, because memory is a [read](./read.md) and [write](./write.md) address and belongs to no tool group. It describes `~/memory/`, the check-memory-first habit, whole-file rewrites, `{fromUrl}` downloads, `read ipfs://`, `write ipfs://` publishing, and that chat attachments are session-private and read with `read attachment:<id>`; <!-- id:g-QiS7CE -->
  4. the **user-actions prompt** (line 4190): "Your user holds the same verbs you do… entries tagged `<user_action>`/`<user_action_result>` are actions the user ran themselves — read their results as shared ground truth"; <!-- id:g-pL5KLj -->
  5. the **`<space>` index** (see below), present whenever the call passes a `stateDir`, which agent runs always do; <!-- id:1rTVcDpS -->
  6. `<available_signing_identities>` JSON plus signing and publishing instructions, only when the agent has signing keys. This includes the publish recipe and the parent-must-exist rule. <!-- id:J0uQfOR5 -->

`GetSession` returns the fully assembled prompt as `systemPromptMarkdown` (line 5042) for UI inspection. That dialog is the ground truth for what the agent is being told. <!-- id:l7U_jM_4 -->

## The Space index <!-- id:DTNSen_I -->

File: `agents/src/api-service.ts`, `buildSpaceIndex()` (line 5900). <!-- id:xgw7pHEV -->

Every system prompt has a `<space>` block, the [Space index](./space-index.md). It has one line per enabled [tool document](./tool-document.md) (`- name — summary`, with authored tools tagged `(authored)`), a one-line summary of the memory top level, and the names of active [triggers](./triggers.md). It is cached per `(account, agent, callable set)`, invalidated on memory and tool writes, and collapsed to counts above 2048 bytes. <!-- id:KVIlLiaC -->

For review, this matters: **an agent's own authored tool text lands in its prompt.** A lambda's `summary` reaches the system prompt through this index. Its `description` (bounded at 16 KiB) reaches the model in full whenever the tool is expanded or [promoted](./promotion.md). Both are model-authored text that comes back as instruction-shaped context. This is intended, because the agent configures itself. It is also the one prompt source the agent writes. <!-- id:pdHXZ5PB -->

## Ephemeral per-turn blocks <!-- id:q72Nkpnm -->

None of these are stored as events. They exist only in the replay handed to Pi. <!-- id:ttTlHN0y -->
  - **`<plan_state>`**: `planStateBlock()` (line 414), appended as the last user message of every turn. The [plan](./plan.md) verb writes no transcript event, so this block is how a resumed model sees the checklist it published. [Step](./step.md) ids and labels pass through `escapeActionFraming()`. A checklist that fully settled under an earlier run is not injected. The new turn retires it to the run that owned it (`#retireSettledSessionPlan`) and starts with no plan, so a new request never brings back a finished list. <!-- id:CQBauD_N -->
  - **`<background_work_update>`** (line 4431): pushed when a [park](./park.md)-resume leaves the replay ending on an assistant message, which Pi cannot continue from. It tells the model its children finished and to act on their results. <!-- id:FGgHfyDO -->
  - **`<window_context>`** (line 4914): the desktop's current window. It arrives as `context` content parts and is formatted by `formatWindowContextLines()` (`frontend/apps/desktop/src/components/assistant-window-context.ts:39`). It stays out of the durable message `content`, so transcripts stay clean. <!-- id:PVCZPZJK -->
  - **`<attachments>`**: `formatAttachmentMetadata()` (line 5970) lists name, MIME type, size, and id for each attached file, and never the bytes. Its guidance uses the verbs: `read attachment:<id>` to see an image or read a text file, `write ~/memory/<path>` with `{fromAttachment}` to keep one across sessions, and `write ipfs://` with `{fromAttachment}` to publish one. It ends with "Only read what you need." Until `21a492a51` it named the deleted `view_attachment`, `attachment_to_memory`, and `attachment_to_ipfs` tools. This section exists to catch that kind of drift. <!-- id:kugrsi3z -->

## Durable system messages <!-- id:Y3dUZh04 -->

These are written as real events with `actor: 'system'` (see [actor](./actor.md)), so they are part of the [log](./log.md) record. They are not per-turn nudges: <!-- id:oK0tadif -->
  - `continuationPrompt()` (line 447): every open obligation at once, when a turn ends still owing something; <!-- id:bBmYlE_Q -->
  - `unmetObligationsNotice()` (line 457): the closing notice when the continuation budget is spent. <!-- id:HSV_XHMi -->

## Trigger-created sessions <!-- id:MTzbxedf -->

File: `agents/src/api-service.ts`, `triggerPromptMessage()` (line 6138). The first user message of a triggered session carries three things. The first is the [trigger](./trigger.md) prompt as resolved markdown. The second is a `<trigger_context>` JSON block with trigger, [firing](./firing.md), and activity details. The third is a `<trigger_instructions>` block. It tells the agent to reply as a **threaded** comment with the write verb, and names where in the context to find the target [document](../protocol/documents.md) id and `replyTo`. <!-- id:9jZ_eqB1 -->

This is not a system prompt. It is model-facing prompt text built from **activity that other people wrote**, so review it together with system-prompt changes. <!-- id:CDpgBhXZ -->

## Delegated children <!-- id:7qyhMts2 -->

- A model child's [brief](./brief.md) becomes its first user message **word for word** (`renderSubSessionInput()`, line 360). Non-strings fall back to a bare fenced JSON block, so nothing is reworded or hidden. The brief is the interface, and the parent model writes it. <!-- id:LZnMX5Dg -->
- `spec.prompt` replaces the child's system prompt entirely (line 2622). It is an anonymous worker persona that the parent model writes. <!-- id:66rAYyWF -->
- A typed child's `return_result` parameters are the schema the spawner declared, swapped in at session start (line 7938). See [typed result](./typed-result.md). <!-- id:GyEs2UEP -->

## Tool contracts <!-- id:5Saehe2I -->

File: `agents/protocol/src/tool-registry.ts` <!-- id:RtGb7Fu6 -->

A tool's `description` and its JSON-schema field descriptions are model-facing instructions. For the five verbs they are long. The [delegate](./delegate.md) description alone carries the parallelism rules and the whole `ctx` surface. The registry is shared with the desktop assistant runtime where the runtimes overlap. [Contracts](./contract.md) also reach the model at runtime through `read ~/tools/<name>` and through touch-expand misses on [call](./call.md). <!-- id:mbfTk_xI -->

`contractMarkdownForThisServer()` (line 7641) narrows the `execute` contract to the runtimes this server can run. The model is never told about a capability that would fail. <!-- id:yl4AZkFa -->

## Session titling <!-- id:IDOvpmOx -->

`#generateSessionTitle()` (line 2966) runs one small model call with no tools. It has its own fixed system prompt ("You are a session-titling assistant…") and reads a digest of the conversation. It uses the shared provider runtime, so subscription-auth [providers](./model-providers.md) produce titles correctly. <!-- id:zLmA7Mag -->

## Pi boundary <!-- id:Hb4MK5dx -->

`createSeedPiResourceLoader(systemPrompt)` (line 6852) injects the assembled prompt through `getSystemPrompt()` and turns off every Pi discovery source. `getAgentsFiles()` returns none, `getPrompts()` returns none, `getAppendSystemPrompt()` returns an empty array, and skills, extensions, and themes are empty. With `noTools: 'builtin'`, this stops hosted Agents from loading a local `AGENTS.md`, prompt templates, skills, extensions, or Pi's own host tools. <!-- id:uzPGFAv_ -->

# What others could inject <!-- id:drzedXzu -->

Ranked by exposure. Everything here is untrusted content that reaches the model. <!-- id:u6Ry-9e7 -->
  1. **Fetched web pages** (`read https://…`, `web_search` results). This is the largest surface. A page the agent reads itself gets no escaping. It arrives as a tool result, which the model already treats as data. <!-- id:zLBbXLNy -->
  2. **Hypermedia content and comments** (`read hm://…`, activity feed, trigger context). Other [accounts](../protocol/identity.md) write this. Trigger sessions are the sharpest case: the triggering comment is attacker-controlled text, and it arrives in the session's _first_ message next to instructions. <!-- id:OEICJZZ2 -->
  3. **User-action payloads and results**: a user's `read` of a hostile page replays inside `<user_action_result>`. `escapeActionFraming()` (line 9179) escapes it. Content that could close the frame would forge a trusted user action for everything after it. <!-- id:4qduL1sq -->
  4. **Plan step labels**: written by the model and replayed inside `<plan_state>`. Same escape, same reason. <!-- id:BpBoTI3_ -->
  5. **Child results**: these come back to the parent as tool-result data, validated against the schema when typed. A prompt-injected child can corrupt only its own return value. <!-- id:6yjp38rK -->
  6. **Authored tool descriptions**: see the Space index section above. <!-- id:q9c-trgm -->
  7. **Attachment file names**: rendered into the `<attachments>` block without escaping. <!-- id:u5VCsmtV -->

# App surfaces <!-- id:vMAEIwUn -->

- **Assistant panel** (`frontend/packages/ui/src/agents/assistant-panel.tsx`, shared by the [Seed app](../apps/desktop.md) and the [Seed web app](../apps/web.md)) is a client of the [agents service](../apps/agents.md). It builds no system prompt of its own. It adds window context as `context` content parts on the first message. The old `app-chat.ts` / `chat-provider-options.ts` local-assistant prompt path is gone. See [desktop UI](./desktop-ui.md). <!-- id:B_kzpqgq -->
- **Default new-agent prompt**: a single [Embed](../protocol/blocks.md) block of the shared skill document (`hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/skill`, published at https://seed.hyper.media/resources/skill). See `defaultAgentSystemPrompt` in `frontend/packages/ui/src/agents/dialogs.tsx`. The user can edit it, and it becomes `AgentDefinition.systemPrompt`. The service inlines the embedded document when it resolves the prompt, so anyone who can edit that document shapes every new agent's prompt. <!-- id:Xsbs2TBc -->
- **Prompt tab** (`frontend/packages/ui/src/agents/detail.tsx`) edits those blocks with the Seed block editor. The server normalizes them and resolves them to markdown before use. <!-- id:DkIerr6J -->
- **System prompt dialog** (`frontend/packages/ui/src/agents/session.tsx`) shows `systemPromptMarkdown`, the exact prompt that would be used to continue the session. <!-- id:zUoF2iV9 -->

# Change checklist <!-- id:kIr2R1vA -->

1. Update shared instructions first when behavior should apply everywhere. <!-- id:VOK56HfI -->
2. Keep `#agentSystemPrompt()` assembly small and ordered. Every block you add costs context on every turn. <!-- id:UDqqI0c9 -->
3. Use an ephemeral per-turn block for a reminder of current state. Use a durable event for a record of something that happened. <!-- id:sSf6minb -->
4. If a new block frames text written by anyone but us, escape it and add it to the untrusted list above. <!-- id:kiJ8l6rA -->
5. Update tool descriptions in `agents/protocol/src/tool-registry.ts` when behavior depends on tool use. <!-- id:PjDSTL-L -->
6. Inspect a live session through `GetSession.systemPromptMarkdown` or the session UI dialog. <!-- id:Owoth1sD -->
7. Update this page if a prompt source is added, removed, or moved. <!-- id:-jQUo6Jc -->

# See also <!-- id:wZczVOGe -->

- [Tools](./tools.md) <!-- id:lqU__Oh- -->
- [Security](./security.md) <!-- id:Tsezei1t -->
- [Space index](./space-index.md) <!-- id:K6DQ9Nwp -->
- [Triggers](./triggers.md) <!-- id:LyfyPD6R -->
- [Session continuation](./session-continuation.md) <!-- id:bGFaHwPs -->
- [Model providers](./model-providers.md) <!-- id:Yg_ewJjT -->
- [Signed API](./signed-api.md) <!-- id:roRkWXLX -->
