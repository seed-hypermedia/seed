package sqlitegen

import (
	"bytes"
	"context"
	"fmt"
	"go/format"
	"strings"
	"text/template"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

// Schema describes a SQL schema.
type Schema struct {
	Columns map[Column]ColumnInfo
}

// ColumnInfo describes a column.
type ColumnInfo struct {
	Table   Table
	SQLType string
}

// GetColumnTable returns a table of a column.
func (s *Schema) GetColumnTable(c Column) Table {
	info := s.columnInfo(c)
	return info.Table
}

// GetColumnType returns the type of a column.
// It panics if column is unknown.
func (s *Schema) GetColumnType(c Column) Type {
	info := s.columnInfo(c)

	t, ok := sqlTypes[info.SQLType]
	if !ok {
		panic(fmt.Errorf("unsupported SQL type %q for column %q", info.SQLType, c.String()))
	}

	return t
}

func (s *Schema) columnInfo(c Column) ColumnInfo {
	info, ok := s.Columns[c]
	if !ok {
		panic("unknown column " + c.String())
	}

	return info
}

func (s *Schema) addColumn(table, column, sqlType string) error {
	fqn := Column(table + "." + column)

	if s.Columns == nil {
		s.Columns = map[Column]ColumnInfo{}
	}

	if _, ok := s.Columns[fqn]; ok {
		return fmt.Errorf("column %s already exist", fqn)
	}

	s.Columns[fqn] = ColumnInfo{
		Table:   Table(table),
		SQLType: sqlType,
	}

	return nil
}

// Column is a type for a fully qualified SQL column name.
type Column string

// String implements fmt.Stringer.
func (c Column) String() string { return string(c) }

// ShortName returns only the name of the column from the fully qualified column name.
func (c Column) ShortName() string {
	idx := strings.IndexRune(string(c), '.')
	if idx == -1 {
		panic("invalid column name " + string(c))
	}

	return string(c[idx+1:])
}

// Term is a common interface for Table and Column.
type Term interface {
	isTerm()
	String() string
}

func (t Table) isTerm()        {}
func (c Column) isTerm()       {}
func (t Table) String() string { return string(t) }

// Table is a type for a SQL table name.
type Table string

var typeToGoType = map[Type]string{
	TypeInt:   "int64",
	TypeFloat: "float64",
	TypeText:  "string",
	TypeBytes: "[]byte",
}

// Type defines supported Go types in the generated code.
type Type byte

func (t Type) goString() string {
	s, ok := typeToGoType[t]
	if !ok {
		panic(fmt.Sprintf("invalid type: %d", t))
	}

	return s
}

// Supported types for inputs and outputs of a query.
const (
	TypeInt Type = iota
	TypeFloat
	TypeText
	TypeBytes
)

// We only support base SQLite data types.
// For more info see: https://www.sqlite.org/datatype3.html.
var sqlTypes = map[string]Type{
	"INTEGER": TypeInt,
	"REAL":    TypeFloat,
	"TEXT":    TypeText,
	"BLOB":    TypeBytes,
}

// IntrospectSchema attempt to infer the Schema from existing SQLite tables.
// We only support base SQLite data types.
func IntrospectSchema[T *sqlite.Conn | *sqlitex.Pool](db T) (Schema, error) {
	var conn *sqlite.Conn

	switch v := any(db).(type) {
	case *sqlite.Conn:
		conn = v
	case *sqlitex.Pool:
		c, release, err := v.Conn(context.Background())
		if err != nil {
			return Schema{}, err
		}
		defer release()
		conn = c
	}

	const query = `
SELECT 
	m.name AS table_name, 
	p.name AS column_name,
	p.type AS column_type
FROM sqlite_master AS m
JOIN pragma_table_xinfo(m.name) AS p
ORDER BY m.name, p.cid
`
	var s Schema

	err := sqlitex.Exec(conn, query, func(stmt *sqlite.Stmt) error {
		table := stmt.ColumnText(0)
		column := stmt.ColumnText(1)
		colType := stmt.ColumnText(2)

		if err := s.addColumn(table, column, colType); err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		return s, err
	}

	return s, nil
}

// CodegenSchema generates Go source code describing the database schema.
// It's supposed to be written into a separate file by some external
// code generation process.
func CodegenSchema(pkgName string, s Schema) ([]byte, error) {
	tpl, err := template.New("").
		Option("missingkey=error").
		Funcs(map[string]interface{}{
			"publicSymbol": func(v interface{}) string {
				switch vv := v.(type) {
				case Column:
					return GoNameFromSQLName(vv.String(), true)
				case Table:
					return GoNameFromSQLName(string(vv), true)
				default:
					panic("unknown type")
				}
			},
		}).
		Parse(`// Code generated by sqlitegen. DO NOT EDIT.

package {{.PkgName}}

import (
	"seed/backend/util/sqlitegen"
)

{{range $table, $cols := .Schema -}}
// Table {{$table}}.
const (
	{{publicSymbol $table}} sqlitegen.Table = "{{$table}}"
	{{- range $col, $info := $cols}}
	{{publicSymbol $col}} sqlitegen.Column = "{{$col}}"
	{{- end}}
)

// Table {{$table}}. Plain strings.
const (
	T_{{publicSymbol $table}} = "{{$table}}"
	{{- range $col, $info := $cols}}
	C_{{publicSymbol $col}} = "{{$col}}"
	{{- end}}
)

{{end -}}
// Schema describes SQLite columns.
var Schema = sqlitegen.Schema{
	Columns: map[sqlitegen.Column]sqlitegen.ColumnInfo{
		{{- range $table, $col := .Schema -}}
		{{- range $col, $info := $col}}
		{{publicSymbol $col}}: {Table: {{publicSymbol $table}}, SQLType: "{{$info.SQLType}}"},
		{{- end -}}
		{{end}}
	},
}
`)
	if err != nil {
		return nil, err
	}

	type tableMapping map[Table]map[Column]ColumnInfo

	mapping := tableMapping{}

	for col, info := range s.Columns {
		if mapping[info.Table] == nil {
			mapping[info.Table] = map[Column]ColumnInfo{}
		}
		mapping[info.Table][col] = info
	}

	var b bytes.Buffer
	err = tpl.Execute(&b, struct {
		PkgName string
		Schema  tableMapping
	}{
		PkgName: pkgName,
		Schema:  mapping,
	})
	if err != nil {
		return nil, err
	}

	code, err := format.Source(b.Bytes())
	if err != nil {
		return nil, err
	}

	return code, nil
}
