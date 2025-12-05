package dqb

import (
	"bytes"
	"seed/backend/util/unsafeutil"
)

// DeleteQuery helps build a SQL delete query.
type DeleteQuery struct {
	table        string
	whereClauses []string
}

// Delete creates a new [DeleteQuery].
func Delete() *DeleteQuery {
	return &DeleteQuery{}
}

// From specifies which table to delete from.
func (qb *DeleteQuery) From(table string) *DeleteQuery {
	qb.table = table
	return qb
}

// Where adds a WHERE clause.
func (qb *DeleteQuery) Where(expr ...string) *DeleteQuery {
	qb.whereClauses = append(qb.whereClauses, expr...)
	return qb
}

// String constructs the SQL query as a string.
func (qb *DeleteQuery) String() string {
	buf := bufferPool.Get().(*bytes.Buffer)
	buf.Reset()
	defer bufferPool.Put(buf)

	// DELETE clause
	buf.WriteString("DELETE FROM ")
	buf.WriteString(qb.table)

	// WHERE clause
	if len(qb.whereClauses) > 0 {
		buf.WriteString("\nWHERE ")
		for i, clause := range qb.whereClauses {
			if i > 0 {
				buf.WriteString(" AND ")
			}
			buf.WriteString(clause)
		}
	}

	// Using unsafe string as a cache key for lookup,
	// to avoid allocating a new string if it's already cached.
	if v, ok := queryCache.Load(unsafeutil.StringFromBytes(buf.Bytes())); ok {
		return v.(string)
	}

	q := buf.String()
	queryCache.Store(q, q)
	return q
}
