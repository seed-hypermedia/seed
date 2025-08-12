#!/usr/bin/env node

/**
 * Script to count TypeScript compiler directives in the codebase.
 * Tracks @ts-expect-error, @ts-nocheck, and @ts-ignore usage across all files.
 *
 * Usage:
 *   node scripts/count-ts-directives.mjs [--detailed] [--by-type] [--output=json|table|csv]
 *
 * Options:
 *   --detailed    Show file-by-file breakdown
 *   --by-type     Group results by directive type
 *   --output      Output format: json, table, or csv (default: table)
 *   --help        Show this help message
 *
 * The script will:
 * 1. Search for all TypeScript directive patterns
 * 2. Count occurrences by file, type, and total
 * 3. Support multiple comment styles (// and block comments)
 * 4. Output results in requested format for tracking over time
 */

import {execSync} from "child_process";
import {readFileSync, writeFileSync} from "fs";

// TypeScript directives to track
const TS_DIRECTIVES = ["@ts-expect-error", "@ts-nocheck", "@ts-ignore"];

// File extensions to check
const TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

// Comment patterns to match
const COMMENT_PATTERNS = [
  // Single-line comments: // @ts-directive
  /\/\/\s*@ts-(expect-error|nocheck|ignore)(?:\s|$)/g,
  // Multi-line comments: /* @ts-directive */
  /\/\*\s*@ts-(expect-error|nocheck|ignore)(?:\s|\*)/g,
  // JSX comments: {/* @ts-directive */}
  /\{\s*\/\*\s*@ts-(expect-error|nocheck|ignore)(?:\s|\*)/g,
];

function showHelp() {
  console.log(`
TypeScript Directives Counter

Usage: node scripts/count-ts-directives.mjs [options]

Options:
  --detailed      Show file-by-file breakdown
  --by-type       Group results by directive type  
  --output=FORMAT Output format: json, table, or csv (default: table)
  --help          Show this help message

Examples:
  node scripts/count-ts-directives.mjs
  node scripts/count-ts-directives.mjs --detailed --by-type
  node scripts/count-ts-directives.mjs --output=json > ts-directives.json
  node scripts/count-ts-directives.mjs --output=csv > ts-directives.csv
`);
}

function parseArgs() {
  const args = {
    detailed: false,
    byType: false,
    output: "table",
    outputFile: null,
    help: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === "--detailed") {
      args.detailed = true;
    } else if (arg === "--by-type") {
      args.byType = true;
    } else if (arg.startsWith("--output=")) {
      args.output = arg.split("=")[1];
    } else if (arg.startsWith("--output-file=")) {
      args.outputFile = arg.split("=")[1];
    } else if (arg === "--help") {
      args.help = true;
    }
  }

  return args;
}

function getAllTypeScriptFiles() {
  try {
    // Use git to find tracked files, respecting .gitignore
    const gitFiles = execSync("git ls-files", {encoding: "utf8"})
      .split("\n")
      .filter(Boolean);

    return gitFiles.filter((file) =>
      TS_EXTENSIONS.some((ext) => file.endsWith(ext))
    );
  } catch (error) {
    console.error("Error getting git files:", error.message);
    process.exit(1);
  }
}

function countDirectivesInFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    const results = {
      "@ts-expect-error": 0,
      "@ts-nocheck": 0,
      "@ts-ignore": 0,
      lines: [],
    };

    const lines = content.split("\n");

    lines.forEach((line, index) => {
      for (const pattern of COMMENT_PATTERNS) {
        pattern.lastIndex = 0; // Reset regex state
        let match;
        while ((match = pattern.exec(line)) !== null) {
          const directive = `@ts-${match[1]}`;
          results[directive]++;
          results.lines.push({
            line: index + 1,
            directive,
            content: line.trim(),
          });
        }
      }
    });

    return results;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return {
      "@ts-expect-error": 0,
      "@ts-nocheck": 0,
      "@ts-ignore": 0,
      lines: [],
    };
  }
}

function analyzeCodebase(outputMode = "table") {
  if (outputMode !== "json") {
    console.log("🔍 Scanning codebase for TypeScript directives...");
  } else {
    console.error("🔍 Scanning codebase for TypeScript directives...");
  }

  const files = getAllTypeScriptFiles();
  const results = {
    totalFiles: files.length,
    filesWithDirectives: 0,
    totalDirectives: 0,
    byType: {
      "@ts-expect-error": 0,
      "@ts-nocheck": 0,
      "@ts-ignore": 0,
    },
    byExtension: {},
    files: {},
    timestamp: new Date().toISOString(),
  };

  for (const file of files) {
    const fileResults = countDirectivesInFile(file);
    const fileTotal = Object.values(fileResults).reduce((sum, count) => {
      return typeof count === "number" ? sum + count : sum;
    }, 0);

    if (fileTotal > 0) {
      results.filesWithDirectives++;
      results.files[file] = fileResults;

      // Count by type
      for (const directive of TS_DIRECTIVES) {
        results.byType[directive] += fileResults[directive];
        results.totalDirectives += fileResults[directive];
      }

      // Count by extension
      const ext = file.split(".").pop();
      if (!results.byExtension[ext]) {
        results.byExtension[ext] = 0;
      }
      results.byExtension[ext] += fileTotal;
    }
  }

  return results;
}

function outputTable(results, args) {
  console.log("\n📊 TypeScript Directives Summary");
  console.log("=".repeat(50));
  console.log(`Total files scanned: ${results.totalFiles}`);
  console.log(`Files with directives: ${results.filesWithDirectives}`);
  console.log(`Total directives: ${results.totalDirectives}`);
  console.log(`Scan date: ${new Date(results.timestamp).toLocaleString()}`);

  if (args.byType) {
    console.log("\n📈 By Directive Type:");
    console.log("-".repeat(30));
    for (const [directive, count] of Object.entries(results.byType)) {
      const percentage =
        results.totalDirectives > 0
          ? ((count / results.totalDirectives) * 100).toFixed(1)
          : "0.0";
      console.log(
        `${directive.padEnd(20)} ${count
          .toString()
          .padStart(6)} (${percentage}%)`
      );
    }
  }

  if (Object.keys(results.byExtension).length > 0) {
    console.log("\n📁 By File Extension:");
    console.log("-".repeat(30));
    for (const [ext, count] of Object.entries(results.byExtension).sort(
      (a, b) => b[1] - a[1]
    )) {
      const percentage =
        results.totalDirectives > 0
          ? ((count / results.totalDirectives) * 100).toFixed(1)
          : "0.0";
      console.log(
        `.${ext.padEnd(8)} ${count.toString().padStart(6)} (${percentage}%)`
      );
    }
  }

  if (args.detailed) {
    console.log("\n📋 Detailed File Breakdown:");
    console.log("-".repeat(50));

    const sortedFiles = Object.entries(results.files).sort((a, b) => {
      const aTotal = Object.values(a[1]).reduce(
        (sum, count) => (typeof count === "number" ? sum + count : sum),
        0
      );
      const bTotal = Object.values(b[1]).reduce(
        (sum, count) => (typeof count === "number" ? sum + count : sum),
        0
      );
      return bTotal - aTotal;
    });

    for (const [file, fileResults] of sortedFiles) {
      const fileTotal = Object.values(fileResults).reduce(
        (sum, count) => (typeof count === "number" ? sum + count : sum),
        0
      );

      console.log(`\n${file} (${fileTotal} total):`);

      for (const directive of TS_DIRECTIVES) {
        if (fileResults[directive] > 0) {
          console.log(`  ${directive}: ${fileResults[directive]}`);
        }
      }

      // Show first few lines with directives
      if (fileResults.lines.length > 0) {
        const preview = fileResults.lines.slice(0, 3);
        for (const line of preview) {
          console.log(`    Line ${line.line}: ${line.content}`);
        }
        if (fileResults.lines.length > 3) {
          console.log(`    ... and ${fileResults.lines.length - 3} more`);
        }
      }
    }
  }
}

function outputJson(results, outputFile = null) {
  const jsonOutput = JSON.stringify(results, null, 2);

  if (outputFile) {
    // Write directly to file to avoid shell redirection buffer limits
    writeFileSync(outputFile, jsonOutput);
    console.error(`✅ JSON output written to ${outputFile}`);
  } else {
    console.log(jsonOutput);
  }
}

function outputCsv(results) {
  console.log("file,extension,ts-expect-error,ts-nocheck,ts-ignore,total");

  for (const [file, fileResults] of Object.entries(results.files)) {
    const ext = file.split(".").pop();
    const total = Object.values(fileResults).reduce(
      (sum, count) => (typeof count === "number" ? sum + count : sum),
      0
    );

    console.log(
      `"${file}",${ext},${fileResults["@ts-expect-error"]},${fileResults["@ts-nocheck"]},${fileResults["@ts-ignore"]},${total}`
    );
  }
}

function main() {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (!["json", "table", "csv"].includes(args.output)) {
    console.error("Error: --output must be one of: json, table, csv");
    process.exit(1);
  }

  const results = analyzeCodebase(args.output);

  switch (args.output) {
    case "json":
      outputJson(results, args.outputFile);
      break;
    case "csv":
      outputCsv(results);
      break;
    case "table":
    default:
      outputTable(results, args);
      break;
  }

  // Exit with non-zero code if directives found (for CI)
  if (results.totalDirectives > 0) {
    process.exit(0); // Don't fail by default, just report
  }
}

main();
