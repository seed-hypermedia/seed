#!/usr/bin/env bash
# Reports upstream Keyline changes since the commit pinned in UPSTREAM, and checks
# that every upstream conformance case at the compared ref is either marked as
# ported ("// upstream: <module>::<case>" on a Go test) or listed as skipped.
#
# Usage: upstream.sh [ref]   Compare the pin with ref (default: origin/main).
# The keyhive clone lives in KEYHIVE_DIR (default:
# $TMPDIR/seed-keyline-upstream-clone) and is reused across runs. It is created
# on first use and fetched before every report.
#
# Prints a Markdown report. Exit status: 0 when there is nothing to do, 1 when
# the report lists work, 2 when an expectation the report relies on is broken
# (malformed UPSTREAM, unusable clone, or an upstream layout change). Every
# failure prints hints on stderr.
set -euo pipefail
export LC_ALL=C

here=$(cd "$(dirname "$0")" && pwd)
ref=${1:-origin/main}
modules=(scenarios laws)
module_re="($(IFS='|' && echo "${modules[*]}"))"
case_re="^$module_re::[a-z0-9_]+\$"
list_file=keyline/src/test_utils/conformance.rs
module_dir=keyline/src/test_utils/conformance

# fail <problem> [hint...] reports a broken expectation and exits 2.
fail() {
	echo "upstream.sh: $1" >&2
	shift
	for hint; do echo "  hint: $hint" >&2; done
	exit 2
}

repo='' pin='' tracks=() skips=() n=0
while IFS= read -r line || [[ -n $line ]]; do
	n=$((n + 1))
	[[ $line =~ ^[[:space:]]*(#|$) ]] && continue
	read -r key value reason <<<"$line"
	at="UPSTREAM:$n"
	case $key in
	repo)
		[[ -z $repo ]] || fail "$at: repo is set twice"
		repo=$value
		;;
	commit)
		[[ -z $pin ]] || fail "$at: commit is set twice"
		[[ $value =~ ^[0-9a-f]{40}$ ]] || fail "$at: commit must be a full 40-character SHA, got '$value'"
		pin=$value
		;;
	track)
		[[ -n $value && -z $reason ]] || fail "$at: expected 'track <path>'"
		tracks+=("$value")
		;;
	skip)
		[[ $value =~ $case_re && -n $reason ]] ||
			fail "$at: expected 'skip <module>::<case> <reason>' with module one of: ${modules[*]}"
		skips+=("$value")
		;;
	*) fail "$at: unknown keyword '$key'" "Valid keywords are repo, commit, track, and skip." ;;
	esac
done <"$here/UPSTREAM"
[[ -n $repo && -n $pin && ${#tracks[@]} -gt 0 ]] || fail "UPSTREAM needs repo, commit, and at least one track line"

dir=${KEYHIVE_DIR:-${TMPDIR:-/tmp}/seed-keyline-upstream-clone}
if [[ ! -e $dir ]]; then
	# Bare, because the script only reads objects; a fetch refspec keeps origin/* refs.
	{ git clone --quiet --bare --filter=blob:none "$repo" "$dir" &&
		git -C "$dir" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'; } ||
		fail "cannot clone $repo into $dir" "Check network access and the repo line in UPSTREAM."
elif [[ $(git -C "$dir" remote get-url origin 2>/dev/null) != "$repo" ]]; then
	fail "$dir is not a clone of $repo" "Remove it, or set KEYHIVE_DIR to a clone of $repo."
fi
git -C "$dir" fetch --quiet --prune --tags origin ||
	fail "cannot fetch $repo into $dir" "Check network access; the report would be stale without a fetch."

git -C "$dir" cat-file -e "$pin^{commit}" 2>/dev/null ||
	fail "pinned commit $pin does not exist upstream" \
		"Upstream history may have been rewritten. Find the equivalent commit and update commit in UPSTREAM."
target=$(git -C "$dir" rev-parse --verify --quiet "$ref^{commit}") ||
	fail "cannot resolve '$ref' in $dir" "Pass a remote branch such as origin/main, a tag, or a commit SHA."

# Tracked paths that vanish would silently hide upstream changes from the log.
for path in "${tracks[@]}"; do
	git -C "$dir" cat-file -e "$pin:$path" 2>/dev/null ||
		fail "tracked path $path does not exist at the pin" "Fix its track line in UPSTREAM."
	git -C "$dir" cat-file -e "$target:$path" 2>/dev/null ||
		fail "tracked path $path no longer exists at $ref" \
			"See where it went: git -C $dir log --oneline --stat $pin..$target -- $path" \
			"Point the track line at the new location, and port anything the move changed."
done

# The conformance macro lists every case by module. Each listed case must also
# be a test function in the module's file; a mismatch means the parser below no
# longer matches upstream's layout.
git -C "$dir" cat-file -e "$target:$list_file" 2>/dev/null ||
	fail "$list_file is missing at $ref" \
		"Upstream moved its conformance suite. Find it with: git -C $dir log --oneline --stat $pin..$target -- $list_file" \
		"Update list_file and module_dir in upstream.sh, and the mirrored layout described in AGENTS.md."
cases=''
for module in "${modules[@]}"; do
	listed=$(git -C "$dir" show "$target:$list_file" | awk -v module="$module" '
		$0 ~ ", " module ":$" { on = 1; next }
		on && /\);/ { exit }
		on { gsub(/[ \t,]/, ""); if ($0 != "") print module "::" $0 }
	' | sort)
	[[ -n $listed ]] ||
		fail "found no $module cases in $list_file at $ref" \
			"The keyline_conformance! macro changed shape. Update the awk parser in upstream.sh."
	defined=$(git -C "$dir" show "$target:$module_dir/$module.rs" 2>/dev/null |
		sed -nE "s/^pub fn ([a-z0-9_]+)<C: Backend>\(\)( \{)?$/$module::\1/p" | sort) ||
		fail "$module_dir/$module.rs is missing at $ref" "Update module_dir or modules in upstream.sh."
	if [[ $listed != "$defined" ]]; then
		{
			echo "upstream.sh: the $module cases listed in $list_file differ from the test functions in $module_dir/$module.rs at $ref:"
			diff <(echo "$listed") <(echo "$defined") | sed -n 's/^</  listed only:/p; s/^>/  defined only:/p' || true
			echo "  hint: If upstream changed how cases are declared, update the parsers in upstream.sh."
			echo "  hint: If upstream really lists a case without a test, or the reverse, report it upstream."
		} >&2
		exit 2
	fi
	cases+="$listed"$'\n'
done
cases=$(sed '/^$/d' <<<"$cases" | sort)

# Markers as "case<TAB>file:line"; skips as "case<TAB>UPSTREAM".
markers=$(grep -rnE --include='*.go' '^[[:space:]]*// upstream:' "$here" |
	sed -E "s|^$here/||; s|^([^:]+:[0-9]+):[[:space:]]*// upstream: *|\1\t|" |
	awk -F'\t' '{ print $2 "\t" $1 }' | sort)
malformed=$(awk -F'\t' -v re="$case_re" '$1 !~ re { print $2 ": \"// upstream: " $1 "\"" }' <<<"$markers")
entries=$(
	awk -F'\t' -v re="$case_re" '$1 ~ re' <<<"$markers"
	for skip in "${skips[@]}"; do printf '%s\tUPSTREAM (skip)\n' "$skip"; done
)
entries=$(sed '/^$/d' <<<"$entries" | sort)
covered=$(cut -f1 <<<"$entries" | sort -u)

log=$(git -C "$dir" log --oneline "$pin..$target" -- "${tracks[@]}")
missing=$(comm -23 <(echo "$cases") <(echo "$covered") | sed '/^$/d')
stale=$(join -t $'\t' -v 2 <(echo "$cases") <(echo "$entries") | sed '/^$/d')
duplicates=$(join -t $'\t' <(cut -f1 <<<"$entries" | uniq -d) <(echo "$entries") | sed '/^$/d')

status=0
echo "# Keyline upstream report"
echo
echo "Pinned ${pin:0:12}; compared with $ref (${target:0:12}) of $repo."

# section <title> <body> <hint> prints a report section, with the hint when the body is nonempty.
section() {
	echo
	echo "## $1"
	echo
	if [[ -z $2 ]]; then
		echo "None."
		return
	fi
	status=1
	echo '```'
	echo "$2"
	echo '```'
	echo
	echo "$3"
}

section "Upstream commits touching tracked paths since the pin" "$log" \
	"Sort each change into authority rules, conformance cases, or out-of-scope work, then follow the bump routine in AGENTS.md. Read a change with \`git -C $dir show <commit> -- ${tracks[*]}\`."
if [[ -n $log ]]; then
	echo
	echo '```'
	git -C "$dir" diff --stat "$pin" "$target" -- "${tracks[@]}"
	echo '```'
fi
section "Upstream cases without a Go marker or skip entry" "$missing" \
	"Port each case (scenarios in keylinetest, laws in keylinetest/conformance/laws.go) with an \`// upstream: <case>\` marker on the test, or add \`skip <case> <reason>\` to UPSTREAM."
section "Markers or skips naming no upstream case" "$stale" \
	"Upstream renamed or removed these cases. Look for the old name with \`git -C $dir log --oneline -S <case-name> $pin..$target -- $module_dir\`, then rename the marker or skip, or remove it with its test."
section "Cases marked or skipped more than once" "$duplicates" \
	"Each case takes exactly one marker or one skip. Remove the extra; a skipped case cannot also be marked."
section "Malformed markers" "$malformed" \
	"A marker must be a whole comment line \`// upstream: <module>::<case>\`, with module one of: ${modules[*]}."

exit $status
