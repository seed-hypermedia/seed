package syncing

import (
	"math/rand/v2"
	"sync"
	"time"

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
	d := min(backoffBase<<min(e.failures-1, 16), backoffMax)
	e.until = now.Add(backoffBase + time.Duration(rand.Int64N(int64(d))))
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

// sampleWidth decides how many peers to speculatively sample for one wave.
//
// A random sample is a SEARCH, and a search should cost in proportion to how
// lost we are. Holding the content already means there is nothing to find, so
// the wave is a liveness check and one authoritative peer answers it.
//
// The invariant that matters more than the tuning: NEVER return 0 without an
// authority to ask instead. Zero sample plus no site server plus no gateway is
// an empty peer set — a node that syncs with nobody, forever, and silently.
// Production hides this, because bootstrap guarantees gateways exist; two
// daemons paired directly with neither do not, and the sample is the only thing
// connecting them.
func sampleWidth(haveLocally, hasSite, hasGateway bool) int {
	switch {
	case haveLocally && (hasSite || hasGateway):
		return 0
	case hasSite:
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
