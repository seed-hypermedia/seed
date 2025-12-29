#!/usr/bin/env node
import {execSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const WORKSPACES = [
  {name: "@shm/shared", dir: "frontend/packages/shared"},
  {name: "@shm/ui", dir: "frontend/packages/ui"},
  {name: "@shm/editor", dir: "frontend/packages/editor"},
  {name: "@shm/desktop", dir: "frontend/apps/desktop"},
  {name: "@shm/web", dir: "frontend/apps/web"},
  {name: "@shm/emails", dir: "frontend/apps/emails"},
];

const errorLineRegex = /^(.*?\.(?:ts|tsx))\((\d+),(\d+)\): error TS(\d+):/i;

function resolveFilePath(workspace, fileRel) {
  if (path.isAbsolute(fileRel)) return fileRel;
  const base = path.resolve(repoRoot, workspace.dir);
  return path.resolve(base, fileRel);
}

function fileExists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readLines(p) {
  return fs.readFileSync(p, "utf8").split(/\r?\n/);
}

function writeLines(p, lines) {
  fs.writeFileSync(p, lines.join("\n"));
}

function convertExpectErrorToIgnore(filePath, lineNumber) {
  const lines = readLines(filePath);
  const idx = lineNumber - 1;
  if (idx < 0 || idx >= lines.length) return false;
  let line = lines[idx];
  if (line.includes("@ts-expect-error")) {
    line = line.replace("@ts-expect-error", "@ts-ignore");
    lines[idx] = line;
    writeLines(filePath, lines);
    return true;
  }
  // Try previous line too (common when the directive is above the failing code)
  if (idx - 1 >= 0 && lines[idx - 1].includes("@ts-expect-error")) {
    lines[idx - 1] = lines[idx - 1].replace("@ts-expect-error", "@ts-ignore");
    writeLines(filePath, lines);
    return true;
  }
  return false;
}

function insertExpectError(filePath, lineNumber) {
  const lines = readLines(filePath);
  const idx = Math.max(0, Math.min(lines.length, lineNumber - 1));
  const ext = path.extname(filePath);
  const directive = "// @ts-expect-error";
  // Insert above the failing line
  lines.splice(idx, 0, directive);
  writeLines(filePath, lines);
}

function runWorkspaceTypecheck(wsName) {
  try {
    const out = execSync(`pnpm --filter ${wsName} typecheck`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out;
  } catch (e) {
    // Even on non-zero exit, capture stdout+stderr
    const out = (e.stdout || "") + (e.stderr || "");
    return out;
  }
}

function suppressForWorkspace(workspace) {
  const output = runWorkspaceTypecheck(workspace.name);
  const lines = output.split(/\r?\n/);
  let changes = 0;
  for (const l of lines) {
    const m = l.match(errorLineRegex);
    if (!m) continue;
    const [, fileRel, lineStr, , codeStr] = m;
    const lineNum = parseInt(lineStr, 10);
    const code = parseInt(codeStr, 10);
    const absPath = resolveFilePath(workspace, fileRel);
    if (!fileExists(absPath)) continue;
    if (code === 2578) {
      // Unused '@ts-expect-error' -> convert to @ts-ignore
      if (convertExpectErrorToIgnore(absPath, lineNum)) {
        changes++;
      }
    } else {
      insertExpectError(absPath, lineNum);
      changes++;
    }
  }
  return changes;
}

function main() {
  let total = 0;
  // Iterate a few times to converge (in case new TS2578 appears after insertions)
  for (let pass = 0; pass < 3; pass++) {
    let passChanges = 0;
    for (const ws of WORKSPACES) {
      passChanges += suppressForWorkspace(ws);
    }
    total += passChanges;
    if (passChanges === 0) break;
    console.log(`[suppress] pass ${pass + 1} changes: ${passChanges}`);
  }
  console.log(`[suppress] total changes: ${total}`);
}

main();
