Research into trigger conditions, migration, and UX — September 17, 2026.

Implementation follow-up: the activity-only approach below is now implemented in this working tree. It stores stable
conditions inside an `activity` source in the existing CBOR column, adds durable event claims and firing-context
snapshots, and provides explicit combination with preserved history. Schedules, webhooks, and completed-run sources
remain standalone. See [the signed API](../agents/docs/signed-api.md) and
[persistence documentation](../agents/docs/persistence.md) for the implemented contract. The remaining text records the
original investigation and alternatives; production configuration has not been changed.

The recommended model is one trigger with a nonempty list of alternative conditions and one shared action. A matching
event claims the trigger once, regardless of how many conditions match. The existing firing identity is already scoped
correctly for that model; the missing part is expressing multiple conditions inside its boundary.

The original research proposal examines both an activity-only first release and support for schedules, webhooks, and
completed runs. Production trigger configuration and firing logs were not inspected. The reported comment has two
replies from RI, but attributing those particular replies to particular triggers still requires production firing
records.

The investigation used current source, including existing uncommitted frontend changes, rather than treating older
design documents as authoritative. No existing working-tree changes were modified.

The current system has six source types and four action types. [The protocol](../agents/protocol/src/index.ts) calls the
action a `continuation`; its prompt is stored separately.

| Source            | How it fires                | Current identity/state                                                           |
| ----------------- | --------------------------- | -------------------------------------------------------------------------------- |
| Document comments | Account activity polling    | Comment-version CID where available; optional author filter                      |
| User mentions     | Same activity polling       | Comment and citation siblings share a firing key in the resolved feed            |
| Space updates     | Same activity polling       | Feed/blob identity, resource prefix, optional event types                        |
| Schedule          | Separate schedule monitor   | Trigger ID plus scheduled time; trigger-level creation and last-fired timestamps |
| Webhook           | Authenticated HTTP delivery | Trigger-local delivery key plus a raw-body digest                                |
| Run completed     | Run finalization callback   | Completed run ID; trigger-chain loop guard                                       |

The actions are start a thread, call a tool, run a script, and wake a waiting run. Tool/script actions can start a
recovery thread on failure. A condition-list change should preserve all of these rather than assume every firing creates
a chat.

[Storage](../agents/src/sqlite-schema.sql) currently separates `agent_triggers`, `trigger_firings`,
`webhook_trigger_credentials`, and account/server `activity_watermarks`. A trigger stores one CBOR `source`, one prompt,
an optional CBOR continuation, and aggregate timestamps. Firings retain the event, status, and links to a session or
headless run. The unique constraint is `(account_id, trigger_id, activity_key)`.

[Activity processing](../agents/src/api-service.ts) loops through enabled triggers, matches each source, and inserts a
firing before dispatch. [The monitor](../agents/src/activity-monitor.ts) polls by observation order, tracks raw feed
keys, and advances its watermark after each processed event. Its cold-start cutoff uses the earliest enabled
activity-trigger creation time for the account. The delivery cursor and the deduplication key serve different purposes
and must remain separate.

Both signed CRUD actions and the agent's `read/write ~/triggers/<name>` interface write the same rows. They share
normalization helpers but have separate persistence code. Changes must cover both. Agents can create active triggers
directly; this proposal does not introduce an activation approval step.

Several details affect the design:

- New agents with signing identities automatically receive a mention-response trigger. Adding another response trigger
  is consequently an easy way to create overlap.
- “Comment in a document” currently includes descendant document paths. Its label understates its scope.
- Mention conditions already accept multiple accounts. The protocol also supports a resource prefix that the current
  mention form does not expose.
- Space-update conditions default in the UI to document updates and comments; an empty event-type list matches any
  supported activity type.
- The frontend can summarize completed-run conditions, but its condition picker and editor do not offer them.
- A `cooldown_ms` column exists, but the current protocol and runtime do not use it. Older planning text that describes
  working cooldowns is stale.
- Agent moves recreate triggers with new IDs and do not transfer firing history. The destination agent also runs normal
  creation, including default mention-trigger creation. This path needs review for duplicate defaults as well as support
  for condition lists.

The current behavior was checked with 37 passing tests across activity matching, the real monitor/client/service race
harness, schedule matching, continuations, and SQLite migrations. An additional temporary in-memory service probe
created a document-comment trigger and a mention trigger, delivered one comment matching both, and replayed it. There
were exactly two firing records, one per trigger, with the same event key; replay produced no additional records. The
probe used wake actions with no listener, so it exercised firing admission without contacting a model or publishing
anything.

Two other probes exposed relevant limits. Setting an interval trigger's last-fired timestamp to a simulated unrelated
activity firing postponed its next occurrence. Also, raw `newMention` events with a nonempty `mentionType` do not
currently collapse to the comment key: `activityFiringKey` recognizes the `--` form but not `-c-`. Resolved
comment/citation events are covered by existing tests. The identity helper should be hardened and tested before making
the broader deduplication promise.

For the public data model, prefer a flat `conditions` array, with implicit OR semantics:

```json
{
  "name": "Respond to incoming requests",
  "enabled": true,
  "conditions": [
    {
      "id": "mentions",
      "source": {"type": "user-mention", "mentionedAccounts": ["<RI account>"]}
    },
    {
      "id": "requests",
      "source": {"type": "document-comment", "resource": "hm://<RI account>/research-desk/requests"}
    }
  ],
  "prompt": "Respond to the request and update the public work queue.",
  "continuation": {"kind": "newThread"}
}
```

IDs above are illustrative. The server assigns stable opaque IDs to new conditions; edits retain them. Reordering never
resets identity, schedule state, or endpoint credentials. Fields inside a condition keep their existing semantics: for
example, document and author filters both have to match. There are no per-condition prompts, priorities, or actions.
Separate actions remain separate triggers.

| Model option                                  | Advantage                                                                  | Limitation                                                                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Add an activity-only `any` source variant     | Smallest initial matching change; existing firing constraint works         | Every source renderer must understand the new variant; does not solve mixed-source runtime state                            |
| Store a condition list in one CBOR column     | Simple configuration reads and atomic replacement                          | Stable IDs still needed; schedules require separately managed state; SQL migrations cannot directly re-encode existing CBOR |
| Add condition rows under the existing trigger | Preserves individual source blobs, supports condition state and stable IDs | More persistence plumbing and transactional list updates                                                                    |

I favor condition rows if mixed source types are the intended destination. An activity-only `any` variant is a
reasonable deliberately limited patch, but it should not become a recursive expression language accidentally.

A possible relational shape is
`agent_trigger_conditions(id, trigger_id, position, source_cbor, created_at, last_fired_at)`, indexed by trigger. The
parent retains name, enabled state, prompt, continuation, and aggregate status. The API exposes configuration separately
from server-owned runtime state. Condition IDs must belong to the edited trigger; a replacement list cannot adopt
arbitrary IDs from another trigger. Reject empty lists and duplicate IDs, and bound the list size at input validation.

For each delivered activity or completed-run event, evaluate all applicable conditions, collect matches, and attempt one
durable firing claim for the parent. The condition ID must not appear in the activity deduplication key. Doing so would
recreate the same duplicate underneath one trigger. Keep the unique parent/event boundary and reserve the firing plus
its immediate execution record transactionally where possible. The promise is one admitted firing per identity, not
exactly-once external side effects from arbitrary model/tool execution.

Save why a firing happened: matched condition IDs and their configurations, alongside the configuration used for the
action. Currently session attribution joins a firing to the live trigger row, so editing a trigger can change how an old
session describes its cause. New firings should use a snapshot or retained configuration revision. Historical
configurations cannot be reconstructed reliably from today's rows; mark that limitation rather than fabricating a past
snapshot.

A late sibling event should find the same firing and may add observed match information, without another dispatch.
Record which conditions were known at dispatch separately from any later observations. No delay window is necessary.
Preserve the existing comment-version identity initially: an edited comment can be a new event. “Once per comment
forever” would be a separate behavior change.

Mixed sources need specific treatment:

- **Schedules:** move the clock anchor to each schedule condition. A comment must not postpone an interval or make a
  one-time schedule appear completed. Completing a one-time condition must not disable the whole trigger. Preserve
  existing cadence on migration; do not reset it to deployment time. New schedule conditions need their own creation
  time. The UI's independently calculated “next fire” must use the same condition state. Multiple schedules at the same
  timestamp require an explicit policy: coalesce exact scheduled instants, or treat each schedule occurrence separately.
  I lean toward one firing per exact scheduled instant within a trigger, with all due conditions advanced; this must be
  decided and tested, not implemented as a fuzzy time window.
- **Webhooks:** initially allow at most one webhook condition per trigger. The existing endpoint and credentials can
  remain attached to the parent, preserving integrations. Dispatch checks whether the parent has a webhook condition
  instead of requiring the whole trigger to be a webhook. Adding/removing that condition must create/revoke credentials
  transactionally. Multiple independent webhook endpoints later need condition-owned credentials and delivery-key
  namespaces; they are a separate expansion.
- **Completed runs:** match all completed-run conditions and claim once by run ID. Keep the loop guard keyed to the
  parent trigger, including runs started by any of its other conditions. Moving the guard to individual conditions would
  permit new cycles.
- **Action input:** keep the existing event payload available to scripts and templates; add match metadata alongside it.
  A webhook body and a comment are different underlying events even when their text is identical. Combining conditions
  cannot deduplicate those without an explicit shared external event ID.

The database migration and the combination of existing automations are separate operations.

For the structural migration:

1. Add the condition table and any forward-looking firing metadata columns. Update both the prepend-only migration list
   and the fresh-install baseline schema.
2. Backfill exactly one condition for every existing trigger, copying `source_cbor`, creation time, and last-fired
   state. A deterministic initial condition ID derived from the trigger ID makes this idempotent. Copying CBOR bytes is
   possible with SQL; wrapping them into a new CBOR array requires application decoding/encoding.
3. Preserve parent trigger IDs, enabled state, prompts, continuations, credentials, firing rows, event keys, sessions,
   runs, and activity watermarks. Migration alone does not combine triggers or replay events.
4. Switch every runtime reader and writer to the same authoritative condition store. The legacy parent `source_cbor` is
   currently non-nullable: a staged migration can keep a first-condition projection solely to satisfy that old column,
   but new execution must never read it. Remove it in a subsequent schema cleanup. This projection is not a valid
   downgrade of a compound rule.
5. Backfill transactionally before monitors start. Test both an old populated database and fresh initialization, plus
   restart after migration. The existing migration runner already uses a transaction and version tracking.

Retaining an old column does not make binary rollback safe. The current opener rejects databases with a migration
version newer than its binary. Plan a compatible rollback binary or restore a pre-migration backup; restoring a backup
loses post-backup changes. Never lower the version marker to force old code onto a newer schema.

For existing overlapping automations, provide a **Combine triggers** operation. It selects a surviving trigger and a
shared action, moves or copies the selected conditions into it, and retires the others atomically. It must not infer
equivalent intent from equal prompts: identical text can be used for intentionally separate jobs, and the default
mention prompt commonly differs from a custom response prompt.

Preserve original firing/session/run provenance. Today's delete helper deletes firing rows and detaches their runs, so
combine must not call it. Also, directly changing every historical firing to the survivor will violate the unique
constraint when both old triggers already fired for the same event—the precise incident motivating this work.

One clean implementation is a small `trigger_event_claims(account_id, trigger_id, event_key)` table, initially seeded
from existing firing keys. Admission claims and firing creation happen in one transaction. Combining imports the union
of both triggers' keys into the survivor, while original firing records stay with archived predecessor triggers. The
claims table becomes the single admission authority; retained firing uniqueness remains a consistency constraint.
Another option is checking the survivor's history plus archived predecessors on every admission. That needs explicit
merge lineage and careful transactional checks; it saves a table but complicates the hot path.

The combine review should say what happens to active work. Existing admitted runs continue; the merge prevents future
duplicate admissions and does not retract posted replies or cancel runs. Predecessors need a retired/merged state
distinct from ordinary disabled: generic enable APIs and stale clients must not reactivate them. History should link to
the survivor. Deleting an archived predecessor must not discard the survivor's imported deduplication claims. Claim
retention is consequently part of the merge design.

Client compatibility is a separate rollout constraint. [Protocol versioning](../agents/protocol/PROTOCOL.md) explicitly
accounts for servers deploying before desktops. The repository currently speaks version 2 and serves versions 1 and 2.
Replacing `source`, or adding a compound member to a returned source union, is breaking. Current UI code assumes
unrecognized sources are schedules in some branches; returning an unfamiliar compound source can crash it.

Do not downgrade a compound trigger by pretending its first condition is the entire rule, and do not let an old client's
edit overwrite the other conditions. A staged release should first ship condition-aware clients and safe old-server
behavior, then enable compound creation. Singleton rules can be translated exactly for older clients. Compound
operations need an explicit update-required path for old clients, or retirement of their protocol after desktop
adoption, following the existing policy. Cover session summaries and full trigger context as well as CRUD responses;
source information travels through all of them. A protocol bump alone does not provide a compatibility shim.

The UX should retain the existing agent Triggers tab and make the shared action visually explicit:

```text
Respond to incoming requests                         Enabled

When any of these happens

  @  RI is mentioned                              Edit · Remove
 OR
  ↳  A comment is posted in Research Requests      Edit · Remove

  + Add condition

If the same event matches several conditions, this trigger runs once.

Then
  Start a thread

Instructions
  Respond to the request and update the public work queue.

Recent activity
  Eric's comment · Matched: Mention, Research Requests · Open thread
```

Keep the first condition simple; reveal repeated condition cards only when needed. Use an “Add condition” menu with
event names, not a boolean-expression editor. Avoid an ANY/ALL switch in the first release: “comment AND 9 a.m.” is
temporal coordination, which the existing trigger engine does not implement. Advanced filters belong inside their
condition.

Reuse the document and account autocomplete controls and continuation editor. Replace “Trigger Session on” with “When”
and “When it fires” with “Then,” because tool/script/wake actions do not necessarily start sessions. Show
document-descendant scope explicitly without silently changing existing matching. Replace comma-separated event-type
entry with named choices while preserving unknown existing values for advanced editing. Expose mention scope. Add
completed-run fields only when that condition is supported by the editor.

On the list, use the purpose as the title and summarize the conditions and action: “Mentions of RI OR comments in
Research Requests → start a thread.” For longer lists, show a condition count with expansion. Keep the existing tokens,
layout conventions, and keyboard behavior across web and desktop. There is no need for a separate automation canvas.

On edit, retain the existing live-save model for committed configuration, but keep a newly added/incomplete condition
local until valid and explicitly added. Current details autosave sends the full source/prompt/continuation after 800 ms;
sending an empty condition immediately would repeatedly fail validation. Save the valid condition list atomically.
Removing the final condition should require replacing it or disabling/removing the trigger, rather than persisting an
empty rule.

Whole-list editing also needs a revision precondition. The current editor only initializes details when switching
triggers, while agents can edit the same configuration through verbs. A stale form can overwrite an agent's change.
Preserve local drafts, report conflicts, and reload/rebase deliberately; do not treat array order as identity. Include
loading, saving, validation, save-failure, conflict, read-only, and completed-schedule states.

Make reuse discoverable. The automatically created mention trigger can be named by its purpose, such as “Respond to
requests,” with mentions as its first condition. When adding a document-response condition, offer “Add to an existing
trigger” alongside creating a new one. Teach the agent's trigger-write contract to inspect and extend an existing
response trigger when the action is shared. Merely adding a list editor leaves the default-trigger duplication trap
intact.

Offer “Combine with another trigger” from trigger actions. Show the two existing configurations, let the user choose the
surviving name and shared instructions/action, and explain that the other trigger becomes historical. Report known
overlap as “These triggers both ran for this event” when firing records prove it; do not claim general overlap detection
is exhaustive.

History should show one firing with the matching condition badges, the original comment/document link, and the resulting
thread/run. A later sibling adds diagnostic information rather than a second visible run. Old firings should not acquire
today's condition list retroactively. Read-only users see the same explanation, while webhook secrets retain current
editor-only visibility.

The recommended delivery sequence is:

1. Settle the flat condition contract, stable IDs, event identity, and client rollout strategy. Verify raw/resolved
   event-key equivalence.
2. Migrate singleton rules in place and support multiple activity conditions, including both signed actions and agent
   verbs. Ship the condition editor, attribution, and default-trigger reuse.
3. Add the explicit combine operation with retained provenance and deduplication history. This is necessary to fix
   existing installations, including the reported configuration if production logs confirm it.
4. Enable mixed schedules, webhooks, and completed-run conditions after their state and lifecycle tests pass. These can
   ship together if full mixed-source support is required immediately; they are real work beyond replacing one field
   with an array.

Acceptance tests should cover both sibling arrival orders, separate polls, replay after restart, multiple matching
conditions, independent comments, retained independence of separate triggers, raw mention types, comment edits, and
parent/descendant overlap. Migration tests need populated history, enabled/disabled rules, an already-fired one-time
schedule, pending schedules, and preserved webhook credentials. Combine tests need duplicate historical keys, different
actions, ongoing runs, stale edits, and replay after merge. Mixed-source tests need comment-versus-schedule clock
isolation, one-time completion without disabling other conditions, webhook retries/body conflicts, and run-chain guards.
Compatibility tests must use old protocol requests and session context, not only new shared TypeScript types. Frontend
tests should exercise incomplete condition drafts, conflicts, read-only views, and accurate historical attribution.

Implementation centers on [protocol types](../agents/protocol/src/index.ts),
[API service and verb paths](../agents/src/api-service.ts), [activity matching](../agents/src/activity-triggers.ts),
[activity polling](../agents/src/activity-monitor.ts),
[schedule occurrence calculation](../agents/src/schedule-triggers.ts), [SQLite migrations](../agents/src/sqlite.ts),
[protocol compatibility](../agents/src/protocol-compat.ts),
[shared trigger fields](../frontend/packages/ui/src/agents/trigger-types.tsx),
[trigger list/detail/create UI](../frontend/packages/ui/src/agents/detail.tsx),
[client mutations](../frontend/packages/ui/src/agents/models.ts), and
[agent moves](../frontend/packages/ui/src/agents/move-agent.ts). Update the agent-visible contract and persistence/API
docs with the same model. The older proposal to turn triggers into content-addressed Space documents can remain
independent; neither it nor a generalized event bus is required for this change.
