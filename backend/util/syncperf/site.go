package syncperf

import "time"

// Stats is every time-based figure the throughput table shows, for the daemon
// as a whole or for one space.
//
// Both come from the same shape deliberately: it lets each row on the page be a
// single function applied to a Stats — the global one for the parent row, each
// site's for the children — so a child value is always computed exactly like
// its parent and the two are directly comparable.
type Stats struct {
	// Uptime is wall clock since the session started. It is the only field
	// that has no per-site meaning, so it is the same on every Stats and is
	// carried here only so ratios like duty cycle can be computed uniformly.
	Uptime time.Duration

	BusyTime       time.Duration
	SumSessionTime time.Duration
	Sessions       int64
	ActiveSessions int

	// Stage times, occupancy-weighted. See StageSnapshot for what that means.
	WeightedIdle       time.Duration
	WeightedConnecting time.Duration
	WeightedExchange   time.Duration
	WeightedTransfer   time.Duration

	// AnyTransfer is the exclusive partition's transfer time: wall clock with
	// at least one fetch open.
	AnyTransfer time.Duration
}

// DutyCycle is the fraction of wall clock spent syncing (this space, or
// anything at all for the global Stats).
func (s Stats) DutyCycle() float64 {
	if s.Uptime <= 0 {
		return 0
	}
	return s.BusyTime.Seconds() / s.Uptime.Seconds()
}

// AvgConcurrency is how many sessions ran in parallel on average while busy.
func (s Stats) AvgConcurrency() float64 {
	if s.BusyTime <= 0 {
		return 0
	}
	return s.SumSessionTime.Seconds() / s.BusyTime.Seconds()
}

// siteState mirrors the global session and stage bookkeeping for one space.
// Roughly 120 bytes; the site map is already capped, so the whole thing is
// bounded at a few megabytes.
type siteState struct {
	// Sessions.
	active       int
	busySince    time.Time
	openStartSum int64
	busyNanos    int64
	sumNanos     int64
	sessions     int64

	// Stages.
	occ      [numStages]int
	nanos    [numStages]int64
	weighted [numStages]int64
	since    time.Time
}

// siteStateLocked returns the per-space bookkeeping for site, creating it on
// first use. Sites past the cap share the overflow bucket, matching how the
// byte breakdown folds them. Caller must hold stmu.
func (t *Tracker) siteStateLocked(site string) *siteState {
	if site == "" {
		site = UnattributedSite
	}
	if t.siteStates == nil {
		t.siteStates = make(map[string]*siteState, 16)
	}
	if s, ok := t.siteStates[site]; ok {
		return s
	}
	if len(t.siteStates) >= maxBreakdownSites {
		site = OverflowSite
		if s, ok := t.siteStates[site]; ok {
			return s
		}
	}
	s := &siteState{}
	t.siteStates[site] = s
	return s
}

// sessionStart records a session opening for one space.
func (t *Tracker) sessionStart(site string, at time.Time) {
	t.stmu.Lock()
	s := t.siteStateLocked(site)
	s.active++
	s.openStartSum += at.UnixNano()
	if s.active == 1 {
		s.busySince = at
	}
	t.stmu.Unlock()
}

// sessionEnd records a session closing for one space.
func (t *Tracker) sessionEnd(site string, started, ended time.Time) {
	t.stmu.Lock()
	s := t.siteStateLocked(site)
	s.active--
	s.openStartSum -= started.UnixNano()
	s.sumNanos += ended.Sub(started).Nanoseconds()
	s.sessions++
	if s.active == 0 {
		s.busyNanos += ended.Sub(s.busySince).Nanoseconds()
	}
	t.stmu.Unlock()
}

// stageBank credits the slice elapsed since this site's last transition, then
// restarts its clock. Mirrors bankLocked, per space. Caller must hold stmu, and
// must call it BEFORE changing occupancy — see EnterStage.
func (s *siteState) stageBank(now time.Time) {
	if s.since.IsZero() {
		s.since = now
		return
	}
	dt := now.Sub(s.since).Nanoseconds()

	top := StageIdle
	var occupied int64
	for st := StageConnecting; st < numStages; st++ {
		if n := int64(s.occ[st]); n > 0 {
			occupied += n
			top = st
		}
	}
	s.nanos[top] += dt
	if occupied > 0 {
		for st := StageConnecting; st < numStages; st++ {
			if n := int64(s.occ[st]); n > 0 {
				s.weighted[st] += dt * n / occupied
			}
		}
	} else {
		s.weighted[StageIdle] += dt
	}
	s.since = now
}

// stats renders one site's state, folding in whatever intervals are still open.
func (s *siteState) stats(now time.Time, uptime time.Duration) Stats {
	out := Stats{
		Uptime:         uptime,
		Sessions:       s.sessions,
		ActiveSessions: s.active,
		BusyTime:       time.Duration(s.busyNanos),
		SumSessionTime: time.Duration(s.sumNanos),
	}
	if s.active > 0 {
		out.BusyTime += now.Sub(s.busySince)
		out.SumSessionTime += time.Duration(int64(s.active)*now.UnixNano() - s.openStartSum)
	}

	var nanos, weighted [numStages]int64
	copy(nanos[:], s.nanos[:])
	copy(weighted[:], s.weighted[:])
	if !s.since.IsZero() {
		dt := now.Sub(s.since).Nanoseconds()
		top := StageIdle
		var occupied int64
		for st := StageConnecting; st < numStages; st++ {
			if n := int64(s.occ[st]); n > 0 {
				occupied += n
				top = st
			}
		}
		nanos[top] += dt
		if occupied > 0 {
			for st := StageConnecting; st < numStages; st++ {
				if n := int64(s.occ[st]); n > 0 {
					weighted[st] += dt * n / occupied
				}
			}
		} else {
			weighted[StageIdle] += dt
		}
	}

	out.WeightedConnecting = time.Duration(weighted[StageConnecting])
	out.WeightedExchange = time.Duration(weighted[StageExchange])
	out.WeightedTransfer = time.Duration(weighted[StageTransfer])
	out.AnyTransfer = time.Duration(nanos[StageTransfer])
	// Idle is the remainder, so a site's four stage figures sum to uptime just
	// as the global ones do — "time we were not syncing this space".
	out.WeightedIdle = max(uptime-out.WeightedConnecting-out.WeightedExchange-out.WeightedTransfer, 0)
	return out
}

// SiteStats returns the time-based figures for every space that has had any
// sync activity, keyed the same way as the byte breakdown so the page can join
// them.
func (t *Tracker) SiteStats() map[string]Stats {
	now := time.Now()

	t.mu.Lock()
	uptime := now.Sub(t.start)
	t.mu.Unlock()

	t.stmu.Lock()
	out := make(map[string]Stats, len(t.siteStates))
	for site, s := range t.siteStates {
		out[site] = s.stats(now, uptime)
	}
	t.stmu.Unlock()
	return out
}

// GlobalStats is the same shape for the daemon as a whole, so the page can use
// one code path for the parent row and the children.
func (t *Tracker) GlobalStats() Stats {
	s := t.Snapshot()
	st := t.Stages()
	return Stats{
		Uptime:             s.Uptime,
		BusyTime:           s.BusyTime,
		SumSessionTime:     s.SumSessionTime,
		Sessions:           s.Sessions,
		ActiveSessions:     s.ActiveSessions,
		WeightedIdle:       st.WeightedIdle,
		WeightedConnecting: st.WeightedConnecting,
		WeightedExchange:   st.WeightedExchange,
		WeightedTransfer:   st.WeightedTransfer,
		AnyTransfer:        st.Transfer,
	}
}
