---
name: What an agent is told
summary: Everything the model reads besides the conversation itself, from the system prompt and the text added on every turn to the first message of a triggered session and of a delegated child, and which of that text is not trusted.
---
An [agent](../agent.md) is a language model, and a model does what its text tells it. So to know how an agent behaves, you need to know what text it reads. This page lists every piece of text the [app environment](../software/app-environment.md) gives the model:

- the system prompt, the fixed instructions at the start of every request;
- the per-turn blocks, short pieces of tagged text added on each turn;
- the messages the server writes;
- the first message of a session that a [trigger](../trigger.md) or a parent run started.

It then ranks the text that comes from other people. The model must treat that text as data, not as instructions.

To see the result for a real session, open the **system prompt** button in the session header. It shows exactly what the server would send if the session went on at this moment. `GetSession` returns the same text as `systemPromptMarkdown`: the assembled prompt followed by the current [Space index](./space-index.md).

# The system prompt

The server builds the system prompt from these parts, in this order.

1. **The agent's instructions.** For a mounted agent this is its [document](./mounting.md): the latest published version, read at the start of each turn. The blocks other than [card embeds](../block/embed-view.md) are the instructions, with embedded documents inlined. An agent whose document has no instructions, or that has no document, uses the prompt stored in its definition. Any writer of the agent's document can change what the agent is told.
2. **A note about that document**, for a mounted agent: its id and version, the server the agent runs on, and a list of what the agent made under it (its tools, pages, triggers and apps, with their `hm://` URLs).
3. **The write scope**, for a mounted agent: where its keys may publish in the space of its document. See [what the agent can write](./mounting.md).
4. **The shared Seed instructions**, the same for every agent: the kinds of Hypermedia resource, how to format [`hm://` links](../protocol/urls.md), the rule that a block link must quote an exact block id, how to read a [profile](../profile.md), attributes and the activity feed, how to explore a directory before its children, and where the knowledge base is. <!-- id:56_qVS9y -->
5. **The memory prompt.** It is always included, because memory is a [read](./read.md) and [write](./write.md) address and belongs to no tool group. It describes `~/memory/`, the habit of checking memory first, whole-file rewrites, downloads from a URL, `read ipfs://`, `write ipfs://`, and that chat attachments are private to the session and read with `read attachment:<id>`. <!-- id:g-QiS7CE -->
6. **The model choice**, only when the owner enabled more than one model: which models a delegated child may be given.
7. **The delegation paragraph**: where this run sits in its tree and how far it may delegate.
8. **The user-actions prompt**: "Your user holds the same verbs you do… entries tagged `<user_action>`/`<user_action_result>` are actions the user ran themselves — read their results as shared ground truth". <!-- id:g-pL5KLj -->
9. **The session continuation instructions**: what a [session continuation](./session-continuation.md) is, that transcripts are never compacted, and when to continue.
10. **The conversation members**, only for a [shared](./sharing.md) agent: the accepted members, their roles, and their profile names.
11. **The signing identities**, only when the agent has keys: an `<available_signing_identities>` list of profile names and public keys, primary first, with the recipe for publishing a document. See [agent identity](./identity.md). <!-- id:J0uQfOR5 -->

Nothing in this prompt depends on the clock, on what the session has done, or on what is in the agent's [Space](./space.md). So the prompt stays the same from turn to turn, unless someone edits the agent's document, its members or its identities. That lets the provider's prompt cache keep working. Everything that changes often is sent as a per-turn block, described below.

## The default instructions

A new agent's document holds one [Embed](../protocol/blocks.md) block of the [Agent Guide](./guide.md), at `hm://hyper.media/agent/guide`. When the server resolves the prompt it maps `hm://hyper.media` to the knowledge base account it is configured with, and inlines the page. So anyone who can publish to the knowledge base space changes the prompt of every agent that keeps the default.

## A delegated child

A model [child](./child.md) does not start from the agent's conversation.

- Its [brief](./brief.md) becomes its first user message **word for word**. A brief that is not a string is sent as a fenced JSON block, so nothing is reworded or hidden. The brief is the interface, and the parent model writes it. <!-- id:LZnMX5Dg -->
- A persona is a role the parent model writes for a child, as the `systemPrompt` of the `delegate` call. It is added after the agent's own instructions, unless the call sets `includeAgentSystemPrompt: false`. <!-- id:66rAYyWF -->
- A typed child's `return_result` parameters are the schema the spawner declared. See [typed result](./typed-result.md). <!-- id:GyEs2UEP -->

# What each request holds

The provider receives, in order: <!-- id:HJOieZI9 -->

1. the system prompt above;
2. the session's conversation: user messages, verbs a person ran as `<user_action>` blocks, and every earlier model response and tool result exactly as it was recorded;
3. this turn's input: the newest user message, or one of the stand-ins below when there is no new message to answer (a stand-in is a short text the server writes in place of a message);
4. the per-turn blocks, right after the input.

[Durable sessions](./durable-sessions.md) explains how the conversation is kept and when it is rebuilt from the [log](./log.md).

# Per-turn blocks <!-- id:q72Nkpnm -->

A per-turn block is a short piece of text inside a tag, such as `<space>`. These blocks carry the state that changes. The server builds them once when a turn starts, sends them with every request of that turn, and never stores them: not as events in the log, and not in the session's durable store.

- **`<space>`**: the [Space index](./space-index.md), as it stands when the turn starts. <!-- id:uCVRRc7s -->
- **`<delegation_budget>`**: how many children the run may still start. <!-- id:0ivQFy1q -->
- **`<plan_state>`**: the checklist. The [plan](./plan.md) verb writes no event, so this block is how a resumed model sees the plan it published. A checklist that fully settled under an earlier run is not shown: the new turn starts with no plan, so a new request never brings back a finished list. <!-- id:CQBauD_N -->
- **`<context_usage>`**: how full the model's context was on the last turn. It is sent only where the run may [continue the session](./session-continuation.md), and the guidance in it gets stronger at 70% and at 85%. <!-- id:1zQfJ6Uj -->
- **`<session_status>`**: the session's current title and description, so a `status` call is a deliberate change and never a restatement. <!-- id:tDWRsJox -->
- **`<current_time>`**: the time the turn started. <!-- id:9MNLj56N -->
- **`<user_time>`**: the same moment in the user's time zone, when the server knows it, so "8:00" and "tonight" mean what the user means.

One exception: when a reader takes a turn in a session that used the browser or [private memory](./memory.md#private-memory), the turn does not get the owner's plan or status text.

Three more blocks are attached to a message:

- **`<window_context>`**: what was on the person's screen, appended to the message it came with. It is kept out of the message's own content, so transcripts stay clean. See [The Assistant and window context](./assistant.md). <!-- id:PVCZPZJK -->
- **`<attachments>`**: the name, type, size and id of each attached file, never the bytes. Its guidance uses the verbs: `read attachment:<id>` to see an image or read a text file, `write ~/memory/<path>` to keep one across sessions, and `write ipfs://` to publish one. <!-- id:kugrsi3z -->
- **`<message_sender>`**: in a shared agent, the account that sent each message.

Two stand-ins take the place of an input when nobody said anything new. They are stored in the durable conversation and never in the log:

- **`<background_work_update>`**: a [parked](./park.md) run resumed because its children finished. Their results are already in place, and the block tells the model to act on them. <!-- id:FGgHfyDO -->
- **`<turn_resumed>`**: a turn resumed after a restart.

The rule behind the split: a per-turn block is for current state, and a durable event is for a record of something that happened.

# Messages the server writes <!-- id:Y3dUZh04 -->

These are real events in the [log](./log.md) with the [actor](./actor.md) `system`, so they are part of the record: <!-- id:oK0tadif -->

- the **obligation reminder**, which lists everything a turn still owes when it tries to end (see [obligations](./obligations.md)); <!-- id:bBmYlE_Q -->
- the **unmet-obligations notice**, written when the run has used all its reminders; <!-- id:HSV_XHMi -->
- the **projection** that opens a successor session after [`continue_session`](./session-continuation.md).

# A triggered session <!-- id:MTzbxedf -->

The first user message of a session that a [trigger](../trigger.md) started carries three things: the trigger's prompt as resolved markdown, a `<trigger_context>` JSON block with the trigger, the [firing](./firing.md) and the activity, and a `<trigger_instructions>` block. The instructions tell the agent to reply as a threaded [comment](../protocol/comments.md) with the write verb, and say where in the context to find the target [document](../protocol/documents.md) and the comment to reply to.

This is not a system prompt. It is prompt text built from activity that other people wrote. <!-- id:CDpgBhXZ -->

# Tool contracts <!-- id:5Saehe2I -->

A tool's description and the descriptions in its input schema are instructions to the model too. For the five verbs they are long: the [delegate](./delegate.md) description alone carries the rules for parallel work and the whole `ctx` surface of a script. [Contracts](./contract.md) also reach the model while it works, through `read ~/tools/<name>` and through the contract a wrong [call](./call.md) returns. <!-- id:mbfTk_xI -->

The [`execute`](./code-execution.md) contract lists only the runtimes the server can run. The model is never told about an ability that would fail. <!-- id:yl4AZkFa -->

A remote [MCP](./mcp.md) tool's summary appears in the Space index, and its description reaches the model in full when the tool is expanded or [promoted](./promotion.md). That text is written by whoever runs the remote server.

Naming a session is a separate model call with its own fixed prompt and no tools. See [session](./session.md).

# Untrusted text that reaches the model <!-- id:drzedXzu -->

The list goes from the most exposed to the least. Everything here is content that someone else wrote. <!-- id:u6Ry-9e7 -->

1. **Fetched web pages** (`read https://…`, `web_search` results). This is the largest surface. A page the agent reads itself gets no escaping. It arrives as a tool result, which the model already treats as data. <!-- id:zLBbXLNy -->
2. **Hypermedia content and comments** (`read hm://…`, the activity feed, trigger context). Other [accounts](../protocol/identity.md) write this. Triggered sessions are the sharpest case: the triggering comment is text an attacker controls, and it arrives in the session's first message next to instructions. <!-- id:OEICJZZ2 -->
3. **User-action payloads and results**: a person's `read` of a hostile page is replayed inside `<user_action_result>`. <!-- id:4qduL1sq -->
4. **Plan step labels**: written by the model and replayed inside `<plan_state>`. <!-- id:BpBoTI3_ -->
5. **Child results**: these come back to the parent as tool-result data, checked against the schema when typed. A child that was misled can corrupt only its own return value. <!-- id:6yjp38rK -->
6. **Tool descriptions from MCP servers**, as said above.
7. **Attachment file names**: shown in the `<attachments>` block without escaping. <!-- id:u5VCsmtV -->

## Escaping framed text <!-- id:VRRmTIj5 -->

Some of that text is handed back to the model inside tags whose syntax the model knows. Wherever that happens, every `<` in the text is rewritten as its unicode escape. The escape stays valid inside JSON and still shows as `<` to a human reader, but it can never form a tag.

- **`<user_action>` and `<user_action_result>`**: the user's own verb calls and their results, including fetched web content. Without escaping, a page containing `</user_action_result>` could close the frame and forge trusted user actions for everything after it. <!-- id:OdKHUfbu -->
- **`<plan_state>`**: step ids and labels are whatever the model last wrote, so a label carrying `</plan_state>` would otherwise turn the rest of the block into instructions nothing vouched for. <!-- id:n36-MmI1 -->
- **Excerpts in a continuation projection**: lines of an earlier transcript, quoted into the successor session.

A tool result that answers a call a person made is never replayed to the provider as a tool result of the model's own.

# See also <!-- id:wZczVOGe -->

- [Agent Guide](./guide.md)
- [Security model](./security.md) <!-- id:Tsezei1t -->
- [Space index](./space-index.md) <!-- id:K6DQ9Nwp -->
- [Durable sessions](./durable-sessions.md)
- [Tools](./tools.md) <!-- id:lqU__Oh- -->
- [Triggers](./triggers.md) <!-- id:LyfyPD6R -->
- [Session continuation](./session-continuation.md) <!-- id:bGFaHwPs -->
- [Agents are documents](./mounting.md)
