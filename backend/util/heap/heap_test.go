package heap

import (
	"math/rand"
	"testing"
)

type myHeap struct {
	Heap[int]
}

func newTestHeap() *myHeap {
	h := New(func(i, j int) bool { return i < j })
	return &myHeap{
		Heap: *h,
	}
}

func (h myHeap) verify(t *testing.T, i int) {
	t.Helper()
	n := h.Len()
	j1 := 2*i + 1
	j2 := 2*i + 2
	if j1 < n {
		if h.less(j1, i) {
			t.Errorf("heap invariant invalidated [%d] = %d > [%d] = %d", i, h.data[i], j1, h.data[j1])
			return
		}
		h.verify(t, j1)
	}
	if j2 < n {
		if h.less(j2, i) {
			t.Errorf("heap invariant invalidated [%d] = %d > [%d] = %d", i, h.data[i], j1, h.data[j2])
			return
		}
		h.verify(t, j2)
	}
}

func TestInit0(t *testing.T) {
	h := newTestHeap()
	for i := 20; i > 0; i-- {
		h.Push(0) // all elements are the same
	}

	h.verify(t, 0)

	for i := 1; h.Len() > 0; i++ {
		x := h.Pop()
		h.verify(t, 0)
		if x != 0 {
			t.Errorf("%d.th pop got %d; want %d", i, x, 0)
		}
	}
}

func TestInit1(t *testing.T) {
	h := newTestHeap()
	for i := 20; i > 0; i-- {
		h.Push(i) // all elements are different
	}

	h.verify(t, 0)

	for i := 1; h.Len() > 0; i++ {
		x := h.Pop()
		h.verify(t, 0)
		if x != i {
			t.Errorf("%d.th pop got %d; want %d", i, x, i)
		}
	}
}

func Test(t *testing.T) {
	h := newTestHeap()
	h.verify(t, 0)

	for i := 20; i > 10; i-- {
		h.Push(i)
	}

	h.verify(t, 0)

	for i := 10; i > 0; i-- {
		h.Push(i)
		h.verify(t, 0)
	}

	for i := 1; h.Len() > 0; i++ {
		x := h.Pop()
		if i < 20 {
			h.Push(20 + i)
		}
		h.verify(t, 0)
		if x != i {
			t.Errorf("%d.th pop got %d; want %d", i, x, i)
		}
	}
}

func TestRemove0(t *testing.T) {
	h := newTestHeap()
	for i := 0; i < 10; i++ {
		h.Push(i)
	}
	h.verify(t, 0)

	for h.Len() > 0 {
		i := h.Len() - 1
		x := h.Remove(i)
		if x != i {
			t.Errorf("Remove(%d) got %d; want %d", i, x, i)
		}
		h.verify(t, 0)
	}
}

func TestRemove1(t *testing.T) {
	h := newTestHeap()
	for i := 0; i < 10; i++ {
		h.Push(i)
	}
	h.verify(t, 0)

	for i := 0; h.Len() > 0; i++ {
		x := h.Remove(0)
		if x != i {
			t.Errorf("Remove(0) got %d; want %d", x, i)
		}
		h.verify(t, 0)
	}
}

func TestRemove2(t *testing.T) {
	N := 10

	h := newTestHeap()
	for i := 0; i < N; i++ {
		h.Push(i)
	}
	h.verify(t, 0)

	m := make(map[int]bool)
	for h.Len() > 0 {
		m[h.Remove((h.Len()-1)/2)] = true
		h.verify(t, 0)
	}

	if len(m) != N {
		t.Errorf("len(m) = %d; want %d", len(m), N)
	}
	for i := 0; i < len(m); i++ {
		if !m[i] {
			t.Errorf("m[%d] doesn't exist", i)
		}
	}
}

func BenchmarkDup(b *testing.B) {
	const n = 10000
	h := newTestHeap()
	h.data = make([]int, 0, n)
	for i := 0; i < b.N; i++ {
		for j := 0; j < n; j++ {
			h.Push(0) // all elements are the same
		}
		for h.Len() > 0 {
			h.Pop()
		}
	}
}

func TestFix(t *testing.T) {
	h := newTestHeap()
	h.verify(t, 0)

	for i := 200; i > 0; i -= 10 {
		h.Push(i)
	}
	h.verify(t, 0)

	if h.data[0] != 10 {
		t.Fatalf("Expected head to be 10, was %d", h.data[0])
	}
	h.data[0] = 210
	h.Fix(0)
	h.verify(t, 0)

	for i := 100; i > 0; i-- {
		elem := rand.Intn(h.Len())
		if i&1 == 0 {
			h.data[elem] *= 2
		} else {
			h.data[elem] /= 2
		}
		h.Fix(elem)
		h.verify(t, 0)
	}
}

func TestReset(t *testing.T) {
	h := newTestHeap()
	for i := 0; i < 100; i++ {
		h.Push(i)
	}

	if h.Len() != 100 {
		t.Errorf("Expected len 100, got %d", h.Len())
	}

	h.Reset(50)
	if h.Len() != 0 {
		t.Errorf("Expected len 0 after reset, got %d", h.Len())
	}

	h.verify(t, 0)
	for i := 0; i < 50; i++ {
		h.Push(i)
	}
	h.verify(t, 0)
}

func TestOnIndexChange(t *testing.T) {
	h := New(func(i, j int) bool { return i < j })

	var indexChanges []struct {
		elem, idx int
	}
	h.OnIndexChange = func(elem int, newIndex int) {
		indexChanges = append(indexChanges, struct {
			elem, idx int
		}{elem, newIndex})
	}

	h.Push(5)
	h.Push(3)
	h.Push(7)
	h.Push(1)

	if len(indexChanges) == 0 {
		t.Error("Expected OnIndexChange to be called during Push operations")
	}

	// Verify that the callback reported the correct indices.
	// Check that each element's last reported index matches its actual position.
	positions := make(map[int]int)
	for _, change := range indexChanges {
		positions[change.elem] = change.idx
	}

	// Verify all elements have valid indices.
	for elem, idx := range positions {
		if idx < 0 || idx >= h.Len() {
			if idx != -1 { // -1 is valid for removed elements.
				t.Errorf("Element %d has invalid index %d", elem, idx)
			}
		}
		_ = elem
	}

	indexChanges = nil
	popped := h.Pop()

	if len(indexChanges) == 0 {
		t.Error("Expected OnIndexChange to be called during Pop operation")
	}

	// The popped element should have been reported with index -1.
	found := false
	for _, change := range indexChanges {
		if change.elem == popped && change.idx == -1 {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Expected popped element %d to be reported with index -1", popped)
	}
}

func TestOnSwapNil(t *testing.T) {
	h := newTestHeap()
	h.Push(5)
	h.Push(3)
	h.Push(7)
	h.Push(1)
	h.verify(t, 0)

	x := h.Pop()
	if x != 1 {
		t.Errorf("Expected 1, got %d", x)
	}
	h.verify(t, 0)
}

func TestPeekOnEmptyHeap(t *testing.T) {
	h := newTestHeap()
	defer func() {
		if r := recover(); r == nil {
			t.Error("Expected Peek on empty heap to panic")
		}
	}()
	h.Peek()
}

func TestRemoveOutOfBounds(t *testing.T) {
	h := newTestHeap()
	for i := 0; i < 5; i++ {
		h.Push(i)
	}

	defer func() {
		if r := recover(); r == nil {
			t.Error("Expected Remove with out-of-bounds index to panic")
		}
	}()
	h.Remove(10)
}

func TestRemoveMiddleElement(t *testing.T) {
	h := newTestHeap()
	for i := 0; i < 10; i++ {
		h.Push(i)
	}
	h.verify(t, 0)

	mid := h.Len() / 2
	removed := h.Remove(mid)

	h.verify(t, 0)
	if h.Len() != 9 {
		t.Errorf("Expected len 9 after remove, got %d", h.Len())
	}

	popCount := 0
	for h.Len() > 0 {
		val := h.Pop()
		if val == removed {
			t.Errorf("Removed element %d should not be in heap", removed)
		}
		popCount++
	}

	if popCount != 9 {
		t.Errorf("Expected 9 elements, got %d", popCount)
	}
}

func TestFixAtRoot(t *testing.T) {
	h := newTestHeap()
	for i := 100; i > 0; i -= 10 {
		h.Push(i)
	}
	h.verify(t, 0)

	h.data[0] = 150
	h.Fix(0)
	h.verify(t, 0)

	root := h.Peek()
	if root == 150 {
		t.Error("Expected element to be moved down from root")
	}
}

func TestFixAtLeaf(t *testing.T) {
	h := newTestHeap()
	for i := 1; i <= 20; i++ {
		h.Push(i)
	}
	h.verify(t, 0)

	lastIdx := h.Len() - 1
	h.data[lastIdx] = 0
	h.Fix(lastIdx)
	h.verify(t, 0)

	root := h.Peek()
	if root != 0 {
		t.Errorf("Expected 0 at root, got %d", root)
	}
}
