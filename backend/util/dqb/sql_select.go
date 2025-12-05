package dqb

import (
	"bytes"
	"seed/backend/util/unsafeutil"
	"sync"
)

var bufferPool = sync.Pool{
	New: func() any {
		return &bytes.Buffer{}
	},
}

var queryCache = sync.Map{}

// SelectQuery helps build a SQL query.
type SelectQuery struct {
	tables       []string
	selectCols   []string
	whereClauses []string
	joins        []string
	groupBy      string
	orderBy      string
	limit        string
}

// Select creates a new [SelectQuery].
func Select(columns ...string) *SelectQuery {
	return &SelectQuery{
		selectCols: columns,
	}
}

// From tables.
func (qb *SelectQuery) From(tables ...string) *SelectQuery {
	qb.tables = tables
	return qb
}

// LeftJoin adds a LEFT JOIN clause.
func (qb *SelectQuery) LeftJoin(table string, on string) *SelectQuery {
	qb.joins = append(qb.joins, "LEFT JOIN "+table+" ON "+on)
	return qb
}

// Where adds a WHERE clause.
func (qb *SelectQuery) Where(expr ...string) *SelectQuery {
	qb.whereClauses = append(qb.whereClauses, expr...)
	return qb
}

// OrderBy sets the ORDER BY clause.
func (qb *SelectQuery) OrderBy(order string) *SelectQuery {
	qb.orderBy = order
	return qb
}

// GroupBy sets the GROUP BY clause.
func (qb *SelectQuery) GroupBy(expr string) *SelectQuery {
	qb.groupBy = expr
	return qb
}

// Limit sets the LIMIT clause.
func (qb *SelectQuery) Limit(expr string) *SelectQuery {
	qb.limit = expr
	return qb
}

// String constructs the SQL query as a string.
func (qb *SelectQuery) String() string {
	buf := bufferPool.Get().(*bytes.Buffer)
	buf.Reset()
	defer bufferPool.Put(buf)

	// SELECT clause.
	buf.WriteString("SELECT")
	for i, col := range qb.selectCols {
		if i > 0 {
			buf.WriteString(",")
		}
		buf.WriteString("\n    ")
		buf.WriteString(col)
	}

	// FROM clause.
	buf.WriteString("\nFROM ")
	for i, table := range qb.tables {
		if i > 0 {
			buf.WriteString(", ")
		}
		buf.WriteString(table)
	}

	// JOIN clause.
	if len(qb.joins) > 0 {
		for _, join := range qb.joins {
			buf.WriteRune('\n')
			buf.WriteString(join)
		}
	}

	// WHERE clause.
	if len(qb.whereClauses) > 0 {
		buf.WriteString("\nWHERE ")
		for i, clause := range qb.whereClauses {
			if i > 0 {
				buf.WriteString(" AND ")
			}
			buf.WriteString(clause)
		}
	}

	// GROUP BY clause.
	if qb.groupBy != "" {
		buf.WriteString("\nGROUP BY ")
		buf.WriteString(qb.groupBy)
	}

	// ORDER BY clause.
	if qb.orderBy != "" {
		buf.WriteString("\nORDER BY ")
		buf.WriteString(qb.orderBy)
	}

	// LIMIT clause.
	if qb.limit != "" {
		buf.WriteString("\nLIMIT ")
		buf.WriteString(qb.limit)
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
