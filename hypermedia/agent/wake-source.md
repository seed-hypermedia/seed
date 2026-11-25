---
name: Wake Source
summary: A wake source is whatever ends a park, which is children finishing, a timer, a signal or an activity event.
---
A **wake source** is whatever ends a [park](./park.md), so that the waiting [run](./runs.md) goes on. It is one of: [children](./child.md) finishing, a timer, a `SignalRun`, or an activity event. A `SignalRun` is sent by the **Answer** button on the run card, or by a [trigger](../trigger.md) whose firing wakes a run. See the [signed API](../build/signed-api.md) for `SignalRun`. <!-- id:_M5QUcYg -->

| Park reason | What wakes the run |
| --- | --- |
| `children` | the last pending child finishes |
| `timer` | the time comes; one sweep puts every waiting run whose time has passed back in the queue |
| `event` | a matching activity event, a `SignalRun`, or a trigger whose firing wakes a run |

The type also has a **Resume** action for a run paused on a budget. No run pauses on a budget, so nothing uses it.

# After the wake

A woken run goes back to the queue and is claimed like any other run. A model turn can wake with no new message to answer. The server then tells it that its background work finished. See [what an agent is told](./prompt.md).

Cancelling is not waking. `CancelRun` ends a waiting run and every run under it, and they never wake.

# See also <!-- id:KSDHCX05 -->

- [Park and wait](./park.md) <!-- id:rlIHwaGf -->
- [Runs](./runs.md) <!-- id:1L8I35HP -->
- [Triggers](./triggers.md)
- [Signed API](../build/signed-api.md) <!-- id:K97DL8wb -->
- [The run card](./in-the-app.md) <!-- id:VMdMTEy3 -->
