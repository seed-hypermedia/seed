package keyline_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestReadme keeps README.md in step with the code: every Go identifier it names
// in backticks must exist, and every relative link must resolve.
func TestReadme(t *testing.T) {
	readme, err := os.ReadFile("README.md")
	require.NoError(t, err)

	dirs := map[string]string{
		"keyline": ".", "keylinemem": "keylinemem", "keylinesqlite": "keylinesqlite",
		"keylinetest": "keylinetest", "conformance": "keylinetest/conformance",
	}
	names := map[string]map[string]bool{}
	for pkg, dir := range dirs {
		names[pkg] = exportedNames(t, dir)
	}

	// Code fences hold shell commands, not identifiers.
	prose := regexp.MustCompile("(?s)```.*?```").ReplaceAllString(string(readme), "")
	identifier := regexp.MustCompile(`^(?:(keyline|keylinemem|keylinesqlite|keylinetest|conformance)\.)?([A-Z]\w*(?:\.[A-Z]\w*)?)$`)
	for _, match := range regexp.MustCompile("`([^`]+)`").FindAllStringSubmatch(prose, -1) {
		m := identifier.FindStringSubmatch(match[1])
		if m == nil || strings.ToUpper(m[2]) == m[2] {
			continue // Not a Go identifier, or an all-caps name such as a Seed role.
		}

		found := false
		for pkg := range dirs {
			if (m[1] == "" || m[1] == pkg) && names[pkg][m[2]] {
				found = true
			}
		}

		require.True(t, found, "README.md names %q, which does not exist", match[1])
	}

	for _, link := range regexp.MustCompile(`\]\(([^)#]+)(?:#[^)]*)?\)`).FindAllStringSubmatch(prose, -1) {
		if strings.Contains(link[1], "://") {
			continue
		}

		_, err := os.Stat(link[1]) //nolint:gosec // Links come from the package's own README.
		require.NoError(t, err, "README.md links to %q", link[1])
	}
}

// exportedNames returns a package's exported declarations, Type.Member names for
// exported methods and fields, and Example functions from its tests.
func exportedNames(t *testing.T, dir string) map[string]bool {
	t.Helper()

	files, err := filepath.Glob(filepath.Join(dir, "*.go"))
	require.NoError(t, err)

	names := map[string]bool{}
	for _, path := range files {
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.SkipObjectResolution)
		require.NoError(t, err)

		for _, decl := range file.Decls {
			switch d := decl.(type) {
			case *ast.FuncDecl:
				if d.Recv == nil {
					names[d.Name.Name] = true
					continue
				}

				recv := d.Recv.List[0].Type
				if star, ok := recv.(*ast.StarExpr); ok {
					recv = star.X
				}

				names[recv.(*ast.Ident).Name+"."+d.Name.Name] = true
			case *ast.GenDecl:
				for _, spec := range d.Specs {
					switch s := spec.(type) {
					case *ast.TypeSpec:
						names[s.Name.Name] = true
						if st, ok := s.Type.(*ast.StructType); ok {
							for _, field := range st.Fields.List {
								for _, name := range field.Names {
									names[s.Name.Name+"."+name.Name] = true
								}
							}
						}
					case *ast.ValueSpec:
						for _, name := range s.Names {
							names[name.Name] = true
						}
					}
				}
			}
		}
	}

	for name := range names {
		if !ast.IsExported(strings.Split(name, ".")[0]) {
			delete(names, name)
		}
	}

	return names
}
