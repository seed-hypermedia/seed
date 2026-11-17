---
name: Wake Source
summary: "A wake source is whatever ends a park: children finishing, a timer, a signal, an activity event, or a person resuming a budget pause."
---
**wake source**: whatever ends a [park](./park.md). It is one of: [children](./child.md) finishing, a timer, a **SignalRun** (the card's **Answer** button sends the run's `answerWith` signal), an activity event, or a person pressing **Resume** on a budget pause. [Triggers](./triggers.md) can also wake a run. See the [signed API](../build/signed-api.md) for `SignalRun`. <!-- id:_M5QUcYg -->

| Park reason | What wakes the run |
| --- | --- |
| `children` | the last pending child finishes |
| `timer` | the time comes; one sweep requeues every waiting run whose time has passed |
| `event` | a matching activity event, a `SignalRun`, or a trigger whose firing wakes a run |
| `budget-pause` | a person presses **Resume** |

A woken run goes back to the queue and is claimed like any other. A model turn that wakes with no new message to answer is told that its background work finished; see [what an agent is told](./prompt.md).

Cancelling is not waking: `CancelRun` ends a waiting run and its whole subtree, and they never wake.

# See also <!-- id:KSDHCX05 -->

- [Park and wait](./park.md) <!-- id:rlIHwaGf -->
- [Runs](./runs.md) <!-- id:1L8I35HP -->
- [Triggers](./triggers.md)
- [Signed API](../build/signed-api.md) <!-- id:K97DL8wb -->
- [The run card](./in-the-app.md) <!-- id:VMdMTEy3 -->
