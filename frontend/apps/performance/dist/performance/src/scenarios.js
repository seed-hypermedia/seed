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
exports.allScenarios = exports.largeContentScenario = exports.windowManagementScenario = exports.memoryUsageScenario = exports.ipcCommunicationScenario = exports.heavyOperationScenario = exports.navigationScenario = exports.libraryScenario = exports.appStartupScenario = void 0;
exports.getScenarioByName = getScenarioByName;
const path = __importStar(require("path"));
const trace_collector_1 = require("./trace-collector");
/**
 * Collection of performance test scenarios
 */
// App startup scenario - just launches the app and measures startup metrics
exports.appStartupScenario = {
    name: "app-startup",
    description: "Measures basic app startup performance",
    setup: async (page) => {
        // Wait for the app to be fully loaded
        await page.waitForLoadState("networkidle");
    },
};
// Main dashboard loading scenario
exports.libraryScenario = {
    name: "library-view",
    description: "Measures performance of the library view",
    setup: async (page) => {
        // Wait for the app to be fully loaded
        await page.waitForLoadState("networkidle");
        // Navigate to the dashboard (modify the selector as needed)
        // Example: await page.click('a[href="/dashboard"]');
        // Wait for dashboard to load
        // await page.click("#welcome-next");
        // await page.click("#profile-skip");
        await page.waitForLoadState("networkidle");
    },
};
// Example scenario for measuring performance when navigating between views
exports.navigationScenario = {
    name: "navigation-performance",
    description: "Measures performance when navigating between different views",
    setup: async (page) => {
        // Wait for initial load
        await page.waitForLoadState("networkidle");
        // Navigate to first view (modify selectors as needed)
        // Example: await page.click('a[href="/firstview"]');
        await page.waitForLoadState("networkidle");
        // Navigate to second view
        // Example: await page.click('a[href="/secondview"]');
        await page.waitForLoadState("networkidle");
        // Navigate back to first view
        // Example: await page.click('a[href="/firstview"]');
        await page.waitForLoadState("networkidle");
    },
};
// Example heavy operation scenario
exports.heavyOperationScenario = {
    name: "heavy-operation",
    description: "Measures performance during a CPU/memory intensive operation",
    setup: async (page) => {
        // Wait for initial load
        await page.waitForLoadState("networkidle");
        // Trigger a heavy operation, such as loading a large dataset
        // Example: await page.click('#load-large-dataset');
        // Wait for operation to complete
        await page.waitForLoadState("networkidle");
    },
};
// IPC Communication scenario - test inter-process communication performance
exports.ipcCommunicationScenario = {
    name: "ipc-communication",
    description: "Measures performance of IPC communication between renderer and main process",
    setup: async (page) => {
        // Wait for the app to load
        await page.waitForLoadState("networkidle");
        // Set up a trace collector for this test
        const traces = await (0, trace_collector_1.collectTrace)(page, async () => {
            // Execute some action that triggers IPC
            // This could be a button click or other action that causes main-renderer communication
            // For example: await page.click('#button-that-triggers-ipc');
            // Simulate this with wait time for now
            await page.waitForTimeout(1000);
        });
        // Analyze and save trace data
        const analysis = (0, trace_collector_1.analyzeTrace)(traces);
        const outputDir = process.env.TRACE_OUTPUT_DIR || "results/traces";
        const traceFile = path.join(outputDir, `ipc-trace-${new Date().toISOString().replace(/:/g, "-")}.json`);
        (0, trace_collector_1.saveTraceToFile)(traces, traceFile);
        // Generate an HTML report
        const reportFile = path.join(outputDir, `ipc-report-${new Date().toISOString().replace(/:/g, "-")}.html`);
        (0, trace_collector_1.generateTraceReport)(analysis, reportFile, "IPC Communication Performance");
    },
};
// Memory usage over time scenario
exports.memoryUsageScenario = {
    name: "memory-usage",
    description: "Measures memory usage patterns over time",
    setup: async (page) => {
        // Wait for the app to load
        await page.waitForLoadState("networkidle");
        // Get initial memory metrics
        const initialMetrics = await getMemoryMetrics(page);
        console.log("Initial memory metrics:", initialMetrics);
        // Perform operations that might impact memory
        // For example, navigate to different pages or perform memory-intensive tasks
        // Example: await page.click('#memory-intensive-action');
        // Wait a bit to let operations complete
        await page.waitForTimeout(5000);
        // Get final memory metrics
        const finalMetrics = await getMemoryMetrics(page);
        console.log("Final memory metrics:", finalMetrics);
        // Calculate change
        console.log("Memory change (bytes):", finalMetrics.jsHeapUsedSize - initialMetrics.jsHeapUsedSize);
    },
};
// Window creation and management performance
exports.windowManagementScenario = {
    name: "window-management",
    description: "Measures performance of window creation and management",
    setup: async (page) => {
        // Wait for the app to load
        await page.waitForLoadState("networkidle");
        // Measure performance of window-related operations
        const traces = await (0, trace_collector_1.collectTrace)(page, async () => {
            // Actions that might create/manipulate windows
            // Example: await page.click('#open-new-window');
            await page.waitForTimeout(1000);
            // Wait for any window operations to complete
            await page.waitForLoadState("networkidle");
        });
        // Analyze and save trace data
        const analysis = (0, trace_collector_1.analyzeTrace)(traces);
        const outputDir = process.env.TRACE_OUTPUT_DIR || "results/traces";
        const reportFile = path.join(outputDir, `window-report-${new Date().toISOString().replace(/:/g, "-")}.html`);
        (0, trace_collector_1.generateTraceReport)(analysis, reportFile, "Window Management Performance");
    },
};
// Performance with large content or data sets
exports.largeContentScenario = {
    name: "large-content",
    description: "Measures performance when dealing with large content or datasets",
    setup: async (page) => {
        // Wait for the app to load
        await page.waitForLoadState("networkidle");
        // Navigate to a view with large content
        // Example: await page.click('#large-dataset-view');
        // Wait for content to load
        await page.waitForLoadState("networkidle");
        // Measure scrolling performance
        const traces = await (0, trace_collector_1.collectTrace)(page, async () => {
            // Scroll through the content
            await page.evaluate(() => {
                return new Promise((resolve) => {
                    let totalScroll = 0;
                    const interval = setInterval(() => {
                        window.scrollBy(0, 100);
                        totalScroll += 100;
                        if (totalScroll >= 2000) {
                            clearInterval(interval);
                            resolve();
                        }
                    }, 100);
                });
            });
        });
        // Analyze and save trace data
        const analysis = (0, trace_collector_1.analyzeTrace)(traces);
        const outputDir = process.env.TRACE_OUTPUT_DIR || "results/traces";
        const reportFile = path.join(outputDir, `large-content-report-${new Date().toISOString().replace(/:/g, "-")}.html`);
        (0, trace_collector_1.generateTraceReport)(analysis, reportFile, "Large Content Performance");
    },
};
// Collection of all scenarios
exports.allScenarios = [
    exports.appStartupScenario,
    // libraryScenario,
    // navigationScenario,
    // heavyOperationScenario,
    // ipcCommunicationScenario,
    exports.memoryUsageScenario,
    // windowManagementScenario,
    exports.largeContentScenario,
];
// Get scenario by name
function getScenarioByName(name) {
    return exports.allScenarios.find((scenario) => scenario.name === name);
}
// Helper function to get memory metrics
async function getMemoryMetrics(page) {
    const client = await page.context().newCDPSession(page);
    await client.send("Performance.enable");
    const result = await client.send("Performance.getMetrics");
    const metrics = result.metrics;
    const jsHeapUsedSize = metrics.find((m) => m.name === "JSHeapUsedSize")?.value || 0;
    const jsHeapTotalSize = metrics.find((m) => m.name === "JSHeapTotalSize")?.value || 0;
    return {
        jsHeapUsedSize,
        jsHeapTotalSize,
        timestamp: Date.now(),
    };
}
