---
name: Attachment
summary: An attachment joins a child to the plan step that was running when the child started, so the step's row leads to the child.
---
An **attachment** joins a child to a plan step. A [child](./child.md) that starts while a [step](./step.md) of a [plan](./plan.md) is running belongs to that step. In the run card, the step's row is the way into the child. <!-- id:Otwq7Wqa -->

The runtime joins them by **planStepId**, the step's stable id. For old runs that recorded no id, the run card matches by label.

Attachment is what lets the runtime settle a step. When every run attached to a running step succeeds, the runtime marks the step done. A step with several attached children is a [batch step](./batch-step.md).

This is not a file attachment. A file a person adds to a [session](./session.md) is read with the `attachment:<id>` address (see [read](./read.md#address-forms)).

# See also <!-- id:CW-JQ_Ld -->

- [Step](./step.md) <!-- id:IpezbiJA -->
- [Batch step](./batch-step.md) <!-- id:3Jd7JzcG -->
- [Child](./child.md) <!-- id:apqqXmyS -->
- [Plan](./plan.md) <!-- id:m6Ns0yIk -->
- [In the app: the run card](./in-the-app.md) <!-- id:bLkVKuq9 -->
- [Agents glossary](./glossary.md) <!-- id:7Jol_nv6 -->
