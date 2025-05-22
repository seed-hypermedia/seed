package colx

import "iter"

// Object in this file means an open-ended map (like a JavaScript object).

// ObjectSet sets a value in a nested map by path.
func ObjectSet(v map[string]any, path []string, value any) {
	for i := 0; i < len(path)-1; i++ {
		key := path[i]

		if _, ok := v[key]; !ok {
			v[key] = make(map[string]any)
		}

		{
			vv, ok := v[key].(map[string]any)
			if !ok {
				m := map[string]any{}
				v[key] = m
				v = m
			} else {
				v = vv
			}
		}
	}

	v[path[len(path)-1]] = value
}

// ObjectDelete value from a nested map by path.
// It can panic if some of the values in the path are not maps.
func ObjectDelete(v map[string]any, path []string) {
	for i := 0; i < len(path)-1; i++ {
		key := path[i]

		if _, ok := v[key]; !ok {
			return
		}

		var ok bool
		v, ok = v[key].(map[string]any)
		if !ok {
			return
		}
	}

	delete(v, path[len(path)-1])
}

// ObjectGet gets a value from a nested map by path.
func ObjectGet(v map[string]any, path []string) (value any, ok bool) {
	if v == nil {
		return nil, false
	}

	for i := 0; i < len(path)-1; i++ {
		key := path[i]

		vv, ok := v[key].(map[string]any)
		if !ok {
			return nil, false
		}

		v = vv
	}

	value, ok = v[path[len(path)-1]]
	return value, ok
}

// UnsafePath is a wrapper type for a path in a nested map,
// to make it more obvious that the path is not safe to use outside the scope of the current value being iterated.
type UnsafePath struct {
	path []string
}

// Inner returns the underlying unsafe path.
func (up UnsafePath) Inner() []string {
	return up.path
}

// Clone returns a copy of the path safe for external use.
func (up UnsafePath) Clone() []string {
	out := make([]string, len(up.path))
	copy(out, up.path)
	return out
}

// ObjectWalk recursively walks through a nested map and returns the path of keys and a value.
// IMPORTANT: The path is only valid for the currently iterated value, and must be cloned if needs to be used elsewhere.
func ObjectWalk(m map[string]any) iter.Seq2[UnsafePath, any] {
	return func(yield func(UnsafePath, any) bool) {
		// Preallocate a slice long enough for a reasonably nested map.
		// It will work for deeper maps too, but will be dynamically allocated.
		up := UnsafePath{
			path: make([]string, 0, 16),
		}

		var push func(map[string]any) bool
		push = func(m map[string]any) bool {
			up.path = append(up.path, "") // Make space for the current depth.
			for k, v := range m {
				up.path[len(up.path)-1] = k

				nested, ok := v.(map[string]any)
				if ok {
					if !push(nested) {
						return false
					}
					continue
				}

				if !yield(up, v) {
					return false
				}
			}
			up.path = up.path[:len(up.path)-1] // Remove the current depth.
			return true
		}

		push(m)
	}
}
