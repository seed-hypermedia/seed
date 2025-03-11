#!/usr/bin/env node

/**
 * This script copies performance results from the performance app directory
 * to the performance-dashboard's public folder for easy access
 */

import * as fs from "fs";
import * as path from "path";
import {fileURLToPath} from "url";

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Source and destination paths
const sourceDir = path.resolve(__dirname, "../performance/performance-results");
const destDir = path.resolve(__dirname, "public/performance-results");

// Create destination directory if it doesn't exist
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, {recursive: true});
  console.log(`Created directory: ${destDir}`);
}

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

try {
  if (!fs.existsSync(sourceDir)) {
    console.warn(`Source directory does not exist: ${sourceDir}`);
    console.log("No performance results to copy.");
    process.exit(0);
  }

  // Copy performance results directory
  copyDirRecursive(sourceDir, destDir);
  console.log(`Successfully copied performance results from:`);
  console.log(`  ${sourceDir}`);
  console.log(`to:`);
  console.log(`  ${destDir}`);
} catch (error) {
  console.error("Error copying performance results:", error);
  process.exit(1);
}
