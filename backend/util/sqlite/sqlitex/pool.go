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
	"context"
	"errors"
	"fmt"
	"runtime/trace"
	"strings"
	"sync"
	"time"

	"seed/backend/util/sqlite"
)

// ErrPoolClosed is returned when a connection is requested from a closed pool.
var ErrPoolClosed = errors.New("sqlite pool is closed")

// Pool is a pool of SQLite connections.
//
// It is safe for use by multiple goroutines concurrently.
//
// Callers must explicitly request either a read-only or read-write connection:
//
//	conn, release, err := dbpool.ReadConn(ctx)
//	if err != nil {
//		return err
//	}
//	defer release()
//
// Use WriteConn for work that may write to the main database.
type Pool struct {
	// If checkReset, the Put method checks all of the connection's
	// prepared statements and ensures they were correctly cleaned up.
	// If they were not, Put will panic with details.
	//
	// TODO: export this? Is it enough of a performance concern?
	checkReset bool

	freeRead  chan *sqlite.Conn
	freeWrite chan *sqlite.Conn
	closed    chan struct{}
	file      string

	all   map[*sqlite.Conn]context.CancelFunc
	roles map[*sqlite.Conn]connRole

	mu sync.RWMutex
}

type connRole uint8

const (
	connRead connRole = iota
	connWrite
)

// Open opens a fixed-size pool of SQLite connections.
// A flags value of 0 defaults to:
//
//	SQLITE_OPEN_READWRITE
//	SQLITE_OPEN_CREATE
//	SQLITE_OPEN_WAL
//	SQLITE_OPEN_URI
//	SQLITE_OPEN_NOMUTEX
func Open(uri string, flags sqlite.OpenFlags, poolSize int) (pool *Pool, err error) {
	if uri == ":memory:" {
		return nil, strerror{msg: `sqlite: ":memory:" does not work with multiple connections, use "file::memory:?mode=memory&cache=shared"`}
	}
	inMemory := strings.Contains(strings.ToLower(uri), "mode=memory")
	if inMemory && !strings.Contains(strings.ToLower(uri), "cache=shared") {
		if strings.Contains(uri, "cache=") {
			return nil, strerror{msg: `sqlite: in-memory pools require cache=shared`}
		}
		sep := "&"
		if !strings.Contains(uri, "?") {
			sep = "?"
		}
		uri += sep + "cache=shared"
	}

	p := &Pool{
		checkReset: true,
		freeRead:   make(chan *sqlite.Conn, poolSize),
		freeWrite:  make(chan *sqlite.Conn, 1),
		closed:     make(chan struct{}),
		file:       uri,
	}
	defer func() {
		// If an error occurred, call Close outside the lock so this doesn't deadlock.
		if err != nil {
			err = errors.Join(err, p.closePartial())
		}
	}()

	if flags == 0 {
		flags = sqlite.SQLITE_OPEN_READWRITE |
			sqlite.SQLITE_OPEN_CREATE |
			sqlite.SQLITE_OPEN_WAL |
			sqlite.SQLITE_OPEN_URI |
			sqlite.SQLITE_OPEN_NOMUTEX
	}

	// sqlitex_pool is also defined in package sqlite
	const sqlitex_pool = sqlite.OpenFlags(0x01000000)
	flags |= sqlitex_pool

	p.all = make(map[*sqlite.Conn]context.CancelFunc)
	p.roles = make(map[*sqlite.Conn]connRole)
	writeFlags := flags&^sqlite.SQLITE_OPEN_READONLY | sqlite.SQLITE_OPEN_READWRITE
	readFlags := flags&^(sqlite.SQLITE_OPEN_READWRITE|sqlite.SQLITE_OPEN_CREATE) | sqlite.SQLITE_OPEN_READONLY

	conn, err := sqlite.OpenConn(uri, writeFlags)
	if err != nil {
		return nil, err
	}
	p.freeWrite <- conn
	p.all[conn] = func() {}
	p.roles[conn] = connWrite

	for range poolSize {
		conn, err := sqlite.OpenConn(uri, readFlags)
		if err != nil {
			return nil, err
		}
		if inMemory {
			if err := Exec(conn, "PRAGMA query_only=ON", nil); err != nil {
				err = errors.Join(err, conn.Close())
				return nil, err
			}
		}
		p.freeRead <- conn
		p.all[conn] = func() {}
		p.roles[conn] = connRead
	}

	return p, nil
}

// File returns the path to the database file that was used to create the pool.
func (p *Pool) File() string {
	return p.file
}

// ForEach applies fn to all connections in the pool. Can be used to enable some
// functionality (like foreign keys), before actually using the pool.
func (p *Pool) ForEach(fn func(conn *sqlite.Conn) error) error {
	for conn := range p.all {
		if err := fn(conn); err != nil {
			return err
		}
	}

	return nil
}

// ForWrite applies fn to the pool's single write connection.
func (p *Pool) ForWrite(fn func(conn *sqlite.Conn) error) error {
	p.mu.RLock()
	defer p.mu.RUnlock()
	for conn, role := range p.roles {
		if role == connWrite {
			return fn(conn)
		}
	}
	return ErrPoolClosed
}

// ForEachRead applies fn to all read-only connections in the pool.
func (p *Pool) ForEachRead(fn func(conn *sqlite.Conn) error) error {
	p.mu.RLock()
	defer p.mu.RUnlock()
	for conn, role := range p.roles {
		if role != connRead {
			continue
		}
		if err := fn(conn); err != nil {
			return err
		}
	}
	return nil
}

// ReadConn gets a read-only SQLite connection from the pool.
func (p *Pool) ReadConn(ctx context.Context) (*sqlite.Conn, context.CancelFunc, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	conn := p.get(ctx, connRead)
	if conn == nil {
		err := ctx.Err()
		if err != nil {
			return nil, nil, err
		}
		return nil, nil, ErrPoolClosed
	}

	return conn, func() { p.Put(conn) }, nil
}

// WriteConn gets the single read-write SQLite connection from the pool.
func (p *Pool) WriteConn(ctx context.Context) (*sqlite.Conn, context.CancelFunc, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	conn := p.get(ctx, connWrite)
	if conn == nil {
		err := ctx.Err()
		if err != nil {
			return nil, nil, err
		}
		return nil, nil, ErrPoolClosed
	}

	return conn, func() { p.Put(conn) }, nil
}

func (p *Pool) get(ctx context.Context, role connRole) *sqlite.Conn {
	var tr sqlite.Tracer
	if ctx != nil {
		tr = &tracer{ctx: ctx}
	} else {
		ctx = context.Background()
	}
	var cancel context.CancelFunc
	ctx, cancel = context.WithCancel(ctx)
	free := p.freeRead
	if role == connWrite {
		free = p.freeWrite
	}

outer:
	select {
	case conn := <-free:
		p.mu.Lock()
		defer p.mu.Unlock()

		select {
		case <-p.closed:
			free <- conn
			break outer
		default:
		}

		conn.SetTracer(tr)
		conn.SetInterrupt(ctx.Done())

		p.all[conn] = cancel

		return conn
	case <-ctx.Done():
	case <-p.closed:
	}
	cancel()
	return nil
}

// Put puts an SQLite connection back into the Pool.
//
// Put will panic if conn is nil or if the conn was not originally created by
// p.
//
// Callers should normally use ReadConn or WriteConn and call the returned
// release function instead of calling Put directly.
func (p *Pool) Put(conn *sqlite.Conn) {
	if conn == nil {
		panic("attempted to Put a nil Conn into Pool")
	}
	if p.checkReset {
		query := conn.CheckReset()
		if query != "" {
			panic(fmt.Sprintf("connection returned to pool has active statement: %q", query))
		}
	}

	p.mu.RLock()
	cancel, found := p.all[conn]
	p.mu.RUnlock()

	if !found {
		panic("sqlite.Pool.Put: connection not created by this pool")
	}

	conn.ResetTxTracking()
	cancel()
	switch p.roles[conn] {
	case connRead:
		p.freeRead <- conn
	case connWrite:
		p.freeWrite <- conn
	default:
		panic("sqlite.Pool.Put: connection has unknown role")
	}
}

// Query executes a function on a read-only connection from the pool.
func (p *Pool) Query(ctx context.Context, fn func(conn *sqlite.Conn) error) error {
	conn, release, err := p.ReadConn(ctx)
	if err != nil {
		return err
	}
	defer release()

	return fn(conn)
}

// Closed returns a channel that is closed when Pool.Close() is called.
// Useful for background goroutines that hold resources outside the pool
// (e.g. a dedicated WAL-checkpoint conn) and need a death signal that
// isn't predicated on grabbing a pool conn.
func (p *Pool) Closed() <-chan struct{} {
	return p.closed
}

// PoolCloseTimeout is the
var PoolCloseTimeout = 5 * time.Second

// Close interrupts and closes all the connections in the Pool.
//
// Close blocks until all connections are returned to the Pool.
//
// Close will panic if not all connections are returned before
// PoolCloseTimeout.
func (p *Pool) Close() (err error) {
	close(p.closed)

	p.mu.RLock()
	for _, cancel := range p.all {
		cancel()
	}
	p.mu.RUnlock()

	timeout := time.After(PoolCloseTimeout)
	readCount := 0
	for _, role := range p.roles {
		if role == connRead {
			readCount++
		}
	}
	for closed := 0; closed < readCount; closed++ {
		select {
		case conn := <-p.freeRead:
			err = errors.Join(err, closePoolConn(conn))
		case <-timeout:
			panic("not all connections returned to Pool before timeout")
		}
	}
	select {
	case conn := <-p.freeWrite:
		err = errors.Join(err, closePoolConn(conn))
	case <-timeout:
		panic("not all connections returned to Pool before timeout")
	}
	return
}

func (p *Pool) closePartial() (err error) {
	p.mu.RLock()
	for _, cancel := range p.all {
		cancel()
	}
	p.mu.RUnlock()

	readCount := 0
	writeCount := 0
	for _, role := range p.roles {
		switch role {
		case connRead:
			readCount++
		case connWrite:
			writeCount++
		}
	}
	for range readCount {
		select {
		case conn := <-p.freeRead:
			err = errors.Join(err, closePoolConn(conn))
		default:
		}
	}
	for range writeCount {
		select {
		case conn := <-p.freeWrite:
			err = errors.Join(err, closePoolConn(conn))
		default:
		}
	}
	return err
}

func closePoolConn(conn *sqlite.Conn) error {
	conn.SetInterrupt(nil)
	return errors.Join(Exec(conn, "SELECT 1", nil), conn.Close())
}

type strerror struct {
	msg string
}

func (err strerror) Error() string { return err.msg }

type tracer struct {
	ctx       context.Context
	ctxStack  []context.Context
	taskStack []*trace.Task
}

func (t *tracer) pctx() context.Context {
	if len(t.ctxStack) != 0 {
		return t.ctxStack[len(t.ctxStack)-1]
	}
	return t.ctx
}

func (t *tracer) Push(name string) {
	ctx, task := trace.NewTask(t.pctx(), name)
	t.ctxStack = append(t.ctxStack, ctx)
	t.taskStack = append(t.taskStack, task)
}

func (t *tracer) Pop() {
	t.taskStack[len(t.taskStack)-1].End()
	t.taskStack = t.taskStack[:len(t.taskStack)-1]
	t.ctxStack = t.ctxStack[:len(t.ctxStack)-1]
}

func (t *tracer) NewTask(name string) sqlite.TracerTask {
	ctx, task := trace.NewTask(t.pctx(), name)
	return &tracerTask{
		ctx:  ctx,
		task: task,
	}
}

type tracerTask struct {
	ctx    context.Context
	task   *trace.Task
	region *trace.Region
}

func (t *tracerTask) StartRegion(regionType string) {
	if t.region != nil {
		panic("sqlitex.tracerTask.StartRegion: already in region")
	}
	t.region = trace.StartRegion(t.ctx, regionType)
}

func (t *tracerTask) EndRegion() {
	t.region.End()
	t.region = nil
}

func (t *tracerTask) End() {
	t.task.End()
}
