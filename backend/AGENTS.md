## General coding guidelines

- Write code in Go unless asked to use another language.
- Don't write README files unless explicitly asked to do so.
- Never edit go.mod or go.sum files directly. Use the `go mod` command if necessary.
- Use simple architecture unless specified otherwise.
- Ask any clarifying questions you need to understand the requirements.
- When naming variables, use the convention commonly used in Go: the sooner the first usage of a variable after its declaration is, the shorter the name can be. The later the first usage is, the longer the name should be. Use descriptive names that make it clear what the variable is used for. Single letter variable names are fine in loops, and when the usage is very close to the declaration. Overall, use the guidelines from Effective Go, and from the [Andrew Gerrand's talk "What's in a name"](https://go.dev/talks/2014/names.slide).
- Feel free to change implementations and public function signatures. Most of this code base is only used within this very repo, so we don't care too much about backward compatibility at this point.
- ALWAYS finish comments with a period. Comments are phrases, and phrases must end with a period.
- Only write comments for non-obvious code paths. Describe *why* something is done rather than *what* is being done.

## Guidelines for tests

- Never change existing code if the only reason is just to make the tests pass. Unless you wrote this code in the same session, or you are given permission to touch the implementation — don't do it. You can also ask for permission to change the implementation if you think it is necessary.
- When writing tests in Go, for asserts, use the `github.com/stretchr/testify/require` package, not the `assert` one.
- When describing asserts and expectations use the word "must" instead of "should" when it actually means "must". Use "should" only when it is not a strict requirement, but rather a recommendation.
- If you need to pass context around, use the new `Context()` method available on *testing.T and related testing functions. This has been added in the most recent versions of Go.
- Run `go test ./backend/...` when you need to verify your work. Don't bother running subsets of tests.
- Avoid using `go build` for main packages to verify your work. Use either `go test` or `go run` to execute your code.
- Run `golangci-lint run --new-from-merge-base origin/main ./backend/...` at the end of your work session to catch any linter issues.

## SQL Query Patterns

- Use `dqb.Str` for SQL queries unless specified otherwise. When conditional logic is needed (e.g., optional WHERE clauses based on parameters), define separate query variants with `dqb.Str` rather than building strings dynamically. This maintains compile-time safety and follows the project's conventions. Avoid manual string concatenation for SQL queries.

## General behavioral guidelines

- Avoid flattery, be blunt and concise.
- Prioritize technical accuracy and clarity over politeness.
- NEVER manipulate files with `git` unless requested. Never reset the staging area.
