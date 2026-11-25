//go:build linux

package daemon

/*
#include <stdlib.h>
#include <stdio.h>
#include <malloc.h>

// The daemon links against glibc on Linux (the Debian image and the CI
// runners), whose allocator is the one that keeps freed memory per arena.
// The guards keep a musl build compiling, with every function reporting
// nothing.

// seed_malloc_info renders malloc_info(3)'s per-arena XML into a malloc'd
// string the caller frees, or NULL when unavailable.
static char *seed_malloc_info(void) {
#if defined(__GLIBC__)
	char *buf = NULL;
	size_t len = 0;
	FILE *f = open_memstream(&buf, &len);
	if (f == NULL) {
		return NULL;
	}
	int rc = malloc_info(0, f);
	fclose(f);
	if (rc != 0) {
		free(buf);
		return NULL;
	}
	return buf;
#else
	return NULL;
#endif
}

// seed_malloc_trim gives free heap pages back to the kernel and reports
// whether any were released.
static int seed_malloc_trim(void) {
#if defined(__GLIBC__)
	return malloc_trim(0);
#else
	return 0;
#endif
}

// seed_mallinfo fills the allocator totals across every arena.
static void seed_mallinfo(size_t *arena, size_t *mmapped, size_t *inuse, size_t *freed, size_t *keepcost) {
	*arena = *mmapped = *inuse = *freed = *keepcost = 0;
#if defined(__GLIBC__)
#if __GLIBC_PREREQ(2, 33)
	struct mallinfo2 mi = mallinfo2();
	*arena = mi.arena;
	*mmapped = mi.hblkhd;
	*inuse = mi.uordblks;
	*freed = mi.fordblks;
	*keepcost = mi.keepcost;
#endif
#endif
}
*/
import "C"

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"sync/atomic"
	"time"
	"unsafe"
)

// mallocTrimInterval is how often the daemon gives glibc's free heap pages
// back to the kernel.
const mallocTrimInterval = time.Minute

// mallocTrimStats is what /debug/malloc reports about the trim loop.
var mallocTrimStats struct {
	calls    atomic.Uint64
	released atomic.Uint64
	lastAt   atomic.Int64 // unix nanoseconds, zero until the first call
	lastTook atomic.Int64 // nanoseconds
}

// mallocTrim gives glibc's free heap pages back to the kernel once and
// records the outcome for /debug/malloc.
func mallocTrim() {
	start := time.Now()
	released := C.seed_malloc_trim() != 0
	mallocTrimStats.calls.Add(1)
	if released {
		mallocTrimStats.released.Add(1)
	}
	mallocTrimStats.lastAt.Store(start.UnixNano())
	mallocTrimStats.lastTook.Store(int64(time.Since(start)))
}

// runMallocTrim calls mallocTrim every mallocTrimInterval until ctx is done.
//
// SQLite frees page caches and sorters promptly: a WAL reader drops its whole
// cache when it starts a read after a commit, and a sorter goes with its
// statement. glibc, however, keeps the freed chunks inside the arena they
// came from and only returns the top of each heap on its own. Cgo calls land
// on whichever of the daemon's threads is free, so those chunks spread over
// dozens of arenas and the process ratchets up to the sum of every arena's
// peak. malloc_trim(0) walks every arena and releases whole free pages with
// MADV_DONTNEED. It never touches memory anything still owns, so no cache is
// lost; the cost is a short walk under each arena's lock and zero-filled
// pages for the next large allocation.
func runMallocTrim(ctx context.Context) {
	t := time.NewTimer(mallocTrimInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		mallocTrim()
		t.Reset(mallocTrimInterval)
	}
}

// mallocDebugHandler serves /debug/malloc: the process RSS, glibc's totals,
// the trim loop's record and malloc_info's per-arena XML. Together with the
// memory section of /debug/sqlite it splits the daemon's C heap into what
// SQLite holds, what glibc keeps free, and the rest.
func mallocDebugHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		const mib = 1 << 20
		var arena, mmapped, inuse, freed, keepcost C.size_t
		C.seed_mallinfo(&arena, &mmapped, &inuse, &freed, &keepcost)

		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		if statm, err := os.ReadFile("/proc/self/statm"); err == nil {
			var size, rss int64
			if _, err := fmt.Sscan(string(statm), &size, &rss); err == nil {
				fmt.Fprintf(w, "process resident set                 %.1f MiB\n\n", float64(rss*int64(os.Getpagesize()))/mib)
			}
		}
		fmt.Fprintf(w, "glibc malloc, every arena (mallinfo2)\n")
		fmt.Fprintf(w, "  heap from the kernel (arena)       %.1f MiB\n", float64(arena)/mib)
		fmt.Fprintf(w, "  mmapped chunks (hblkhd)            %.1f MiB\n", float64(mmapped)/mib)
		fmt.Fprintf(w, "  in use (uordblks)                  %.1f MiB\n", float64(inuse)/mib)
		fmt.Fprintf(w, "  free, kept by glibc (fordblks)     %.1f MiB   malloc_trim returns these pages to the kernel; RSS drops, this number does not\n", float64(freed)/mib)
		fmt.Fprintf(w, "  releasable heap top (keepcost)     %.1f MiB\n", float64(keepcost)/mib)

		fmt.Fprintf(w, "\nmalloc_trim(0) every %s: %d calls, %d released memory", mallocTrimInterval, mallocTrimStats.calls.Load(), mallocTrimStats.released.Load())
		if at := mallocTrimStats.lastAt.Load(); at != 0 {
			fmt.Fprintf(w, ", last %s ago taking %s", time.Since(time.Unix(0, at)).Truncate(time.Second), time.Duration(mallocTrimStats.lastTook.Load()))
		}
		fmt.Fprint(w, "\n\n")

		info := C.seed_malloc_info()
		if info == nil {
			fmt.Fprint(w, "malloc_info is unavailable: not glibc\n")
			return
		}
		defer C.free(unsafe.Pointer(info))
		fmt.Fprint(w, C.GoString(info))
	})
}
