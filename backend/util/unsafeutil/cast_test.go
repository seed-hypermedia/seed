package unsafeutil

import (
	"reflect"
	"testing"

	"github.com/stretchr/testify/require"
)

type A struct {
	name string
}

type B struct {
	name string
}

type C struct {
	name string
	age  int
}

func TestCheckStructLayout(t *testing.T) {
	require.NoError(t, CheckStructLayout(A{}, B{}))
	require.Error(t, CheckStructLayout(A{}, C{}))
}

func TestCaster(t *testing.T) {
	atob := NewCaster(A{}, B{})

	a := &A{name: "alice"}
	b := atob.Cast(a)
	require.Equal(t, a.name, b.name)
	require.Equal(t, reflect.TypeOf(&B{}), reflect.TypeOf(b))

	aa := atob.RevCast(b)
	require.Equal(t, a.name, aa.name)
	require.Equal(t, reflect.TypeOf(&A{}), reflect.TypeOf(aa))

	require.Panics(t, func() {
		NewCaster(A{}, C{})
	})

	require.Panics(t, func() {
		NewCaster(&A{}, &C{})
	})
}
