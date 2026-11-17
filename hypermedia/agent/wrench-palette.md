---
name: Wrench Palette
summary: The wrench palette is the tool button in the chat composer that lets a person run read, write, and call themselves, with results landing on the shared log.
---
The **wrench palette** is the tool button in the chat composer. It lets a person run [read](./read.md), [write](./write.md), and [call](./call.md) themselves. Results land on the [log](./log.md) with a **"You" chip**, and the agent reads them as ground truth (`<user_action>` in its replay). <!-- id:OLGsxfeU -->

# The user holds the same verbs <!-- id:dwr2ygva -->

`InvokeSessionTool` (`apps/protocol/src/index.ts`) runs `read`, `write`, or `call` **as the user** on the session's shared log (`#invokeSessionTool`, `api-service.ts`). The call and its result append as actor-`user` events, so the agent reads them on its next turn exactly as it reads its own. The log is the interface. There is no side channel. In the app this is the [wrench palette](./wrench-palette.md). <!-- id:yY41iY_5 -->
  - `delegate` and `plan` are rejected. Delegation is a conversational ask, so the user messages the agent instead. <!-- id:GGnI4jWM -->
  - The request is rejected with 409 while the session has a live run. <!-- id:Pyr3dfgV -->
  - Execution failures are log entries too (a failed attempt is context) and come back in the response. Only pre-execution validation rejects the request outright. <!-- id:HXdtpBjo -->
  - On replay, user tool calls become `<user_action>` and `<user_action_result>` tagged user messages. Providers have no notion of a user-made tool call, so these are not sent as provider tool exchanges (`api-service.ts`). The system prompt tells the agent these are shared ground truth it can build on without re-running them (`api-service.ts`). <!-- id:lj8l9b0x -->

The palette's place in the composer is described on [in the app](./in-the-app.md), and the action's request and response on the [signed API](../build/signed-api.md).

# See also <!-- id:wMF9v8fi -->

- [Log](./log.md) <!-- id:_Myt05eh -->
- [Actor](./actor.md) <!-- id:o5u8FEE7 -->
- [Read](./read.md) <!-- id:2LDiPH6v -->
- [Call](./call.md) <!-- id:CJPV_GM6 -->
- [In the app](./in-the-app.md) <!-- id:hK_YEMq- -->
- [Tools](./tools.md) <!-- id:VGsVjpwW -->
