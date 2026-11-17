---
name: Park / Wait
summary: A run parks when it pauses without holding resources, waiting on children, a timer, an event, or a person to lift a budget pause.
---
**park / wait**: a [run](./runs.md) pauses and holds no resources while it waits. The wait reasons are **children**, **timer**, **event**, and **budget-pause**. A [wake source](./wake-source.md) ends the wait. <!-- id:8GQNCKmk -->

A parked run has the status `waiting` and a `wait` that says why:

| Reason | The run is waiting for | Recorded with |
| --- | --- | --- |
| `children` | the children it spawned with [delegate](./delegate.md) | `pendingChildren` |
| `timer` | a time: a sleep, or the timeout of an event wait | `wakeAt` |
| `event` | an activity event or a signal, asked for by a script's `ctx.waitForEvent` | `answerWith`, the signal a person can send |
| `budget-pause` | a person, because the run stopped rather than spend more | |

Parking is what makes waiting free. A run can wait for days, and a restart of the server changes nothing, because the wait is a row in the [runs](./runs.md) table and not a process. A waiting run is never shown as finished: its card stays pinned above the composer, where the person can answer it.

A model turn parks when it delegates and waits for the result. The turn ends early, the call is answered with a placeholder, and the run resumes when the children are done. See [durable sessions](./durable-sessions.md).

# See also <!-- id:usIPiKJ1 -->

- [Wake source](./wake-source.md) <!-- id:H9KZXwS3 -->
- [Runs](./runs.md) <!-- id:dw3Z274l -->
- [Delegate](./delegate.md) <!-- id:Qtyp7C3Q -->
- [Script and ctx](./script.md) <!-- id:vCxJ6e-4 -->
- [Journal](./journal.md) <!-- id:JaaTVcOj -->
- [Persistence: runs](../operate/persistence.md) <!-- id:m4PwUwN5 -->
