package btree

import (
	"fmt"
	"strings"
	"testing"
)

func TestCopyOnWrite(t *testing.T) {
	bt := New[string, string](8, strings.Compare)

	bt.Set("a", "Hello")
	bt.Set("b", "World")

	bt.Copy().Set("a", "Changed")

	fmt.Println(bt.GetMaybe("a"))
}
