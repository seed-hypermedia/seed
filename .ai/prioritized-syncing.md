---
name: Prioritized Content and Peer Syncing
summary: Two-tier scheduler that prioritizes user-initiated syncs over background subscriptions with preemption and demotion
---

# Problem

When a user opens a document in the desktop app, the daemon needs to sync it from the network. These on-demand ("hot") sync tasks compete for worker slots with background subscription syncs ("cold" tasks) that run periodically.

The prior scheduler had several issues:

- Hot and cold tasks shared a single FIFO queue — users waited behind background subscriptions.
- A persistent-worker model with a buffered channel hid saturation from the dispatch loop, preventing preemption.
- Unbounded goroutine fan-out per peer sync caused resource spikes.
- No per-task cancellation — busy workers couldn't be reclaimed.
- Peers contacted in arbitrary order, wasting time on unreachable nodes.

# Solution

## Two-tier priority queue

Single heap with two tiers: hot tasks (LIFO by heartbeat deadline) always dispatch before cold tasks (FIFO by next run time). Expired hot tasks are lazily demoted or dropped during dispatch.

## Preemption

Each task gets a cancellation context. When the pool is full and a hot task arrives: first, cancel a running subscription; if all workers are hot, demote the oldest one (cancel + re-enqueue for incremental resume).

## Heartbeat lifecycle

The frontend refreshes a task's heartbeat via periodic DiscoverEntity polling (40s TTL, 20s refresh). When polling stops, the heartbeat expires and the scheduler cancels the task and reclaims the slot.

## Direct dispatch

Replaced persistent-worker pool + buffered channel with errgroup.TryGo — saturation is unambiguous, enabling the preemption logic above.

## Peer sync

- Bounded per-task peer concurrency to 50 (was unbounded).
- Gateway-first ordering — sync with well-connected peers before the long tail.
- 10s dial timeout to fail fast on unreachable nodes.
- MaxWorkers reduced from 16 to 4.
- Follow-up tuning: MaxWorkers raised 4 → 6 (UI-driven bursts of ~9 hot tasks were saturating the pool on document open), and per-task peer window narrowed 50 → 20 (sliding window + gateway-first already rotated peers on completion/failure, so a tighter window trims overlapping RBSR+bitswap fan-out). Net system-wide bound: 6 × 20 = 120 concurrent peer syncs (down from 4 × 50 = 200).
