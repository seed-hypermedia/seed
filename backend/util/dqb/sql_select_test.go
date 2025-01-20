package dqb

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSelect(t *testing.T) {
	test := func(want string, q *SelectQuery) {
		require.Equal(t, want, q.String())
	}

	test(sqlfmt(`
			SELECT
				id,
				name,
				email
			FROM users
			WHERE age > 30 AND country = 'US'
			ORDER BY name ASC
			LIMIT 10
		`),
		Select("id", "name", "email").
			From("users").
			Where("age > 30").
			Where("country = 'US'").
			OrderBy("name ASC").
			Limit("10"),
	)

	test(sqlfmt(`
			SELECT
				id,
				name,
				email
			FROM users
			WHERE age > 30 AND country = 'US'
			ORDER BY name ASC
		`),
		Select("id", "name", "email").
			From("users").
			Where("age > 30").
			Where("country = 'US'").
			OrderBy("name ASC"),
	)

	test(sqlfmt(`
			SELECT
				id,
				name,
				email
			FROM users
			WHERE age > 30
			ORDER BY name ASC
		`),
		Select("id", "name", "email").
			From("users").
			Where("age > 30").
			OrderBy("name ASC"),
	)
}
