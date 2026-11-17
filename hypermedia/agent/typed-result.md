---
name: Typed Result / return_result
summary: A typed result is a child's answer that must match a schema, delivered through the return_result tool, which checks it and sends errors back to the child.
---
A **typed result** is a [child](./child.md)'s answer that must match a schema. The parent gives the schema as `output` when it calls [delegate](./delegate.md). For example, a parent can ask for `{dates: string[]}` and get exactly that shape back, not free text. <!-- id:M9d2fPXp -->

The child delivers a typed result through the `return_result` tool. The server checks it against the schema. If it does not match, the errors go back to the child so it can try again. A child started without `output` returns `{text}`.

# `return_result` <!-- id:yPsyH8z2 -->

Only a typed child has `return_result`. The tool's parameters ARE the parent's `output` schema, which the server puts in when the child's [session](./session.md) starts (`api-service.ts`). <!-- id:Ng94MMwb -->

- The server checks what the child sends. If it fails, the child gets the list of errors.
- Delivering the result ends the child's turn at once. Nothing else the child might still do is worth another turn.
- A child can retry `return_result` 3 times (`MAX_RETURN_RESULT_RETRIES`). After that it fails with error code `output-schema`.
- When a typed child's turn ends with no result delivered, the runtime hands the turn back. The child fails if it still does not deliver. See [obligations](./obligations.md).

No other run can see `return_result`. The registry holds three entries beside [the five verbs](./read.md): `status`, [`continue_session`](./session-continuation.md), and `return_result` (see [tools](./tools.md#the-registry)).

# See also <!-- id:l4MhYa6V -->

- [Child](./child.md) <!-- id:QO8iOZfJ -->
- [Delegate](./delegate.md) <!-- id:962jMyR- -->
- [Brief](./brief.md) <!-- id:YQRvRPsM -->
- [Contract](./contract.md) <!-- id:hCDPj9aQ -->
- [Obligations](./obligations.md)
- [Tools](./tools.md) <!-- id:V0OJrUjn -->
