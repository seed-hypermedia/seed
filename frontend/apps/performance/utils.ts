// Import needed modules
import * as path from "path";
import {parseElectronApp} from "../desktop/test/utils";

// Define interfaces needed for type safety
interface BuildInfo {
  name: string;
  time: number;
}

// Override the findLatestBuild function to point to the correct location
export function findLatestBuild(): string {
  // Import modules inside the function to avoid circular dependencies
  const fs = require("fs");

  // Path to the desktop project where the builds are stored
  const desktopDir = path.resolve(__dirname, "../desktop");
  // Directory where the builds are stored
  const outDir = path.join(desktopDir, "out");

  // Check if directory exists
  if (!fs.existsSync(outDir)) {
    throw new Error(`Desktop app build directory not found: ${outDir}`);
  }

  // List files in the out directory
  const builds = fs.readdirSync(outDir);

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

  const latestBuild = builds
    .map((fileName: string) => {
      // Make sure it's a directory with platform in its name
      const stats = fs.statSync(path.join(outDir, fileName));
      const isBuild = fileName
        .toLocaleLowerCase()
        .split("-")
        .some((part: string) => platforms.includes(part));
      if (stats.isDirectory() && isBuild) {
        return {
          name: fileName,
          time: fs.statSync(path.join(outDir, fileName)).mtimeMs,
        } as BuildInfo;
      }
      return null;
    })
    .filter(Boolean)
    .sort((a: BuildInfo, b: BuildInfo) => b.time - a.time)
    .map((file: BuildInfo) => file.name)[0];

  if (!latestBuild) {
    throw new Error(
      `No build found in directory: ${outDir}. Make sure to build the desktop app first.`
    );
  }

  return path.join(outDir, latestBuild);
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

  const windows = electronApp.windows();
  const appWindow = windows[0];

  return {
    getWindow: async () => await electronApp.firstWindow(),
    appInfo,
    app: electronApp,
    appWindow,
  };
}
