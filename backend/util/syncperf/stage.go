package syncperf

import "time"

// Stage is how far a piece of sync work has actually got. Session-level "busy"
// is too generous a denominator for throughput: it starts counting the moment a
// discovery begins, so a daemon spending most of its time on failed dials
// reports a duty cycle near 100% while moving almost no data.
//
// Splitting busy time into stages fixes that. Each stage is strictly more
// productive than the one below it:
//
//	StageConnecting  dialing peers, walking the DHT — necessary, but nothing has
//	                 been learned yet, and a failed dial produces nothing at all
//	StageExchange    RBSR reconcile: trading haves and wants. Productive even if
//	                 it concludes we need nothing — that IS the answer
//	StageTransfer    bitswap fetch and persist: bytes actually moving
type Stage int

const (
	StageIdle Stage = iota
	StageConnecting
	StageExchange
	StageTransfer
	numStages
)

// String is the Prometheus label and page row name for a stage.
func (s Stage) String() string {
	switch s {
	case StageConnecting:
		return "connecting"
	case StageExchange:
		return "exchange"
	case StageTransfer:
		return "transfer"
	default:
		return "idle"
	}
}

// EnterStage marks one unit of sync work — a single peer-sync, not a whole
// discovery session — as having reached stage s, and returns the func that
// leaves it. Idempotent, so `defer leave()` is always safe.
//
// Each call adjusts the occupancy that both partitions are computed from; see
// StageSnapshot.
// site is the space this unit of work is syncing, used to break the stage
// figures down per space. Empty is fine — those land under the unattributed
// bucket.
func (t *Tracker) EnterStage(s Stage, site string) (leave func()) {
	if s <= StageIdle || s >= numStages {
		return func() {}
	}

	// Bank BEFORE mutating occupancy: the slice that just elapsed belongs to
	// whoever was running during it, not to the unit arriving now. Getting this
	// backwards credits every idle gap to the stage that ended it, which makes
	// weighted idle collapse toward zero.
	enter := time.Now()
	t.smu.Lock()
	t.bankLocked(enter)
	t.stageOccupancy[s]++
	t.smu.Unlock()

	t.stmu.Lock()
	ss := t.siteStateLocked(site)
	ss.stageBank(enter)
	ss.occ[s]++
	t.stmu.Unlock()

	var done bool
	return func() {
		if done {
			return
		}
		done = true
		now := time.Now()

		t.smu.Lock()
		t.bankLocked(now)
		t.stageOccupancy[s]--
		t.smu.Unlock()

		t.stmu.Lock()
		ss := t.siteStateLocked(site)
		ss.stageBank(now)
		ss.occ[s]--
		t.stmu.Unlock()
	}
}

// bankLocked credits the slice elapsed since stageSince against both
// partitions, using the occupancy that held during that slice, then restarts
// the clock. Caller must hold smu and must call this BEFORE changing occupancy.
//
// It runs on every occupancy change, not just when the top stage changes,
// because the weighted partition integrates occupancy over time.
func (t *Tracker) bankLocked(now time.Time) {
	if !t.stageSince.IsZero() {
		dt := now.Sub(t.stageSince).Nanoseconds()
		top, occupied := t.topStageLocked(), t.occupiedLocked()

		// Exclusive partition: the slice goes entirely to whichever stage was
		// on top.
		t.stageNanos[top] += dt

		// Weighted partition: the slice is split across stages in proportion to
		// how many units occupied each. See StageSnapshot for why both exist.
		if occupied > 0 {
			for s := StageConnecting; s < numStages; s++ {
				if n := int64(t.stageOccupancy[s]); n > 0 {
					t.stageWeighted[s] += dt * n / occupied
				}
			}
		} else {
			t.stageWeighted[StageIdle] += dt
		}
	}

	t.stageSince = now
}

func (t *Tracker) occupiedLocked() int64 {
	var n int64
	for s := StageConnecting; s < numStages; s++ {
		n += int64(t.stageOccupancy[s])
	}
	return n
}

func (t *Tracker) topStageLocked() Stage {
	for s := numStages - 1; s > StageIdle; s-- {
		if t.stageOccupancy[s] > 0 {
			return s
		}
	}
	return StageIdle
}

// StageSnapshot carries two different partitions of the same wall clock.
//
// Dozens of peer-syncs run at once, each in its own stage, so "which stage is
// the daemon in?" has no single answer. These are the two useful ways to force
// one, and they differ enormously in practice.
//
// The EXCLUSIVE partition (Idle/Connecting/Exchange/Transfer) gives each
// instant entirely to the highest stage anyone occupies. It answers "was
// anything transferring right now?". Under fan-out it degenerates: with a few
// fetches always open, Transfer takes ~100% of the clock and the lower stages
// read zero however much dialing is really happening.
//
// The WEIGHTED partition splits each instant across stages in proportion to
// how many peer-syncs occupy each — that is what it is weighted on. If at some
// moment 8 peer-syncs are dialing and 2 are fetching, that second contributes
// 0.8s to Connecting and 0.2s to Transfer, where the exclusive partition would
// hand the whole second to Transfer. This keeps discriminating at any
// concurrency, so it is the one to read as "where does the time actually go".
//
// Idle is in both for symmetry and is identical in each: when nobody is
// working there is nothing to weight, so the instant goes to Idle either way.
// WeightedIdle == Idle is therefore an invariant worth checking — it is what
// caught an early bug where idle gaps were credited to the stage that ended
// them. Both partitions sum to Uptime.
type StageSnapshot struct {
	Uptime     time.Duration
	Idle       time.Duration
	Connecting time.Duration
	Exchange   time.Duration
	Transfer   time.Duration

	WeightedIdle       time.Duration
	WeightedConnecting time.Duration
	WeightedExchange   time.Duration
	WeightedTransfer   time.Duration

	Bytes int64
}

// Stages returns both stage partitions, including the interval still open.
func (t *Tracker) Stages() StageSnapshot {
	now := time.Now()

	t.smu.Lock()
	var nanos, weighted [numStages]int64
	copy(nanos[:], t.stageNanos[:])
	copy(weighted[:], t.stageWeighted[:])
	// Fold in the open interval so a page loaded mid-transfer reports it.
	if !t.stageSince.IsZero() {
		dt := now.Sub(t.stageSince).Nanoseconds()
		nanos[t.topStageLocked()] += dt
		occupied := t.occupiedLocked()
		if occupied > 0 {
			for s := StageConnecting; s < numStages; s++ {
				if n := int64(t.stageOccupancy[s]); n > 0 {
					weighted[s] += dt * n / occupied
				}
			}
		} else {
			weighted[StageIdle] += dt
		}
	}
	t.smu.Unlock()

	out := StageSnapshot{
		Connecting:         time.Duration(nanos[StageConnecting]),
		Exchange:           time.Duration(nanos[StageExchange]),
		Transfer:           time.Duration(nanos[StageTransfer]),
		WeightedConnecting: time.Duration(weighted[StageConnecting]),
		WeightedExchange:   time.Duration(weighted[StageExchange]),
		WeightedTransfer:   time.Duration(weighted[StageTransfer]),
	}

	t.mu.Lock()
	out.Uptime = now.Sub(t.start)
	t.mu.Unlock()

	out.Bytes = t.bytes.Load()

	// Idle is the remainder in both partitions rather than its own accumulator,
	// so each is guaranteed to sum to uptime even across a SetSessionStart move.
	out.Idle = max(out.Uptime-out.Connecting-out.Exchange-out.Transfer, 0)
	out.WeightedIdle = max(out.Uptime-out.WeightedConnecting-out.WeightedExchange-out.WeightedTransfer, 0)
	return out
}

// Share is a stage's fraction of uptime.
func (s StageSnapshot) Share(d time.Duration) float64 {
	if s.Uptime <= 0 {
		return 0
	}
	return d.Seconds() / s.Uptime.Seconds()
}
