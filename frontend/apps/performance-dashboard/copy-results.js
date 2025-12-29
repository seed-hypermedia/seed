#!/usr/bin/env node

/**
 * This script copies performance results from both the performance app directory
 * and the perf-web app directory to the performance-dashboard's public folder
 */

import {execSync} from "child_process";
import * as fs from "fs";
import * as path from "path";
import {fileURLToPath} from "url";

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Source and destination paths for electron performance
const electronSourceDir = path.resolve(__dirname, "../performance/results");
const electronDestDir = path.resolve(__dirname, "public/results/electron");

// Source and destination paths for web performance
const webSourceDir = path.resolve(__dirname, "../perf-web/results");
const webDestDir = path.resolve(__dirname, "public/results");

// Also copy to dist directory if it exists (for builds)
const distDir = path.resolve(__dirname, "dist");
const electronDistDir = path.resolve(distDir, "results/electron");
const webDistDir = path.resolve(distDir, "results");

// Create destination directories if they don't exist
[electronDestDir, webDestDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
    console.log(`Created directory: ${dir}`);
  }
});

/**
 * Copy a directory recursively
 * @param {string} src Source path
 * @param {string} dest Destination path
 */
function copyDirRecursive(src, dest) {
  // Create destination directory if it doesn't exist
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, {recursive: true});
  }

  // Get all items in the source directory
  const entries = fs.readdirSync(src, {withFileTypes: true});

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      // Recursively copy subdirectory
      copyDirRecursive(srcPath, destPath);
    } else {
      // Copy file
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Generate index.json file for electron performance results
 * @param {string} electronDestDir Destination directory for electron results
 */
function generateElectronIndex(electronDestDir) {
  try {
    // Find all perf-metrics JSON files
    const files = fs.readdirSync(electronDestDir);
    const perfFiles = files.filter(
      (file) => file.startsWith("perf-metrics-") && file.endsWith(".json")
    );

    const reports = perfFiles.map((file) => {
      const filePath = path.join(electronDestDir, file);
      const content = JSON.parse(fs.readFileSync(filePath, "utf8"));

      // Extract timestamp from filename or use the one in the file
      const timestamp = content.timestamp;
      const id = timestamp.replace(/:/g, "-").replace(/\./g, "-");

      // Count scenarios for summary
      const scenarios = Object.keys(content.metrics || {});

      return {
        id: id,
        date: timestamp,
        file: file,
        summary: {
          totalScenarios: scenarios.length,
          passedBudgets: 0, // We don't have budget info in the current format
          failedBudgets: 0,
        },
      };
    });

    // Sort reports by date (newest first)
    reports.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Create index file
    const indexData = {
      reports: reports,
      lastUpdated: new Date().toISOString(),
    };

    const indexPath = path.join(electronDestDir, "index.json");
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
    console.log(`Generated electron index file with ${reports.length} reports`);
  } catch (error) {
    console.error("Error generating electron index file:", error);
  }
}

try {
  // Copy electron performance results
  if (fs.existsSync(electronSourceDir)) {
    copyDirRecursive(electronSourceDir, electronDestDir);
    console.log(`Successfully copied electron performance results from:`);
    console.log(`  ${electronSourceDir}`);
    console.log(`to:`);
    console.log(`  ${electronDestDir}`);

    // Generate index file for electron performance results
    console.log("Generating index file for electron performance results...");
    generateElectronIndex(electronDestDir);
  } else {
    console.warn(
      `Electron performance results directory does not exist: ${electronSourceDir}`
    );
  }

  // Copy web performance results
  if (fs.existsSync(webSourceDir)) {
    copyDirRecursive(webSourceDir, webDestDir);
    console.log(`Successfully copied web performance results from:`);
    console.log(`  ${webSourceDir}`);
    console.log(`to:`);
    console.log(`  ${webDestDir}`);

    // Generate index files for web performance results
    console.log("Generating index files for web performance results...");
    execSync("pnpm generate-index", {
      cwd: path.resolve(__dirname, "../perf-web"),
      stdio: "inherit",
    });
  } else {
    console.warn(
      `Web performance results directory does not exist: ${webSourceDir}`
    );
  }

  // Also copy to dist directory if it exists (for post-build scenario)
  if (fs.existsSync(distDir)) {
    if (fs.existsSync(electronSourceDir)) {
      copyDirRecursive(electronSourceDir, electronDistDir);
      console.log(`Also copied electron results to:`);
      console.log(`  ${electronDistDir}`);
    }
    if (fs.existsSync(webSourceDir)) {
      copyDirRecursive(webSourceDir, webDistDir);
      console.log(`Also copied web results to:`);
      console.log(`  ${webDistDir}`);
    }
  }
} catch (error) {
  console.error("Error copying performance results:", error);
  process.exit(1);
}
