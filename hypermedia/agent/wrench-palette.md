---
name: Running a Tool Yourself
summary: A person holds the same verbs the agent does, and can run read, write and call from the slash menu of the chat composer, with the results saved on the shared log.
---
A person holds the same verbs the [agent](../agent.md) does. You can run [read](./read.md), [write](./write.md) and [call](./call.md) yourself, in the same conversation. In the chat composer, type `/` and pick a tool under **Run a tool**. A form opens above the input. For example, you can read a [document](../protocol/documents.md) yourself, and the agent then works from what you read. <!-- id:OLGsxfeU -->

The result lands on the [log](./log.md) with a **You** chip. The agent reads it as fact (`<user_action>` in its replay).

# The user holds the same verbs <!-- id:dwr2ygva -->

`InvokeSessionTool` (`apps/protocol/src/index.ts`) runs `read`, `write`, or `call` **as the user** on the shared log of the [session](./session.md) (`#invokeSessionTool`, `api-service.ts`). The call and its result are added as events with actor `user`. So the agent reads them on its next turn exactly as it reads its own. The log is the interface. There is no side channel. <!-- id:yY41iY_5 -->
  - [`delegate`](./delegate.md) and [`plan`](./plan.md) are refused. To delegate, a person asks the agent in a message. <!-- id:GGnI4jWM -->
  - `browser` is refused here. It only works in a run the owner started.
  - The request is refused with 409 while the session has a live run. <!-- id:Pyr3dfgV -->
  - A tool that fails while it runs is a log entry too, because a failed try is useful context. The failure also comes back in the response. Only a request that fails its checks before it runs is refused outright. <!-- id:HXdtpBjo -->
  - On replay, the user's tool calls become user messages tagged `<user_action>` and `<user_action_result>`. [Model providers](./model-providers.md) have no idea of a tool call made by a user, so these are not sent as provider tool calls (`api-service.ts`). The [system prompt](./prompt.md) tells the agent that these are shared facts it can build on without running them again. <!-- id:lj8l9b0x -->

Where the commands sit in the composer is described on [in the app](./in-the-app.md). The request and response of the action are on the [signed API](../build/signed-api.md).

# See also <!-- id:wMF9v8fi -->

- [Log](./log.md) <!-- id:_Myt05eh -->
- [Actor](./actor.md) <!-- id:o5u8FEE7 -->
- [Read](./read.md) <!-- id:2LDiPH6v -->
- [Call](./call.md) <!-- id:CJPV_GM6 -->
- [In the app](./in-the-app.md) <!-- id:hK_YEMq- -->
- [Tools](./tools.md) <!-- id:VGsVjpwW -->
