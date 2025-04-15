package colx

// TransposeMap swaps map values for keys.
// Useful for defining lookup and reverse-lookup in-memory indexes.
func TransposeMap[K, V comparable](in map[K]V) map[V]K {
	out := make(map[V]K, len(in))

	for k, v := range in {
		out[v] = k
	}

	return out
}
