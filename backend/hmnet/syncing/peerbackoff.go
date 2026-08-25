package syncing

import (
	"math/rand/v2"
	"sync"
	"time"

	"seed/backend/blob"

	"github.com/libp2p/go-libp2p/core/peer"
)

// Peers are undifferentiated — nothing scores them — so rather than a
// reputation system this is an eligibility filter plus rotation. A peer that
// fails goes on the bench for a while; when its timer expires it rejoins the
// sampling pool on equal footing with everyone else. That sidesteps the
// cold-start problem a scoring scheme has (a new peer has no score, so it either
// never gets picked or always does) and gives exploration for free.
const (
	// backoffBase is the bench time after a single failure.
	backoffBase = 30 * time.Second

	// backoffMax caps the doubling. A peer that has been down for hours is
	// still retried every few minutes, because "down" is often our side.
	backoffMax = 10 * time.Minute

	// backoffForget drops peers untouched for this long, so the map tracks the
	// working set rather than every peer ever seen.
	backoffForget = time.Hour
)

// peerBackoff remembers which peers have been failing to dial, so waves stop
// re-dialing the dead ones every round.
//
// Deliberately in memory and not in the peers table: that table is already on
// the hot path (a point read per dial in connect.go, a full scan per discovery)
// and has no failure column — updated_at is written on success only. Losing
// this on restart is fine; it rebuilds within one round of waves.
type peerBackoff struct {
	mu    sync.Mutex
	state map[peer.ID]*backoffEntry
}

type backoffEntry struct {
	failures int
	until    time.Time
	touched  time.Time
}

func newPeerBackoff() *peerBackoff {
	return &peerBackoff{state: make(map[peer.ID]*backoffEntry)}
}

// Fail records a failed dial and extends the peer's bench time.
func (b *peerBackoff) Fail(pid peer.ID) {
	if b == nil {
		return
	}
	now := time.Now()

	b.mu.Lock()
	defer b.mu.Unlock()

	e, ok := b.state[pid]
	if !ok {
		e = &backoffEntry{}
		b.state[pid] = e
	}
	e.failures++
	e.touched = now

	// Exponential with full jitter: without it, a batch of peers that failed
	// together comes back together and re-fails together.
	e.until = now.Add(backoffBase + time.Duration(rand.Int64N(int64(backoffCeiling(e.failures)))))
}

// backoffCeiling is the upper bound on the jittered wait after n failures.
//
// This is the part that grows monotonically. The wait actually served is drawn
// uniformly from [0, ceiling) on top of backoffBase, so a later failure can and
// does draw a shorter wait than an earlier one — that is what full jitter is
// for. Only the ceiling is a property worth asserting.
func backoffCeiling(failures int) time.Duration {
	if failures < 1 {
		return backoffBase
	}
	// Cap the shift before it can overflow the duration.
	return min(backoffBase<<min(failures-1, 16), backoffMax)
}

// Succeed clears any backoff. Eligibility is the only state we keep, so there
// is no score to restore and nothing to promote.
func (b *peerBackoff) Succeed(pid peer.ID) {
	if b == nil {
		return
	}
	b.mu.Lock()
	delete(b.state, pid)
	b.mu.Unlock()
}

// Eligible reports whether the peer may be dialed now.
func (b *peerBackoff) Eligible(pid peer.ID) bool {
	if b == nil {
		return true
	}
	now := time.Now()

	b.mu.Lock()
	defer b.mu.Unlock()

	e, ok := b.state[pid]
	if !ok {
		return true
	}
	if now.Before(e.until) {
		return false
	}
	// Timer expired: forget it entirely so the peer re-enters the pool with a
	// clean slate. If it fails again it starts a fresh ladder, which is the
	// behaviour we want for peers that are intermittently reachable.
	delete(b.state, pid)
	return true
}

// Benched reports how many peers are currently sitting out, for the debug page.
func (b *peerBackoff) Benched() int {
	if b == nil {
		return 0
	}
	now := time.Now()

	b.mu.Lock()
	defer b.mu.Unlock()

	n := 0
	for pid, e := range b.state {
		switch {
		case now.Sub(e.touched) > backoffForget:
			delete(b.state, pid)
		case now.Before(e.until):
			n++
		}
	}
	return n
}

const (
	// maxSampledPeers is the speculative fan-out when we have no idea who holds
	// a scope. It used to be a floor rather than a ceiling: every connected peer
	// joined the wave uncapped, which produced 77k dials for 577 transfers.
	maxSampledPeers = 20

	// narrowSampledPeers hedges a known host — a stale siteUrl, or a server
	// that is down — without paying for a real search.
	narrowSampledPeers = 2
)

// quietWavesBeforeNarrowing is how many consecutive empty waves mark a scope as
// settled. More than one so a single unlucky wave — a peer that dropped, a
// cancelled fetch — doesn't narrow a scope that is still catching up.
const quietWavesBeforeNarrowing = 2

// maxQuietScopes bounds the tracker. Only recursive (subscription) scopes are
// recorded, so in practice this is the subscription count; the cap only exists
// so a pathological caller can't grow it without limit.
const maxQuietScopes = 10000

// scopeIsQuiet reports whether this scope's recent waves have all come back
// empty, meaning there is nothing left to search for.
func (s *Service) scopeIsQuiet(entityID blob.IRI) bool {
	s.quietMu.Lock()
	defer s.quietMu.Unlock()
	return s.quiet[entityID] >= quietWavesBeforeNarrowing
}

// recordWaveYield folds one wave's result into the quiet counter. Anything
// fetched resets it, so a scope that starts producing again immediately gets the
// full search back.
//
// Only recursive scopes accumulate quiet: a one-shot discovery never runs a
// second wave, so there is nothing for the counter to inform, and recording it
// would grow the map for no benefit. A yield resets the counter regardless of
// shape though — any wave downloading blobs for this IRI proves the scope is
// not settled, and the subscription must get its full search back.
func (s *Service) recordWaveYield(entityID blob.IRI, recursive bool, blobs int32) {
	s.quietMu.Lock()
	defer s.quietMu.Unlock()

	if blobs > 0 {
		delete(s.quiet, entityID)
		return
	}
	if !recursive {
		return
	}
	if s.quiet == nil {
		s.quiet = make(map[blob.IRI]int)
	}
	if n, ok := s.quiet[entityID]; ok {
		// Saturate rather than climb forever; only the threshold is read.
		if n < quietWavesBeforeNarrowing {
			s.quiet[entityID] = n + 1
		}
		return
	}
	if len(s.quiet) >= maxQuietScopes {
		return
	}
	s.quiet[entityID] = 1
}

// Quiet-narrowing and the tier short-circuit each assume the peers they keep
// (the authority set) advertise everything that exists. When that assumption
// breaks — a serving space whose maintained RBSR set is short, or a blob held
// only by a peer outside the authority set — both mechanisms lock the miss in:
// the narrow wave asks nobody else, and the satisfied authority tier skips the
// tiers that would have. The exhaustive wave is the bounded escape hatch: a
// rate-limited wave that runs the full speculative sample AND every peer tier,
// so any such gap heals within one interval instead of never.
const (
	// defaultExhaustiveWaveInterval is how often a settled recursive scope still
	// runs one full-width, all-tier wave. It bounds how long an
	// under-advertising authority can go undetected. Cost: one 20-peer search
	// per subscription per interval, vs. one per ~11s before narrowing existed.
	defaultExhaustiveWaveInterval = 10 * time.Minute

	// userProbeMinInterval rate-limits forced exhaustive waves per IRI, so the
	// hot-task heartbeat (fired every few seconds while a view is open) cannot
	// re-create the search load the narrowing removed.
	userProbeMinInterval = 2 * time.Minute

	// exhaustiveForget drops probe timestamps untouched for this long, so the
	// map tracks live subscriptions rather than every scope ever probed.
	exhaustiveForget = 24 * time.Hour
)

// shouldRunExhaustive reports whether the wave that is about to run must be
// exhaustive (full sample width, no tier short-circuit), consuming or arming
// the per-IRI state. Returns the trigger for metrics: "" (no), "forced" (user
// interest), or "periodic".
func (s *Service) shouldRunExhaustive(entityID blob.IRI, recursive bool, now time.Time) string {
	s.quietMu.Lock()
	defer s.quietMu.Unlock()

	if _, ok := s.forcedExhaustive[entityID]; ok {
		delete(s.forcedExhaustive, entityID)
		if s.lastExhaustive == nil {
			s.lastExhaustive = make(map[blob.IRI]time.Time)
		}
		s.lastExhaustive[entityID] = now
		return "forced"
	}
	if !recursive {
		return ""
	}

	interval := s.exhaustiveEvery
	if interval <= 0 {
		interval = defaultExhaustiveWaveInterval
	}

	last, ok := s.lastExhaustive[entityID]
	if !ok {
		// A fresh scope's first waves are naturally full-width already (nothing
		// has narrowed yet), so seed the clock instead of double-probing.
		// Jitter the seed so subscriptions bulk-loaded at startup don't all
		// come due in lockstep one interval later.
		if s.lastExhaustive == nil {
			s.lastExhaustive = make(map[blob.IRI]time.Time)
		}
		if len(s.lastExhaustive) >= maxQuietScopes {
			return ""
		}
		s.lastExhaustive[entityID] = now.Add(-rand.N(max(interval/8, 1)))
		return ""
	}
	if now.Sub(last) < interval {
		return ""
	}
	s.lastExhaustive[entityID] = now

	// Lazy GC, same idea as Benched: piggyback on a write that already holds
	// the lock instead of running a sweeper.
	for iri, ts := range s.lastExhaustive {
		if now.Sub(ts) > exhaustiveForget {
			delete(s.lastExhaustive, iri)
		}
	}
	return "periodic"
}

// noteUserInterest arms one forced exhaustive wave for the IRI, unless one ran
// within userProbeMinInterval. Called on every hot-task touch (the funnel for
// every frontend-triggered discovery); the self-rate-limiting is what makes
// that safe.
func (s *Service) noteUserInterest(entityID blob.IRI, now time.Time) {
	s.quietMu.Lock()
	defer s.quietMu.Unlock()

	if last, ok := s.lastExhaustive[entityID]; ok && now.Sub(last) < userProbeMinInterval {
		return
	}
	if s.forcedExhaustive == nil {
		s.forcedExhaustive = make(map[blob.IRI]struct{})
	}
	if len(s.forcedExhaustive) >= maxQuietScopes {
		return
	}
	s.forcedExhaustive[entityID] = struct{}{}
}

// sampleWidth decides how many peers to speculatively sample for one wave.
//
// A random sample is a SEARCH, and a search should cost in proportion to how
// lost we are. Holding the content already means there is nothing to find, so
// the wave is a liveness check and one authoritative peer answers it.
//
// The invariant that matters more than the tuning: NEVER return 0 without an
// authority to ask instead. Zero sample plus no space server plus no gateway is
// an empty peer set — a node that syncs with nobody, forever, and silently.
// Production hides this, because bootstrap guarantees gateways exist; two
// daemons paired directly with neither do not, and the sample is the only thing
// connecting them.
func sampleWidth(haveLocally, hasSpace, hasGateway bool) int {
	switch {
	case haveLocally && (hasSpace || hasGateway):
		return 0
	case hasSpace:
		return narrowSampledPeers
	default:
		return maxSampledPeers
	}
}

// samplePeers picks the peer set for one wave: everything in always (the
// authoritative sources for this scope — siteUrl servers and gateways), plus a
// random sample of eligible peers up to limit.
//
// Random rather than most-recently-active: ordering by updated_at re-picks the
// same peers every round forever, so a recently-active-but-now-failing peer
// stays permanently at the top of the list and never rotates out.
//
// Fails open — if backoff has emptied the pool, the always set is returned
// regardless, so a bad network period can't isolate the node completely.
func samplePeers(always []peer.ID, pool []peer.ID, limit int, eligible func(peer.ID) bool) []peer.ID {
	out := make([]peer.ID, 0, limit+len(always))
	seen := make(map[peer.ID]struct{}, limit+len(always))

	for _, pid := range always {
		if _, dup := seen[pid]; dup || pid == "" {
			continue
		}
		seen[pid] = struct{}{}
		out = append(out, pid)
	}

	if limit <= 0 {
		return out
	}

	candidates := make([]peer.ID, 0, len(pool))
	for _, pid := range pool {
		if _, dup := seen[pid]; dup || pid == "" {
			continue
		}
		if eligible != nil && !eligible(pid) {
			continue
		}
		candidates = append(candidates, pid)
	}

	// Partial Fisher-Yates: only shuffle as far as we need to draw.
	n := min(limit, len(candidates))
	for i := range n {
		j := i + rand.IntN(len(candidates)-i)
		candidates[i], candidates[j] = candidates[j], candidates[i]
		out = append(out, candidates[i])
	}
	return out
}
