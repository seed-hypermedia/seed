---
name: Batch Step
summary: A batch step is one running plan step that owns a whole parallel batch of children.
---
A **batch step** is one running [plan](./plan.md) [step](./step.md) that owns a whole parallel batch of [children](./child.md). The run card shows every child in the batch as an equal row under that step. <!-- id:kTVStD6R -->

A batch forms when one reply makes several [delegate](./delegate.md) calls while a step is running: they run at the same time, and each child is [attached](./attachment.md) to that step. The runtime marks the step done when every child in the batch succeeds.

# See also <!-- id:mza1aaBz -->

- [Step](./step.md) <!-- id:hqKHWMPy -->
- [Attachment](./attachment.md) <!-- id:QljDYUAz -->
- [Delegate](./delegate.md) <!-- id:TIP-cDLY -->
- [Child](./child.md) <!-- id:2aNP7BGZ -->
- [In the app: the run card](./in-the-app.md) <!-- id:xRAzqdEK -->
- [Agents glossary](./glossary.md) <!-- id:9AIupsKx -->
