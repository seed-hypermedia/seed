// Import needed modules
import * as path from "path";
import {parseElectronApp} from "../desktop/test/utils";

// Define interfaces needed for type safety
interface BuildInfo {
  name: string;
  time: number;
  fullPath: string;
}

interface BuildItem {
  name: string;
  fullPath: string;
}

// Override the findLatestBuild function to point to the correct location
export function findLatestBuild(): string {
  // Import modules inside the function to avoid circular dependencies
  const fs = require("fs");

  // Path to the desktop project where the builds are stored
  const desktopDir = path.resolve(__dirname, "../desktop");
  // Directory where the builds are stored
  const outDir = path.join(desktopDir, "out");

  // Add debug logging
  console.log(`Looking for builds in: ${outDir}`);

  // Check if directory exists
  if (!fs.existsSync(outDir)) {
    throw new Error(`Desktop app build directory not found: ${outDir}`);
  }

  // Look in out and out/make directories
  let searchDirs = [outDir];
  const makeDir = path.join(outDir, "make");
  if (fs.existsSync(makeDir)) {
    searchDirs.push(makeDir);
    console.log(`Also looking in: ${makeDir}`);
  }

  let allBuilds: BuildItem[] = [];

  // Search in all directories
  for (const dir of searchDirs) {
    const items = fs.readdirSync(dir);
    console.log(`Found ${items.length} items in ${dir}`);

    // Add items with full path
    allBuilds = allBuilds.concat(
      items.map((item: string) => ({
        name: item,
        fullPath: path.join(dir, item),
      }))
    );
  }

  const platforms = [
    "win32",
    "win",
    "windows",
    "darwin",
    "mac",
    "macos",
    "osx",
    "linux",
    "ubuntu",
  ];

  // Debug log
  console.log(`Processing ${allBuilds.length} potential builds`);

  const latestBuild = allBuilds
    .map((item): BuildInfo | null => {
      // Make sure it's a directory with platform in its name
      const stats = fs.statSync(item.fullPath);
      const nameLower = item.name.toLowerCase();
      const isBuild = platforms.some((platform) =>
        nameLower.includes(platform)
      );

      if (stats.isDirectory() && isBuild) {
        console.log(`Found valid build: ${item.name} at ${item.fullPath}`);
        return {
          name: item.name,
          fullPath: item.fullPath,
          time: stats.mtimeMs,
        };
      }
      return null;
    })
    .filter((build): build is BuildInfo => build !== null)
    .sort((a, b) => b.time - a.time)[0];

  if (!latestBuild) {
    // List what was found to help diagnose issues
    console.log("No valid builds found. Available items:");
    allBuilds.forEach((item) => {
      console.log(
        ` - ${item.name} (${
          fs.statSync(item.fullPath).isDirectory() ? "dir" : "file"
        })`
      );
    });
    throw new Error(`No valid builds found in ${outDir} or ${makeDir}`);
  }

  console.log(`Selected build: ${latestBuild.fullPath}`);
  return latestBuild.fullPath;
}

// Create a modified startApp function that uses our custom findLatestBuild
export async function startApp() {
  // Import needed modules
  const _electron = require("@playwright/test")._electron;

  // Find the latest build
  const latestBuild = findLatestBuild();
  // Parse the app info
  const appInfo = parseElectronApp(latestBuild);

  // Launch the app
  const electronApp = await _electron.launch({
    args: [appInfo.main],
    executablePath: appInfo.executable,
  });

  // Wait for the first window to be ready
  const appWindow = await electronApp.firstWindow();

  // Ensure window is loaded
  await appWindow.waitForLoadState("domcontentloaded");

  return {
    getWindow: async () => await electronApp.firstWindow(),
    appInfo,
    app: electronApp,
    appWindow,
  };
}
