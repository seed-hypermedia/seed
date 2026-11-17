---
name: Batch Step
summary: A batch step is one running plan step that owns a whole group of children working at the same time.
---
A **batch step** is one [step](./step.md) of a [plan](./plan.md) that owns a whole group of [children](./child.md) working at the same time. For example, a step "Summarize the ten documents" can own ten children, one per [document](../protocol/documents.md). The run card shows every child of the group as an equal row under that step. <!-- id:kTVStD6R -->

A batch forms when one reply makes several [delegate](./delegate.md) calls while a step is running. The calls run at the same time, and each child is [attached](./attachment.md) to that step. The runtime marks the step done when every child in the batch succeeds.

# See also <!-- id:mza1aaBz -->

- [Step](./step.md) <!-- id:hqKHWMPy -->
- [Attachment](./attachment.md) <!-- id:QljDYUAz -->
- [Delegate](./delegate.md) <!-- id:TIP-cDLY -->
- [Child](./child.md) <!-- id:2aNP7BGZ -->
- [In the app: the run card](./in-the-app.md) <!-- id:xRAzqdEK -->
- [Agents glossary](./glossary.md) <!-- id:9AIupsKx -->
