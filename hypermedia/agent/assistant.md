---
name: The Assistant and window context
summary: The built-in Assistant is an ordinary agent that the desktop app creates on its local server, and the assistant panel tells the agent you talk to what is on your screen.
---
The assistant panel is the column of the [Seed app](../software/desktop.md) where you chat with an [agent](../agent.md) beside what you are reading. Two things about it need explaining. One is the agent called **Assistant**, which appears there without anyone creating it. The other is the **window context**: what is on your screen, which the panel sends with each message. The panel's layout is described in [Agents in the Seed app](./in-the-app.md).

# The built-in Assistant

The **Assistant** is an ordinary agent. The desktop app creates it on the app's own local server when three things are true:

- the local server runs agents: the app is attached to a development server, or the **Local app environment** switch is on with **Agents** checked under it;
- a [model provider](./model-providers.md) exists there;
- your [account](../protocol/identity.md) has no agent there yet.

What is special about it:

- The app creates it with a fixed key that makes a repeat harmless. Two windows that start at the same moment create one Assistant, not two. An Assistant that was deleted is not created again.
- Its only [callable](./callables.md) [grant](./grants.md) is `search`.
- It has no [signing identity](./identity.md), so it cannot publish.

No separate chat system stands behind it. The panel is a client of the [app environment](../software/app-environment.md) like every other screen, and it builds no system prompt of its own.

# Window context

Every time you send a message from the panel, the panel adds what is on your screen at that moment: the current URL, the title, the view, the open side panel, the open [comment](../protocol/comments.md), the focused [block](../protocol/blocks.md) and text range, and whether you are in a draft. So when you write "this document", the model knows which [document](../protocol/documents.md) you mean. <!-- id:uVUDoO7J -->

- It travels as a `context` part of the message, separate from the text you typed.
- It is sent with every message you send from the panel. The full [session](./session.md) page does not send it.
- It never appears in the transcript. The model receives it inside a `<window_context>` tag added to that message; see [what an agent is told](./prompt.md).
- The user bubble shows a **Context** chip that opens the exact lines the model was given.

The panel's message box has the same `/` tool commands as the full session page, for people who may edit the agent. See [running a tool yourself](./wrench-palette.md).

# See also

- [Agents in the Seed app](./in-the-app.md)
- [What an agent is told](./prompt.md)
- [Grants](./grants.md)
- [Agents are documents](./mounting.md)
