#!/usr/bin/env node

/**
 * Script to check for new TypeScript compiler directives in changed code.
 * Prevents new additions of @ts-expect-error, @ts-nocheck, and @ts-ignore.
 *
 * Usage:
 *   node scripts/check-ts-directives.mjs [--base-branch=main]
 *
 * The script will:
 * 1. Get the git diff for changed files
 * 2. Check only added lines (prefixed with +)
 * 3. Search for banned TypeScript directives
 * 4. Exit with error code 1 if any are found
 */

import {execSync} from "child_process";
import {exit} from "process";

// TypeScript directives to check for
const BANNED_DIRECTIVES = ["@ts-expect-error", "@ts-nocheck", "@ts-ignore"];

// File extensions to check
const TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function getBaseBranch() {
  const argBaseBranch = process.argv.find((arg) =>
    arg.startsWith("--base-branch=")
  );
  if (argBaseBranch) {
    return argBaseBranch.split("=")[1];
  }

  // Default to main, but try to detect the default branch
  try {
    const defaultBranch = execSync(
      "git symbolic-ref refs/remotes/origin/HEAD",
      {encoding: "utf8"}
    )
      .trim()
      .replace("refs/remotes/origin/", "");
    return defaultBranch;
  } catch {
    return "main";
  }
}

function isTypeScriptFile(filename) {
  return TS_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

function getGitDiff() {
  const baseBranch = getBaseBranch();

  try {
    // Try to get diff against base branch first (for PRs)
    try {
      return execSync(`git diff ${baseBranch}...HEAD`, {encoding: "utf8"});
    } catch {
      // If that fails, try against origin/main
      try {
        return execSync(`git diff origin/${baseBranch}...HEAD`, {
          encoding: "utf8",
        });
      } catch {
        // If still fails, get staged changes + working directory changes
        const staged = execSync("git diff --cached", {encoding: "utf8"});
        const unstaged = execSync("git diff", {encoding: "utf8"});
        return staged + "\n" + unstaged;
      }
    }
  } catch (error) {
    console.error("Failed to get git diff:", error.message);
    exit(1);
  }
}

function parseDiff(diff) {
  const violations = [];
  const lines = diff.split("\n");
  let currentFile = null;
  let lineNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track current file being processed
    if (line.startsWith("+++")) {
      currentFile = line.substring(4).replace(/^b\//, "");
      lineNumber = 0;
      continue;
    }

    // Track line numbers for added lines
    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)/);
      if (match) {
        lineNumber = parseInt(match[1]) - 1;
      }
      continue;
    }

    // Only check added lines in TypeScript/JavaScript files
    if (line.startsWith("+") && currentFile && isTypeScriptFile(currentFile)) {
      lineNumber++;
      const content = line.substring(1); // Remove the + prefix

      // Check for banned directives
      for (const directive of BANNED_DIRECTIVES) {
        if (content.includes(directive)) {
          violations.push({
            file: currentFile,
            line: lineNumber,
            directive: directive,
            content: content.trim(),
          });
        }
      }
    } else if (!line.startsWith("-")) {
      // Only increment line number for non-removed lines
      lineNumber++;
    }
  }

  return violations;
}

function main() {
  console.log("🔍 Checking for new TypeScript compiler directives...");

  const diff = getGitDiff();

  if (!diff.trim()) {
    console.log("✅ No changes detected, skipping check");
    exit(0);
  }

  const violations = parseDiff(diff);

  if (violations.length === 0) {
    console.log("✅ No new TypeScript directives found");
    exit(0);
  }

  console.error("❌ Found new TypeScript compiler directives in changed code:");
  console.error("");

  violations.forEach((violation) => {
    console.error(`  ${violation.file}:${violation.line}`);
    console.error(`    Found: ${violation.directive}`);
    console.error(`    Line: ${violation.content}`);
    console.error("");
  });

  console.error(`Found ${violations.length} violation(s).`);
  console.error("");
  console.error(
    "TypeScript compiler directives like @ts-expect-error, @ts-nocheck, and @ts-ignore"
  );
  console.error(
    "should be avoided in new code. Please fix the underlying TypeScript errors instead."
  );
  console.error("");
  console.error("If you absolutely must use these directives:");
  console.error("1. Fix the TypeScript error properly if possible");
  console.error(
    "2. Add detailed comments explaining why the directive is necessary"
  );
  console.error(
    "3. Consider if the code can be refactored to avoid the need for the directive"
  );

  exit(1);
}

main();
