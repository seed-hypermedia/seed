---
name: Park / Wait
summary: A run parks when it pauses and holds no resources while it waits for its children, a timer or an event.
---
To **park** is to pause a [run](./runs.md) so that it holds no resources while it waits. A parked run is only a row in a table. For example, an [agent](../agent.md) hands three tasks to children and parks. It costs nothing until the children finish, and then it goes on. A [wake source](./wake-source.md) ends the wait. <!-- id:8GQNCKmk -->

A parked run has the status `waiting` and a `wait` that says why:

| Reason | The run is waiting for | Recorded with |
| --- | --- | --- |
| `children` | the children it started with [delegate](./delegate.md) | `pendingChildren` |
| `timer` | a time: a sleep, or the timeout of an event wait | `wakeAt` |
| `event` | an activity event or a signal, asked for by a script's `ctx.waitForEvent` | `label`, and `answerWith` when a person can answer it by hand |

A fourth reason, `budget-pause`, exists in the type. No run pauses on a budget, because the server never gives a run a time budget.

# Why waiting is free

The wait is a row in the [runs](./runs.md) table. It is not a process. So:

- a run can wait for days;
- a restart of the server changes nothing;
- a waiting run is never shown as finished. Its card stays pinned above the message box, where a person can answer it.

# When a model turn parks

A model turn parks when it delegates and waits for the result. The turn ends early. The server answers the `delegate` call with a placeholder, a short text that says the child is still working. The run goes on when the children are done. See [durable sessions](./durable-sessions.md).

A [script](./script.md) parks when it sleeps, waits for an event, or waits for children.

# See also <!-- id:usIPiKJ1 -->

- [Wake source](./wake-source.md) <!-- id:H9KZXwS3 -->
- [Runs](./runs.md) <!-- id:dw3Z274l -->
- [Delegate](./delegate.md) <!-- id:Qtyp7C3Q -->
- [Script and ctx](./script.md) <!-- id:vCxJ6e-4 -->
- [Journal](./journal.md) <!-- id:JaaTVcOj -->
- [Persistence: runs](../operate/persistence.md) <!-- id:m4PwUwN5 -->
