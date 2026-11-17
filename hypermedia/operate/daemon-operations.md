---
name: Daemon operations
summary: How to diagnose a Seed daemon that is slow or uses too much memory, with the read pool, the SQLite page caches, the debug pages and the flag that caps the heap.
---
This page is for the person who runs a [daemon](../software/daemon.md), on a [site](../protocol/sites.md) or on their own machine, and finds it slow or large. It explains the two things that go wrong under load: the SQLite read pool runs out of connections, and resident memory grows far past the Go heap. For each it names the debug page to open and the setting to change. The [daemon](../software/daemon.md) page lists the flags and the routes mentioned here.

# Load and the read pool <!-- id:u-49hfsS -->

Every read RPC takes a connection from the SQLite read pool before it runs. The pool has `max(NumCPU, 12)` connections, set in [storage.go](https://github.com/seed-hypermedia/seed/blob/main/backend/storage/storage.go). A query that holds a connection for seconds removes that share of the node's read capacity for every other caller, so a call that costs microseconds of CPU can wait many seconds for a connection. <!-- id:XrIv70xu -->

When a node is pinned, measure cost per call rather than request volume:

1. Take a CPU profile from `/debug/pprof/profile?seconds=20`. It names the RPC that holds the connections.
2. Open `/debug/sqlite`. It shows the pool.
3. Count calls by method over the same window. That gives the cost of one call.

Clients must not enumerate every page of an expensive listing such as `ListCitations` for a heavily cited document. The [web app](../software/web.md) caps those at one page.

A restart only drains the backlog for a few minutes. Treat a fix as verified only after a long window of real traffic, never from the quiet minutes after a restart.

# Memory <!-- id:JGMXoiu6 -->

Most of the daemon's resident memory is C heap, not Go. Every pooled connection keeps a private SQLite page cache of up to 256 MiB (`cache_size` in [sqlite.go](https://github.com/seed-hypermedia/seed/blob/main/backend/storage/sqlite.go)), and the same budget bounds the in-memory sort buffer of each running ORDER BY or GROUP BY. SQLite frees that memory promptly: in WAL mode a reader drops its whole cache when it starts a read after a commit, and a sort buffer goes with its statement. <!-- id:Ulhs26Dc -->

glibc does not pass the freed chunks back to the kernel, though. It keeps them in the arena they came from and only trims the top of each heap, and because cgo calls run on whichever thread is free the chunks spread over dozens of arenas, so the process ratchets up to the sum of every arena's peak. On Linux the daemon therefore calls `malloc_trim(0)` once a minute, which releases whole free pages from every arena and touches nothing still in use.

Two debug pages show where the memory is:

- `/debug/sqlite` shows SQLite's heap, its peak and every connection's page cache with hit and miss counts.
- `/debug/malloc` shows the resident set, glibc's totals, the trim record and the per-arena report.

`-storage.sqlite-soft-heap-limit` caps the live total: above it page caches recycle their oldest pages instead of growing. These pages are for the case of a daemon killed for lack of memory at many gigabytes resident while its Go heap is under 1 GB.

All `/debug/*` pages share the daemon's ordinary API admission policy.

# See also

- [The Seed daemon](../software/daemon.md), for the flags, the listeners and the `/debug` routes.
- [Self-hosting](./self-hosting.md), for the containers a site runs.
- [The web app](../software/web.md), for the caches and caps that protect the daemon from page rendering.
- [Network](../protocol/network.md), for the sync timeouts and constants.
