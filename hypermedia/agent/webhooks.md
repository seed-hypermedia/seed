---
name: Webhooks
summary: A webhook trigger fires when a sender POSTs JSON to its delivery URL with the trigger's secret, and the posted body reaches the tool or session the trigger starts.
---
A webhook is one of the [sources](./triggers.md) of a [trigger](../trigger.md). It lets something outside Hypermedia, such as a form service, a build system or a payment provider, start a tool call or an agent session by sending an HTTP request. This page covers the delivery URL, the secret, the responses, deduplication, and how the posted body reaches the action.

# Delivering

The HTTP server delivers **webhooks** synchronously. A request to `POST /hm/api/agents/webhooks/<triggerId>/<secret>`, or to `POST /hm/api/agents/webhooks/<triggerId>` with `Authorization: Bearer <secret>`, with a JSON body answers `202 {accepted, duplicate}`. The body must be `application/json` with no content encoding (anything else is 415) and under the webhook body cap. The secret is 43 URL-safe characters. It is generated with the trigger and shown on its page to accounts that can edit the agent. The client builds the delivery URL from the server's base. <!-- id:30W5TAHJ -->

The same two routes also answer under `/hm/api/apps/webhooks/…`. The secret rides in the URL because many senders can only POST to a URL they are given; a sender that can set headers can keep it out of the URL with the `Authorization` form.

| Response | Meaning |
| --- | --- |
| `202` | accepted; `duplicate` is true when the delivery repeats an earlier one |
| `400` | the body is not valid JSON, or the `Idempotency-Key` is malformed |
| `401` | wrong secret, or the trigger is missing, disabled or not a webhook |
| `409` | the `Idempotency-Key` was already used with a different body |
| `413` | the body is over the cap of 64 KiB |
| `415` | the content type is not `application/json`, or the body has a content encoding |

# The secret

The server creates the secret when a trigger becomes a webhook trigger, and keeps it across edits. The secret is never in the trigger document: the server stores it encrypted, with a hash for checking deliveries. It is shown to accounts that can edit the host: `GetAgentTrigger` returns `webhookSecret` to editors of the agent, and `ListHostTriggers` returns it to writers of the host's space. An agent that reads its own webhook trigger at `~/triggers/<name>` gets the delivery URL.

A trigger cannot change between a webhook source and any other source, so the way to get a new secret is a new trigger.

# Deduplication

A delivery's [firing](./firing.md) key is `webhook:<Idempotency-Key>` when the sender supplies the header. A repeated delivery with the same key and the same body is answered as a duplicate and does not fire again; the same key with a different body is refused with 409. Without the header every delivery is new. The key is 1 to 128 characters: letters, digits, `.`, `_`, `:` and `-`, starting with a letter or digit.

# Using the posted body

The event of a webhook firing carries the posted JSON as `payload`. In a trigger's input template, the string `"$event.payload"` is replaced by it, and `"$event.payload.<path>"` by one value inside it.

- A trigger document that names a `tool` calls that tool with the template as input. The call needs no model.
- A trigger that starts a session shows the event to the model in its `<trigger_context>` block.

A common pattern: an agent publishes a [tool](../tool.md) under its own document and wires a webhook to it with `continuation: {kind: 'tool', tool, input: {payload: '$event.payload'}, onFailure: 'thread'}`. From then on, deliveries run its code directly. A model starts only when the code fails. <!-- id:7kDY3C-p -->

Webhook triggers need no polling. They do keep the [activity monitor](./triggers.md) polling for their account, like any enabled trigger that is not a schedule.

# See also

- [Trigger reference](./triggers.md) for the other sources and the continuations.
- [Trigger](../trigger.md) for the concept.
- [Firing](./firing.md) for how deliveries are recorded.
- [Signed API](../build/signed-api.md) for `GetAgentTrigger` and `ListHostTriggers`.
- [Security](./security.md) for the standing authority a trigger holds.
