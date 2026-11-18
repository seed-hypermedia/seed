---
name: Webhooks
summary: A webhook trigger fires when a sender POSTs JSON to its delivery URL with the trigger's secret, and the posted body reaches the tool or session the trigger starts.
---
A **webhook** lets a program outside Hypermedia start a [trigger](../trigger.md) by sending an HTTP request. For example, a form service can POST each new answer to a webhook URL, and the trigger then calls a [tool](../tool.md) with that answer or starts an [agent](../agent.md) [session](./session.md).

A webhook is one of the [sources](./triggers.md) of a trigger. This page covers the delivery URL, the secret, the responses, how repeats are detected, and how the posted body reaches the action. Some rules differ between a trigger document and a trigger stored on the server. Each such rule says which form it is about.

# Delivering

The HTTP server handles a webhook at once, inside the request. There are two ways to send one: <!-- id:30W5TAHJ -->

- `POST /hm/api/apps/webhooks/<triggerId>/<secret>`
- `POST /hm/api/apps/webhooks/<triggerId>` with the header `Authorization: Bearer <secret>`

With a JSON body, the server answers `202 {accepted, duplicate}`. The body must be `application/json` with no content encoding (anything else is 415) and no larger than 64 KiB.

The secret is 43 URL-safe characters. The server makes it with the trigger. It is shown on the trigger's page to [accounts](../protocol/identity.md) that can write the host's space. The client builds the delivery URL from the server's base address.

The same two routes also answer under the older prefix `/hm/api/agents/webhooks/…`, which existing webhook URLs use. The secret can be in the URL because many senders can only POST to a URL they are given. A sender that can set headers can keep the secret out of the URL with the `Authorization` form.

| Response | Meaning |
| --- | --- |
| `202` | accepted; `duplicate` is true when the delivery repeats an earlier one |
| `400` | the body is not valid JSON, or the `Idempotency-Key` is malformed |
| `401` | wrong secret, or the trigger is missing, disabled or not a webhook |
| `409` | the `Idempotency-Key` was already used with a different body |
| `413` | the body is over the cap of 64 KiB |
| `415` | the content type is not `application/json`, or the body has a content encoding |

# The secret

The server creates the secret when a trigger becomes a webhook trigger, and keeps it across edits. The secret is never in the trigger [document](../protocol/documents.md). The server stores it encrypted, with a hash for checking deliveries.

The secret is shown to accounts that can edit the host:

- `GetAgentTrigger` returns `webhookSecret` to editors of the agent.
- `ListHostTriggers` returns it to writers of the host's space.
- An agent that reads its own webhook trigger at `~/triggers/<name>` gets the delivery URL.

How to get a new secret depends on the form of the trigger:

- A trigger stored on the server cannot change between a webhook source and any other source. So make a new trigger.
- For a trigger document, publish a version with another source, then a version with `webhook` again. The server makes a new secret.

# Deduplication

A sender can mark a delivery with an `Idempotency-Key` header, so that a repeat does not fire twice. The delivery's [firing](./firing.md) key is then `webhook:<Idempotency-Key>`.

- A repeated delivery with the same key and the same body is answered as a duplicate. It does not fire again.
- The same key with a different body is refused with 409.
- Without the header, every delivery is new.
- The key is 1 to 128 characters: letters, digits, `.`, `_`, `:` and `-`. It starts with a letter or digit.

# Using the posted body

The event of a webhook firing carries the posted JSON as `payload`. In a trigger's input template, the server replaces the string `"$event.payload"` with it, and `"$event.payload.<path>"` with one value inside it.

- A trigger document that names a `tool` calls that tool with the template as input. The call needs no model.
- A trigger that starts a session shows the event to the model in its `<trigger_context>` [block](../protocol/blocks.md).

A common pattern uses a trigger document. An agent publishes a tool under its own document. Then it publishes a trigger document beside the tool, with `options.trigger: {source: {type: 'webhook'}, tool: '<the tool's hm:// URL>', input: {payload: '$event.payload'}}`. From then on, deliveries run the tool's code directly, with no model. A failed call is recorded on the firing. A trigger document has no `onFailure`, so no session starts when the code fails. <!-- id:7kDY3C-p -->

The posted body becomes tool input, and the server records it in the tool's call record. Call records are not private, so a sender must not post secrets to such a webhook. See [tool](../tool.md).

The server does not poll for webhooks. Webhook triggers do keep the [activity monitor](./triggers.md) polling for their account, like any enabled trigger that is not a schedule.

# See also

- [Trigger reference](./triggers.md) for the other sources and the continuations.
- [Trigger](../trigger.md) for the concept.
- [Firing](./firing.md) for how deliveries are recorded.
- [The signed API for triggers](../build/signed-api-triggers.md) for `GetAgentTrigger` and `ListHostTriggers`.
- [Security](./security.md) for the standing authority a trigger holds.
