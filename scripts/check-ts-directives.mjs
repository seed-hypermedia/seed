#!/usr/bin/env node

/**
 * Script to check for new TypeScript compiler directives in changed code.
 * Prevents net new additions of @ts-expect-error, @ts-nocheck, and @ts-ignore.
 *
 * Usage:
 *   node scripts/check-ts-directives.mjs [--base-branch=main]
 *
 * The script will:
 * 1. Get the git diff for changed files
 * 2. For each file, count directive occurrences on added (+) vs removed (-)
 *    lines and flag only the net positive — directives that were merely
 *    moved (e.g. by a JSX wrapper refactor) net to zero and pass
 * 3. Skip files under /.generated/ or /generated/ paths, since
 *    protoc-gen-es emits `// @ts-nocheck` in every file it writes
 * 4. Exit with error code 1 if any net new violations remain
 */

import {execSync} from 'child_process'
import {exit} from 'process'

// TypeScript directives to check for
const BANNED_DIRECTIVES = ['@ts-expect-error', '@ts-nocheck', '@ts-ignore']

// File extensions to check
const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

// Path fragments identifying auto-generated code. The protoc-gen-es generator
// always emits `// @ts-nocheck` at the top of every file it writes, so any
// regen produces "new" directives that aren't hand-written and shouldn't
// block CI.
const GENERATED_PATH_FRAGMENTS = ['/.generated/', '/generated/']

function getBaseBranch() {
  const argBaseBranch = process.argv.find((arg) => arg.startsWith('--base-branch='))
  if (argBaseBranch) {
    return argBaseBranch.split('=')[1]
  }

  // Default to main, but try to detect the default branch
  try {
    const defaultBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD', {encoding: 'utf8'})
      .trim()
      .replace('refs/remotes/origin/', '')
    return defaultBranch
  } catch {
    return 'main'
  }
}

function isTypeScriptFile(filename) {
  return TS_EXTENSIONS.some((ext) => filename.endsWith(ext))
}

function isGeneratedFile(filename) {
  const normalized = '/' + filename.replace(/^\.\//, '')
  return GENERATED_PATH_FRAGMENTS.some((frag) => normalized.includes(frag))
}

function getGitDiff() {
  const baseBranch = getBaseBranch()

  try {
    // Try to get diff against base branch first (for PRs)
    try {
      return execSync(`git diff ${baseBranch}...HEAD`, {encoding: 'utf8'})
    } catch {
      // If that fails, try against origin/main
      try {
        return execSync(`git diff origin/${baseBranch}...HEAD`, {
          encoding: 'utf8',
        })
      } catch {
        // If still fails, get staged changes + working directory changes
        const staged = execSync('git diff --cached', {encoding: 'utf8'})
        const unstaged = execSync('git diff', {encoding: 'utf8'})
        return staged + '\n' + unstaged
      }
    }
  } catch (error) {
    console.error('Failed to get git diff:', error.message)
    exit(1)
  }
}

// Walk a unified diff and compute, per file, how many times each banned
// directive was added vs removed, plus the list of added-line locations.
// A directive only counts as a violation when its net count (added minus
// removed) is positive — moving a directive within a file or splitting a
// component out shows up as a wash and is ignored.
function parseDiff(diff) {
  const perFile = new Map()

  function ensure(file) {
    let entry = perFile.get(file)
    if (!entry) {
      entry = {
        added: Object.fromEntries(BANNED_DIRECTIVES.map((d) => [d, 0])),
        removed: Object.fromEntries(BANNED_DIRECTIVES.map((d) => [d, 0])),
        addedLines: Object.fromEntries(BANNED_DIRECTIVES.map((d) => [d, []])),
      }
      perFile.set(file, entry)
    }
    return entry
  }

  const lines = diff.split('\n')
  let currentFile = null
  let skipFile = false
  let lineNumber = 0

  for (const line of lines) {
    if (line.startsWith('+++')) {
      currentFile = line.substring(4).replace(/^b\//, '')
      // `+++ /dev/null` happens for deletions — nothing to check.
      skipFile = currentFile === '/dev/null' || !isTypeScriptFile(currentFile) || isGeneratedFile(currentFile)
      lineNumber = 0
      continue
    }

    if (line.startsWith('@@')) {
      const match = line.match(/\+(\d+)/)
      if (match) {
        lineNumber = parseInt(match[1], 10) - 1
      }
      continue
    }

    if (skipFile || !currentFile) continue

    if (line.startsWith('+') && !line.startsWith('+++')) {
      lineNumber++
      const content = line.substring(1)
      const entry = ensure(currentFile)
      for (const directive of BANNED_DIRECTIVES) {
        if (content.includes(directive)) {
          entry.added[directive]++
          entry.addedLines[directive].push({
            line: lineNumber,
            content: content.trim(),
          })
        }
      }
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      const content = line.substring(1)
      const entry = ensure(currentFile)
      for (const directive of BANNED_DIRECTIVES) {
        if (content.includes(directive)) {
          entry.removed[directive]++
        }
      }
    } else {
      lineNumber++
    }
  }

  const violations = []
  for (const [file, entry] of perFile) {
    for (const directive of BANNED_DIRECTIVES) {
      const net = entry.added[directive] - entry.removed[directive]
      if (net > 0) {
        // Report the last `net` added occurrences — those are the ones
        // that couldn't be paired with a removal in this hunk.
        const tail = entry.addedLines[directive].slice(-net)
        for (const loc of tail) {
          violations.push({file, directive, ...loc})
        }
      }
    }
  }
  return violations
}

function main() {
  console.log('🔍 Checking for new TypeScript compiler directives...')

  const diff = getGitDiff()

  if (!diff.trim()) {
    console.log('✅ No changes detected, skipping check')
    exit(0)
  }

  const violations = parseDiff(diff)

  if (violations.length === 0) {
    console.log('✅ No new TypeScript directives found')
    exit(0)
  }

  console.error('❌ Found new TypeScript compiler directives in changed code:')
  console.error('')

  violations.forEach((violation) => {
    console.error(`  ${violation.file}:${violation.line}`)
    console.error(`    Found: ${violation.directive}`)
    console.error(`    Line: ${violation.content}`)
    console.error('')
  })

  console.error(`Found ${violations.length} violation(s).`)
  console.error('')
  console.error('TypeScript compiler directives like @ts-expect-error, @ts-nocheck, and @ts-ignore')
  console.error('should be avoided in new code. Please fix the underlying TypeScript errors instead.')
  console.error('')
  console.error('If you absolutely must use these directives:')
  console.error('1. Fix the TypeScript error properly if possible')
  console.error('2. Add detailed comments explaining why the directive is necessary')
  console.error('3. Consider if the code can be refactored to avoid the need for the directive')

  exit(1)
}

main()
