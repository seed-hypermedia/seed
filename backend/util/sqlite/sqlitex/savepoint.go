// Copyright (c) 2018 David Crawshaw <david@zentus.com>
//
// Permission to use, copy, modify, and distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

package sqlitex

import (
	"fmt"
	"runtime"
	"strings"
	"sync"
	"time"

	"seed/backend/util/sqlite"
)

// Save creates a named SQLite transaction using SAVEPOINT.
//
// On success Savepoint returns a releaseFn that will call either
// RELEASE or ROLLBACK depending on whether the parameter *error
// points to a nil or non-nil error. This is designed to be deferred.
//
// Example:
//
//	func doWork(conn *sqlite.Conn) (err error) {
//		defer sqlitex.Save(conn)(&err)
//
//		// ... do work in the transaction
//	}
//
// Instrumentation: a top-level SAVEPOINT (issued on an autocommit connection)
// promotes to a deferred transaction that owns the writer slot the moment
// any write runs inside it. Save records the resulting hold time, statement
// capture, and in-flight presence into the same tracker that backs WithTx —
// so callers like Pool.WithSave, Read[], and ExecScript no longer hide the
// writer-slot offender on /debug/sqlite.
//
// The release closure inlines its cleanup (RELEASE / ROLLBACK TO) so that
// the closure itself is the directly-deferred function. This matters for
// panics: Go's recover() only catches a panic when called from a function
// that was directly deferred — wrapping the closure breaks that contract.
//
// https://www.sqlite.org/lang_savepoint.html
func Save(conn *sqlite.Conn) (releaseFn func(*error)) {
	name := "sqlitex.Save" // safe as names can be reused
	var pc [3]uintptr
	if n := runtime.Callers(0, pc[:]); n > 0 {
		frames := runtime.CallersFrames(pc[:n])
		if _, more := frames.Next(); more { // runtime.Callers
			if _, more := frames.Next(); more { // savepoint.Save
				frame, _ := frames.Next() // caller we care about
				if frame.Function != "" {
					name = frame.Function
				}
			}
		}
	}

	if strings.Contains(name, `"`) {
		panic(fmt.Errorf("sqlitex.Save: invalid name: %q", name))
	}

	caller := tracker.normalizeCaller(resolveCaller())
	// A SAVEPOINT issued while the connection is already inside a tx is a
	// nested sub-op — it never acquires the writer slot on its own. Detect
	// it now so we don't double-instrument inside WithTx's own scope and
	// don't clobber its capture buffer.
	nested := !conn.GetAutocommit()

	t0 := time.Now()
	if err := Exec(conn, fmt.Sprintf("SAVEPOINT %q;", name), nil); err != nil {
		// SAVEPOINT failure happens BEFORE any user-fn statement runs, so we
		// can't tell whether the scope was destined to be read-only or write.
		// Recording these on the writer-health page leaks pure-read callers
		// (GetDomain, ListPeers, ...) into the per-caller table the moment
		// their ctx is cancelled mid-acquire. Unlike WithTx — which is
		// unambiguously a write attempt and rightly records its BUSY /
		// INTERRUPT — Save defers all instrumentation until after the first
		// captured Exec discloses intent. Preserve the original panic-vs-
		// return-INTERRUPT contract; just don't pollute the tracker.
		if sqlite.ErrCode(err) == sqlite.SQLITE_INTERRUPT {
			return func(errp *error) {
				if *errp == nil {
					*errp = err
				}
			}
		}
		panic(err)
	}
	beginWait := time.Since(t0)

	tracer := conn.Tracer()
	if tracer != nil {
		tracer.Push("TX " + name)
	}

	var (
		activeID    uint64
		promoteOnce sync.Once
		promoted    bool
	)
	if !nested {
		// Top-level Save: own the writer slot — but only after we observe a
		// real write inside this scope. Read-only SAVEPOINTs (Read[],
		// ListEvents, ListPeers) hold only the SHARED reader lock; tagging
		// them as writer-slot holders would flood the writer-health page
		// with irrelevant rows and put them on the "held by" snapshot of
		// begin_busy victims they never actually blocked. The lazy promoter
		// runs from captureExecStart's done-closure the first time it sees
		// conn.Changes() > 0 (DML) or a DDL/maintenance verb.
		beginCapture(conn)
		armCapturePromoter(conn, func() {
			promoteOnce.Do(func() {
				activeID = tracker.startActive(caller)
				promoted = true
			})
		})
	}
	t1 := time.Now()

	return func(errp *error) {
		if tracer != nil {
			tracer.Pop()
		}
		recoverP := recover()

		// Record metrics + active-set release on the way out, regardless of
		// which release-path branch fires. Runs even when we re-panic below
		// because deferred funcs execute during panic unwinding.
		defer func() {
			hold := time.Since(t1)
			var stmts []capturedStmt
			wait := beginWait
			outcome := outcomeSavepointTop
			switch {
			case nested:
				outcome = outcomeSavepoint
				wait = 0
			case !promoted:
				// Top-level Save that never wrote. Tear down the capture
				// buffer but do NOT touch the active set (we never added
				// ourselves there) and label as read-only so the per-caller
				// percentiles ignore us.
				stmts = endCapture(conn)
				outcome = outcomeSavepointReadOnly
			default:
				stmts = endCapture(conn)
				tracker.endActive(activeID, caller)
			}
			// Either an explicit error from the user fn OR a propagating panic
			// counts as a rollback for the per-caller commits/rollbacks split.
			// Read-only Saves never rolled back the writer slot — preserve
			// their savepoint_ro label so they stay out of writer-health
			// stats even when the user fn returned an error.
			if outcome != outcomeSavepointReadOnly {
				if (errp != nil && *errp != nil) || recoverP != nil {
					outcome = outcomeRollback
				}
			}
			tracker.recordTx(caller, wait, hold, outcome, stmts, nil)
		}()

		// If a query was interrupted or if a user exec'd COMMIT or
		// ROLLBACK, then everything was already rolled back
		// automatically, thus returning the connection to autocommit
		// mode.
		if conn.GetAutocommit() {
			// There is nothing to rollback.
			if recoverP != nil {
				panic(recoverP)
			}
			return
		}

		if *errp == nil && recoverP == nil {
			// Success path. Release the savepoint successfully.
			*errp = Exec(conn, fmt.Sprintf("RELEASE %q;", name), nil)
			if *errp == nil {
				return
			}
			// Possible interrupt. Fall through to the error path.
			if conn.GetAutocommit() {
				// There is nothing to rollback.
				return
			}
		}

		orig := ""
		if *errp != nil {
			orig = (*errp).Error() + "\n\t"
		}

		// Error path.

		// Always run ROLLBACK even if the connection has been interrupted.
		oldDoneCh := conn.SetInterrupt(nil)
		defer conn.SetInterrupt(oldDoneCh)

		if err := Exec(conn, fmt.Sprintf("ROLLBACK TO %q;", name), nil); err != nil {
			wrapped := fmt.Errorf("%ssqlitex.savepoint: rollback failed: %w", orig, err)
			if *errp == nil {
				*errp = wrapped
			} else {
				*errp = fmt.Errorf("%w (also: rollback failed: %w)", *errp, err)
			}
			if recoverP != nil {
				panic(recoverP)
			}
			return
		}
		if err := Exec(conn, fmt.Sprintf("RELEASE %q;", name), nil); err != nil {
			wrapped := fmt.Errorf("%ssqlitex.savepoint: release failed: %w", orig, err)
			if *errp == nil {
				*errp = wrapped
			} else {
				*errp = fmt.Errorf("%w (also: release failed: %w)", *errp, err)
			}
			if recoverP != nil {
				panic(recoverP)
			}
			return
		}

		if recoverP != nil {
			panic(recoverP)
		}
	}
}
