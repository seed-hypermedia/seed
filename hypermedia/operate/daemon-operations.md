---
name: Daemon operations
summary: This page shows how to find out why a Seed daemon is slow or uses too much memory, with the read pool, the SQLite page caches, the debug pages and the flag that limits the heap.
---
The [daemon](../software/daemon.md) is the program that stores, indexes and [syncs](../protocol/network.md) Seed content. This page is for the person who runs one, on a [site](../protocol/sites.md) or on their own machine, and finds it slow or large.

The first thing to check is the daemon's `/debug/sqlite` page, on its HTTP port. It shows both things that go wrong under load: the SQLite read pool has no free connection, or the memory in use is far larger than the Go heap. This page explains each, names the debug page to open and the setting to change. The [daemon](../software/daemon.md) page lists the flags and the routes named here.

# Load and the read pool <!-- id:u-49hfsS -->

Every read request takes a connection from the SQLite read pool before it runs. The pool has `max(NumCPU, 12)` connections, set in [storage.go](https://github.com/seed-hypermedia/seed/blob/main/backend/storage/storage.go). A query that holds a connection for seconds takes that share of the node's read capacity away from every other caller. So a call that needs only microseconds of CPU can wait many seconds for a connection. <!-- id:XrIv70xu -->

When a node is at its limit, measure the cost of one call, not the number of requests:

1. Take a CPU profile from `/debug/pprof/profile?seconds=20`. It names the request that holds the connections.
2. Open `/debug/sqlite`. It shows the pool.
3. Count the calls of each method over the same time. Together these give the cost of one call.

A client must not read every page of an expensive listing, such as `ListCitations` for a [document](../protocol/documents.md) that many others cite. The [web app](../software/web.md) reads only one page of those.

A restart only clears the waiting requests for a few minutes. Call a fix proven only after a long period of real traffic, never after the quiet minutes that follow a restart.

# Memory <!-- id:JGMXoiu6 -->

Most of the memory the daemon uses is C heap, not Go heap. Every connection in the pool keeps its own SQLite page cache of up to 256 MiB (`cache_size` in [sqlite.go](https://github.com/seed-hypermedia/seed/blob/main/backend/storage/sqlite.go)). The same limit applies to the in-memory sort buffer of each running ORDER BY or GROUP BY. SQLite frees that memory quickly: in WAL mode a reader drops its whole cache when it starts a read after a commit, and a sort buffer goes away with its statement. <!-- id:Ulhs26Dc -->

The problem is what happens next. glibc, the C library, does not give the freed memory back to the kernel:

- It keeps freed pieces in the arena they came from, and only trims the top of each heap.
- Calls into C run on whichever thread is free, so the pieces spread over dozens of arenas.
- So the process grows to the sum of the highest point of every arena.

On Linux the daemon therefore calls `malloc_trim(0)` once a minute. That gives whole free pages from every arena back to the kernel and touches nothing that is still in use.

Two debug pages show where the memory is:

- `/debug/sqlite` shows SQLite's heap, its highest point, and every connection's page cache with hit and miss counts.
- `/debug/malloc` shows the memory the process holds, glibc's totals, the record of trims, and the report for each arena.

`-storage.sqlite-soft-heap-limit` limits the total in use. Above it, page caches reuse their oldest pages and do not grow. These pages and this flag are for one case: the system kills a daemon for lack of memory at many gigabytes, while its Go heap is under 1 GB.

The `/debug/*` pages follow the same access rules as the rest of the daemon's API.

# See also

- [The Seed daemon](../software/daemon.md), for the flags, the listeners and the `/debug` routes.
- [Self-hosting](./self-hosting.md), for the containers a site runs.
- [The web app](../software/web.md), for the caches and limits that protect the daemon from page rendering.
- [Daemon network reference](./daemon-network.md), for the sync timeouts and constants.
