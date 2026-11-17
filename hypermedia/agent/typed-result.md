---
name: Typed Result / return_result
summary: A child spawned with an output schema must deliver its result through the return_result tool, which validates it and bounces errors back.
---
A **typed result** is a [child](./child.md)'s result that must match a schema. A child spawned by [delegate](./delegate.md) with an `output` schema must deliver its result through the `return_result` tool. The server validates it, and errors go back to the child so it can correct itself. A child spawned without `output` returns `{text}`. <!-- id:M9d2fPXp -->

# `return_result` <!-- id:yPsyH8z2 -->

Exposed only inside typed delegate children. Its declared parameters ARE the spawner's `output` schema, swapped in at session start (`api-service.ts`). The server validates the payload, and failures return the error list to the child so it can correct itself. Delivering the result ends the child's turn immediately. Nothing else it might still owe is worth another turn (`api-service.ts`). <!-- id:Ng94MMwb -->

A child has 3 `return_result` retries (`MAX_RETURN_RESULT_RETRIES`). A child that spends them fails with error code `output-schema`. A typed child whose turn ends without a delivered result is handed the turn back, and fails if it still does not deliver. See [obligations](./obligations.md).

`return_result` is hidden from every other run. It is the third entry, with `status` and `continue_session`, that the registry holds beside the five verbs (see [tools](./tools.md#the-registry)).

# See also <!-- id:l4MhYa6V -->

- [Child](./child.md) <!-- id:QO8iOZfJ -->
- [Delegate](./delegate.md) <!-- id:962jMyR- -->
- [Brief](./brief.md) <!-- id:YQRvRPsM -->
- [Contract](./contract.md) <!-- id:hCDPj9aQ -->
- [Obligations](./obligations.md)
- [Tools](./tools.md) <!-- id:V0OJrUjn -->
