---
name: The Assistant and window context
summary: The built-in Assistant is an ordinary agent that the desktop app creates on its local server, and the assistant panel tells whichever agent you talk to what is on your screen.
---
The assistant panel is the column of the Seed app where you chat with an [agent](../agent.md) beside what you are reading. Two things about it need explaining: the agent called **Assistant** that appears there without anyone creating it, and the **window context** the panel sends with a message. The panel's layout is described in [Agents in the Seed app](./in-the-app.md).

# The built-in Assistant

The **Assistant** is an ordinary agent. The desktop app creates it on the app's own local server, once a [model provider](./model-providers.md) exists there and the local server is in use: the app is attached to a development server, or the **Local app environment** switch is on.

- It is created with a fixed idempotency key. Two windows that race on first launch create one Assistant, not two, and an Assistant that was deleted is not created again.
- Its only callable [grant](./grants.md) is `search`.
- It has no [signing identity](./identity.md), so it cannot publish.

There is no separate chat runtime behind it. The panel is a client of the [app environment](../software/app-environment.md) like every other screen, and it builds no system prompt of its own.

# Window context

When you send the first message of a chat from the panel, the panel adds what is on your screen: the current URL, the title, the view, the open side panel, the open [comment](../protocol/comments.md), the focused [block](../protocol/blocks.md) and text range, and whether you are in a draft. With it, "this document" means something to the model. <!-- id:uVUDoO7J -->

- It travels as a `context` part of the message, separate from the text you typed.
- It is sent with the first message only.
- It never appears in the transcript. The model receives it inside a `<window_context>` block added to that message; see [what an agent is told](./prompt.md).
- The user bubble shows a **Context** chip that opens the exact lines the model was given.

The panel does not have the [wrench palette](./wrench-palette.md). The full session page does.

# See also

- [Agents in the Seed app](./in-the-app.md)
- [What an agent is told](./prompt.md)
- [Grants](./grants.md)
- [Agents are documents](./mounting.md)
