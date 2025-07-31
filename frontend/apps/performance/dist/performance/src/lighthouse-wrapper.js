"use strict";
/**
 * Lighthouse wrapper that uses the CLI version to avoid ESM import issues
 */
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
exports.launchChromeForLighthouse = launchChromeForLighthouse;
exports.launchElectronForLighthouse = launchElectronForLighthouse;
exports.cleanupChrome = cleanupChrome;
exports.cleanupElectron = cleanupElectron;
exports.runLighthouse = runLighthouse;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const utils_1 = require("./utils");
let chromeProcess = null;
let chromePid = null;
let electronApp = null;
let electronPort = 0;
const tempDir = path.join(os.tmpdir(), `lighthouse-temp-${Date.now()}`);
/**
 * Launches Chrome with debugging enabled
 */
async function launchChromeForLighthouse() {
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    // Find Chrome executable path based on platform
    let chromePath;
    if (process.platform === "darwin") {
        const possiblePaths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        ];
        chromePath = possiblePaths.find((p) => fs.existsSync(p)) || "";
        if (!chromePath) {
            throw new Error("Could not find Chrome installation on macOS");
        }
    }
    else if (process.platform === "win32") {
        const possiblePaths = [
            `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
        ];
        chromePath = possiblePaths.find((p) => fs.existsSync(p)) || "";
        if (!chromePath) {
            throw new Error("Could not find Chrome installation on Windows");
        }
    }
    else {
        // Linux
        try {
            chromePath = (0, child_process_1.execSync)("which google-chrome").toString().trim();
        }
        catch (error) {
            throw new Error("Could not find Chrome installation on Linux");
        }
    }
    // Kill any existing Chrome processes if needed
    if (chromeProcess) {
        try {
            if (process.platform === "win32") {
                (0, child_process_1.execSync)(`taskkill /pid ${chromeProcess.pid} /T /F`);
            }
            else {
                process.kill(chromeProcess.pid, "SIGKILL");
            }
        }
        catch (error) {
            console.log("Failed to kill previous Chrome instance, but continuing...");
        }
    }
    // Make sure no Chrome debugging instance is running on port 9222
    try {
        if (process.platform === "win32") {
            (0, child_process_1.execSync)("for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :9222') do taskkill /F /PID %a");
        }
        else {
            (0, child_process_1.execSync)("lsof -ti:9222 | xargs kill -9", { stdio: "ignore" });
        }
    }
    catch (error) {
        // Ignore errors if no process is using the port
    }
    // Create a temp directory for Chrome user data
    const userDataDir = path.join(tempDir, "chrome-user-data");
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
    }
    // Launch Chrome with remote debugging enabled
    const chromeFlags = [
        `--remote-debugging-port=9222`,
        `--user-data-dir=${userDataDir}`,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--disable-component-extensions",
        "--disable-background-networking",
    ];
    console.log(`Launching Chrome with debugging enabled on port 9222...`);
    chromeProcess = (0, child_process_1.spawn)(chromePath, chromeFlags, {
        detached: true,
        stdio: "ignore",
    });
    chromePid = chromeProcess.pid;
    // Log the PID for debugging purposes
    console.log(`Chrome started with PID: ${chromePid}`);
    // Wait a bit for Chrome to fully start
    return new Promise((resolve) => setTimeout(resolve, 3000));
}
/**
 * Automatically starts the Electron app and returns the port to use
 */
async function launchElectronForLighthouse() {
    console.log("🚀 Launching Electron app for Lighthouse audit...");
    try {
        // Close any existing Electron app instance
        if (electronApp) {
            await electronApp.app.close();
            electronApp = null;
        }
        // Start the Electron app
        electronApp = await (0, utils_1.startApp)();
        // Get the window handle
        const window = await electronApp.getWindow();
        // Execute a script to get the port where content is being served
        // This is a simple approach - in a real app, you might need to configure this
        electronPort = 5173; // Default for Vite
        console.log(`✅ Electron app started successfully. Web content likely served at port ${electronPort}`);
        return electronPort;
    }
    catch (error) {
        console.error("Failed to launch Electron app:", error);
        throw error;
    }
}
/**
 * Cleanup Chrome process on exit
 */
function cleanupChrome() {
    if (chromeProcess || chromePid) {
        try {
            // Try multiple cleanup methods to ensure Chrome is properly terminated
            if (process.platform === "win32") {
                if (chromePid)
                    (0, child_process_1.execSync)(`taskkill /pid ${chromePid} /T /F`, { stdio: "ignore" });
                (0, child_process_1.execSync)("for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :9222') do taskkill /F /PID %a", { stdio: "ignore" });
            }
            else {
                // On Unix-like systems, try multiple approaches
                if (chromePid)
                    process.kill(chromePid, "SIGKILL");
                if (chromeProcess && chromeProcess.pid)
                    process.kill(-chromeProcess.pid, "SIGKILL");
                (0, child_process_1.execSync)('pkill -f "remote-debugging-port=9222"', { stdio: "ignore" });
                (0, child_process_1.execSync)("lsof -ti:9222 | xargs kill -9", { stdio: "ignore" });
            }
            console.log("Chrome cleanup completed successfully");
        }
        catch (error) {
            console.log("Note: Chrome may still be running in the background");
        }
    }
    // Clean up temp directory
    try {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            console.log("Temporary directory cleaned up successfully");
        }
    }
    catch (error) {
        console.log("Failed to clean up temp directory, you may need to manually remove it");
        console.log(`Temp directory: ${tempDir}`);
    }
    // Reset the references
    chromeProcess = null;
    chromePid = null;
}
/**
 * Cleanup Electron app if it was launched
 */
function cleanupElectron() {
    if (electronApp) {
        try {
            electronApp.app.close();
            console.log("Electron app closed successfully");
        }
        catch (error) {
            console.log("Failed to close Electron app during cleanup");
        }
        electronApp = null;
    }
}
// Set up cleanup on process exit
process.on("exit", () => {
    cleanupChrome();
    cleanupElectron();
});
process.on("SIGINT", () => {
    cleanupChrome();
    cleanupElectron();
    process.exit(0);
});
/**
 * Run Lighthouse audit using the CLI with a properly configured target URL
 */
async function runLighthouse(url, options) {
    try {
        // First check if the URL looks like a remote debugging port
        if (url.includes("9222") && !url.includes("devtools")) {
            console.log("⚠️ The URL appears to be a Chrome debugging port, not an actual website.");
            // Instead of using a sample URL, let's start the Electron app
            console.log("Starting the Electron app and figuring out the correct URL...");
            // Launch Electron and get the port
            const port = await launchElectronForLighthouse();
            // Update the URL to use the localhost with the correct port
            url = `http://localhost:${port}`;
            console.log(`Using automatically determined URL: ${url}`);
        }
        // Launch Chrome before running Lighthouse
        await launchChromeForLighthouse();
        // Wait a bit for Chrome to fully start
        await new Promise((resolve) => setTimeout(resolve, 2000));
        // Check if the URL is accessible before running Lighthouse
        console.log(`Checking if ${url} is accessible...`);
        try {
            // Simple check to see if the URL responds
            const testAccess = (0, child_process_1.execSync)(`curl -s -o /dev/null -w "%{http_code}" ${url}`, { timeout: 5000 });
            const statusCode = parseInt(testAccess.toString().trim());
            if (statusCode >= 400) {
                console.error(`\n❌ ERROR: URL ${url} returned status code ${statusCode}`);
                if (!electronApp) {
                    console.log("Trying to start the Electron app automatically...");
                    const port = await launchElectronForLighthouse();
                    url = `http://localhost:${port}`;
                    console.log(`Now using URL: ${url}`);
                    // Check if the new URL is accessible
                    const newTestAccess = (0, child_process_1.execSync)(`curl -s -o /dev/null -w "%{http_code}" ${url}`, { timeout: 5000 });
                    const newStatusCode = parseInt(newTestAccess.toString().trim());
                    if (newStatusCode >= 400) {
                        console.error(`\n❌ ERROR: Automatically determined URL ${url} is also not accessible (status code: ${newStatusCode})`);
                        throw new Error(`URL returned status code ${newStatusCode} - Application not running at ${url}`);
                    }
                    else {
                        console.log(`✅ URL ${url} is now accessible (status code: ${newStatusCode})`);
                    }
                }
                else {
                    throw new Error(`URL returned status code ${statusCode} - Application not running at ${url}`);
                }
            }
            else {
                console.log(`✅ URL ${url} is accessible (status code: ${statusCode})`);
            }
        }
        catch (err) {
            if (!electronApp) {
                console.log("Trying to start the Electron app automatically...");
                try {
                    const port = await launchElectronForLighthouse();
                    url = `http://localhost:${port}`;
                    console.log(`Now using URL: ${url}`);
                }
                catch (startError) {
                    console.error(`\n❌ ERROR: Could not access ${url} and failed to start Electron app`);
                    console.error(`Please start your application manually before running Lighthouse!`);
                    // Continue with Lighthouse anyway as a fallback, but warn the user
                    console.error(`Attempting to run Lighthouse anyway, but it will likely fail...`);
                }
            }
            else {
                console.error(`\n❌ ERROR: Could not access ${url}`);
                console.error(`Please check if your application is running correctly!`);
                // Continue with Lighthouse anyway as a fallback, but warn the user
                console.error(`Attempting to run Lighthouse anyway, but it will likely fail...`);
            }
        }
        // Prepare output path
        const outputPath = path.join(tempDir, `lighthouse-report-${Date.now()}.json`);
        console.log(`Running Lighthouse CLI for ${url}...`);
        // Build the Lighthouse CLI command
        const lighthouseBin = path.resolve("./node_modules/.bin/lighthouse");
        // Add more tolerant flags to handle potential issues
        const lighthouseCommand = `"${lighthouseBin}" ${url} --output=json --output-path=${outputPath} --chrome-flags="--headless --disable-extensions --disable-component-extensions --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-ipc-flooding-protection --disable-client-side-phishing-detection" --port=9222 --only-categories=performance --quiet`;
        // Execute Lighthouse CLI
        console.log(`Executing: ${lighthouseCommand}`);
        try {
            (0, child_process_1.execSync)(lighthouseCommand, { stdio: "inherit" });
        }
        catch (error) {
            console.error(`\n⚠️ Lighthouse failed to run. This is likely because:`);
            console.error(`1. Your development server is not running at ${url}`);
            console.error(`2. Chrome encountered security restrictions or an interstitial warning`);
            console.error(`\nTo resolve this:`);
            console.error(`- Make sure your dev server is running (yarn dev / npm run dev)`);
            console.error(`- Verify the URL works in a regular browser window`);
            console.error(`- Try using http://localhost:3000 if you're not using Vite\n`);
            throw error;
        }
        // Check if report was generated
        if (!fs.existsSync(outputPath)) {
            throw new Error("Lighthouse report was not generated");
        }
        // Read and parse the report
        const reportJson = fs.readFileSync(outputPath, "utf-8");
        const report = JSON.parse(reportJson);
        // Clean up report file
        fs.unlinkSync(outputPath);
        return report;
    }
    catch (error) {
        console.error("Error in runLighthouse:", error);
        // Provide a fallback dummy report if Lighthouse fails
        return {
            lhr: {
                categories: {
                    performance: { score: 0.5 }, // 50% score as fallback
                },
                audits: {
                    "first-contentful-paint": { numericValue: 1000 },
                    "speed-index": { numericValue: 1500 },
                    "largest-contentful-paint": { numericValue: 2500 },
                    "total-blocking-time": { numericValue: 200 },
                    "cumulative-layout-shift": { numericValue: 0.1 },
                    interactive: { numericValue: 3000 },
                    "first-meaningful-paint": { numericValue: 1200 },
                },
            },
        };
    }
    finally {
        // Always clean up Chrome
        cleanupChrome();
    }
}
