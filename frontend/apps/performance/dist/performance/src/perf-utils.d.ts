import { Page } from "@playwright/test";
export interface PerformanceMetrics {
    firstPaint?: number;
    firstContentfulPaint?: number;
    domContentLoaded?: number;
    loadTime?: number;
    scriptDuration?: number;
    layoutDuration?: number;
    recalcStyleDuration?: number;
    jsHeapUsedSize?: number;
    jsHeapTotalSize?: number;
    timeToInteractive?: number;
    appStartupTime?: number;
    cpuUsage?: {
        percentCPUUsage: number;
        idleWakeupsPerSecond: number;
    };
    frameRate?: number;
    taskDuration?: number;
    gcTime?: number;
    lighthouse?: {
        firstContentfulPaint?: number;
        speedIndex?: number;
        largestContentfulPaint?: number;
        totalBlockingTime?: number;
        cumulativeLayoutShift?: number;
        timeToInteractive?: number;
        firstMeaningfulPaint?: number;
        performanceScore?: number;
    };
}
export interface PerformanceScenario {
    name: string;
    description: string;
    setup: (page: Page) => Promise<void>;
}
/**
 * Captures Chrome DevTools performance metrics from a page
 */
export declare function capturePerformanceMetrics(page: Page): Promise<PerformanceMetrics>;
/**
 * Captures CPU usage from the main process
 */
export declare function captureCPUMetrics(page: Page): Promise<{
    percentCPUUsage: number;
    idleWakeupsPerSecond: number;
}>;
/**
 * Runs Lighthouse on the specified URL to collect performance metrics
 */
export declare function runLighthouseAudit(url: string): Promise<PerformanceMetrics>;
/**
 * Measures the start-up time of the Electron app
 */
export declare function measureAppStartupTime(): Promise<PerformanceMetrics>;
/**
 * Run a performance test scenario
 */
export declare function runPerformanceScenario(scenario: PerformanceScenario): Promise<PerformanceMetrics>;
/**
 * Save performance metrics to a JSON file
 */
export declare function saveMetricsToJson(metrics: Record<string, PerformanceMetrics>, outputDir: string): Promise<string>;
