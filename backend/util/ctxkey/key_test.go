// Copyright (c) Tailscale Inc & contributors
// SPDX-License-Identifier: BSD-3-Clause

package ctxkey

import (
	"context"
	"fmt"
	"io"
	"regexp"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestKey(t *testing.T) {
	ctx := context.Background()

	// Test keys with the same name as being distinct.
	k1 := New("same.Name", "")
	require.Equal(t, "same.Name", k1.String())
	k2 := New("same.Name", "")
	require.Equal(t, "same.Name", k2.String())
	require.False(t, k1 == k2)
	ctx = k1.WithValue(ctx, "hello")
	require.True(t, k1.Has(ctx))
	require.Equal(t, "hello", k1.Value(ctx))
	require.False(t, k2.Has(ctx))
	require.Empty(t, k2.Value(ctx))
	ctx = k2.WithValue(ctx, "goodbye")
	require.True(t, k1.Has(ctx))
	require.Equal(t, "hello", k1.Value(ctx))
	require.True(t, k2.Has(ctx))
	require.Equal(t, "goodbye", k2.Value(ctx))

	// Test default value.
	k3 := New("mapreduce.Timeout", time.Hour)
	require.False(t, k3.Has(ctx))
	require.Equal(t, time.Hour, k3.Value(ctx))
	ctx = k3.WithValue(ctx, time.Minute)
	require.True(t, k3.Has(ctx))
	require.Equal(t, time.Minute, k3.Value(ctx))

	// Test incomparable value.
	k4 := New("slice", []int(nil))
	require.False(t, k4.Has(ctx))
	require.Equal(t, []int(nil), k4.Value(ctx))
	ctx = k4.WithValue(ctx, []int{1, 2, 3})
	require.True(t, k4.Has(ctx))
	require.Equal(t, []int{1, 2, 3}, k4.Value(ctx))

	// Accessors should be allocation free.
	require.Equal(t, 0.0, testing.AllocsPerRun(100, func() {
		k1.Value(ctx)
		k1.Has(ctx)
		k1.ValueOk(ctx)
	}))

	// Test keys that are created without New.
	var k5 Key[string]
	require.Equal(t, "string", k5.String())
	require.False(t, k1 == k5) // should be different from key created by New
	require.False(t, k5.Has(ctx))
	ctx = k5.WithValue(ctx, "fizz")
	require.Equal(t, "fizz", k5.Value(ctx))
	var k6 Key[string]
	require.Equal(t, "string", k6.String())
	require.Equal(t, k5, k6)
	require.True(t, k6.Has(ctx))
	ctx = k6.WithValue(ctx, "fizz")

	// Test interface value types.
	var k7 Key[any]
	require.False(t, k7.Has(ctx))
	ctx = k7.WithValue(ctx, "whatever")
	require.Equal(t, "whatever", k7.Value(ctx))
	ctx = k7.WithValue(ctx, []int{1, 2, 3})
	require.Equal(t, []int{1, 2, 3}, k7.Value(ctx))
	ctx = k7.WithValue(ctx, nil)
	require.True(t, k7.Has(ctx))
	require.Equal(t, nil, k7.Value(ctx))
	k8 := New[error]("error", io.EOF)
	require.False(t, k8.Has(ctx))
	require.Equal(t, io.EOF, k8.Value(ctx))
	ctx = k8.WithValue(ctx, nil)
	require.Equal(t, nil, k8.Value(ctx))
	require.True(t, k8.Has(ctx))
	err := fmt.Errorf("read error: %w", io.ErrUnexpectedEOF)
	ctx = k8.WithValue(ctx, err)
	require.Equal(t, err, k8.Value(ctx))
	require.True(t, k8.Has(ctx))
}

func TestStringer(t *testing.T) {
	t.SkipNow() // TODO(https://go.dev/cl/555697): Enable this after fix is merged upstream.
	ctx := context.Background()
	require.Regexp(t, regexp.MustCompile("foo.Bar.*baz"), fmt.Sprint(New("foo.Bar", "").WithValue(ctx, "baz")))
	require.Regexp(t, regexp.MustCompile(fmt.Sprintf("%[1]T.*%[1]v", []int{1, 2, 3})), fmt.Sprint(New("", []int{}).WithValue(ctx, []int{1, 2, 3})))
	require.Regexp(t, regexp.MustCompile("int.*5"), fmt.Sprint(New("", 0).WithValue(ctx, 5)))
	require.Regexp(t, regexp.MustCompile(fmt.Sprintf("%[1]T.*%[1]v", time.Hour)), fmt.Sprint(Key[time.Duration]{}.WithValue(ctx, time.Hour)))
}
