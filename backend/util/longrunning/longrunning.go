// Package longrunning provides helpers for logging the lifecycle of long-running operations.
package longrunning

import (
	"sync"
	"time"

	"go.uber.org/zap"
)

// Tracker logs when a long-running operation starts, keeps running, and finishes.
type Tracker struct {
	log    *zap.Logger
	name   string
	start  time.Time
	fields []zap.Field
	done   chan struct{}
	once   sync.Once
	wg     sync.WaitGroup
}

// Start logs the beginning of an operation and periodically warns while it is still running.
func Start(log *zap.Logger, name string, interval time.Duration, fields ...zap.Field) *Tracker {
	if log == nil {
		log = zap.NewNop()
	}

	t := &Tracker{
		log:    log,
		name:   name,
		start:  time.Now(),
		fields: append([]zap.Field(nil), fields...),
		done:   make(chan struct{}),
	}

	t.log.Info(name+"Started", t.fields...)

	if interval > 0 {
		t.wg.Add(1)
		go func() {
			defer t.wg.Done()

			ticker := time.NewTicker(interval)
			defer ticker.Stop()

			for {
				select {
				case <-t.done:
					return
				case <-ticker.C:
					t.log.Warn(name+"StillRunning", t.withElapsed()...)
				}
			}
		}()
	}

	return t
}

// Finish logs the end of an operation with its final duration and error, if any.
func (t *Tracker) Finish(err error) {
	t.once.Do(func() {
		close(t.done)
		t.wg.Wait()

		fields := t.withElapsed()
		if err != nil {
			fields = append(fields, zap.Error(err))
		}

		t.log.Info(t.name+"Finished", fields...)
	})
}

func (t *Tracker) withElapsed() []zap.Field {
	fields := make([]zap.Field, 0, len(t.fields)+1)
	fields = append(fields, t.fields...)
	fields = append(fields, zap.Duration("elapsed", time.Since(t.start)))
	return fields
}
