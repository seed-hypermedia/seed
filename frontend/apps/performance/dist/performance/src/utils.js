"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.findLatestBuild = findLatestBuild;
exports.startApp = startApp;
// Import needed modules
const path = __importStar(require("path"));
const utils_1 = require("../../desktop/test/utils");
// Override the findLatestBuild function to point to the correct location
function findLatestBuild() {
    // Import modules inside the function to avoid circular dependencies
    const fs = require("fs");
    // Path to the desktop project where the builds are stored
    const desktopDir = path.resolve(__dirname, "../../desktop");
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
    let allBuilds = [];
    // Search in all directories
    for (const dir of searchDirs) {
        const items = fs.readdirSync(dir);
        console.log(`Found ${items.length} items in ${dir}`);
        // Add items with full path
        allBuilds = allBuilds.concat(items.map((item) => ({
            name: item,
            fullPath: path.join(dir, item),
        })));
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
        .map((item) => {
        // Make sure it's a directory with platform in its name
        const stats = fs.statSync(item.fullPath);
        const nameLower = item.name.toLowerCase();
        const isBuild = platforms.some((platform) => nameLower.includes(platform));
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
        .filter((build) => build !== null)
        .sort((a, b) => b.time - a.time)[0];
    if (!latestBuild) {
        // List what was found to help diagnose issues
        console.log("No valid builds found. Available items:");
        allBuilds.forEach((item) => {
            console.log(` - ${item.name} (${fs.statSync(item.fullPath).isDirectory() ? "dir" : "file"})`);
        });
        throw new Error(`No valid builds found in ${outDir} or ${makeDir}`);
    }
    console.log(`Selected build: ${latestBuild.fullPath}`);
    return latestBuild.fullPath;
}
// Create a modified startApp function that uses our custom findLatestBuild
async function startApp() {
    // Import needed modules
    const _electron = require("@playwright/test")._electron;
    const fs = require("fs");
    // Find the latest build
    const latestBuild = findLatestBuild();
    // Parse the app info
    const appInfo = (0, utils_1.parseElectronApp)(latestBuild);
    // Add debug logging
    console.log("Attempting to launch app with:");
    console.log("- Main:", appInfo.main);
    console.log("- Executable:", appInfo.executable);
    // Check if files exist
    console.log("Checking file existence:");
    console.log("- Main exists:", fs.existsSync(appInfo.main));
    console.log("- Executable exists:", fs.existsSync(appInfo.executable));
    // Check file permissions
    try {
        const execStats = fs.statSync(appInfo.executable);
        console.log("Executable permissions:", (execStats.mode & 0o777).toString(8));
        // Ensure the file is executable
        fs.chmodSync(appInfo.executable, 0o755);
    }
    catch (error) {
        console.error("Error checking/setting executable permissions:", error);
    }
    // Launch the app with additional options for debugging
    const electronApp = await _electron.launch({
        args: [appInfo.main],
        executablePath: appInfo.executable,
        timeout: 30000, // Increase timeout to 30 seconds
        env: {
            ...process.env,
            ELECTRON_ENABLE_LOGGING: "true",
            DEBUG: "*",
        },
    });
    // Wait for the first window to be ready
    console.log("Waiting for first window...");
    const appWindow = await electronApp.firstWindow();
    // Ensure window is loaded
    console.log("Waiting for window to load...");
    await appWindow.waitForLoadState("domcontentloaded");
    console.log("Window loaded successfully");
    return {
        getWindow: async () => await electronApp.firstWindow(),
        appInfo,
        app: electronApp,
        appWindow,
    };
}
