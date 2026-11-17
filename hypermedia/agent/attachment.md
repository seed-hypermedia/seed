---
name: Attachment
summary: A child spawned while a plan step is running is attached to that step, so the step row is the way into the child.
---
An **attachment** joins a child to a plan step. A [child](./child.md) spawned while a [plan](./plan.md) [step](./step.md) is running belongs to that step, and the step row in the run card is the way into the child. The runtime joins them by **planStepId**, the step's stable id, and falls back to the label when a run recorded no id. <!-- id:Otwq7Wqa -->

Attachment is what lets the runtime settle a step: when every run attached to a running step succeeds, the step is marked done. A step with several attached children is a [batch step](./batch-step.md).

This is not a file attachment. A file a person adds to a session is read with the `attachment:<id>` address (see [read](./read.md#address-forms)).

# See also <!-- id:CW-JQ_Ld -->

- [Step](./step.md) <!-- id:IpezbiJA -->
- [Batch step](./batch-step.md) <!-- id:3Jd7JzcG -->
- [Child](./child.md) <!-- id:apqqXmyS -->
- [Plan](./plan.md) <!-- id:m6Ns0yIk -->
- [In the app: the run card](./in-the-app.md) <!-- id:bLkVKuq9 -->
- [Agents glossary](./glossary.md) <!-- id:7Jol_nv6 -->
