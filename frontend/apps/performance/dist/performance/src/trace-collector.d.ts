import { Page } from "@playwright/test";
interface TraceEvent {
    name: string;
    cat: string;
    ph: string;
    pid: number;
    tid: number;
    ts: number;
    dur?: number;
    args?: Record<string, unknown>;
}
/**
 * Interface for trace analysis results
 */
export interface TraceAnalysis {
    totalTime: number;
    scriptingTime: number;
    renderingTime: number;
    paintingTime: number;
    systemTime: number;
    idleTime: number;
    longTasks: {
        count: number;
        totalTime: number;
        longestTask: number;
    };
    navigationTiming: {
        domContentLoaded?: number;
        loadEvent?: number;
        firstPaint?: number;
        firstContentfulPaint?: number;
    };
    frames: {
        count: number;
        slowFrames: number;
        averageFrameTime: number;
    };
    javascriptExecution: {
        compilationTime: number;
        executionTime: number;
        garbageCollectionTime: number;
    };
}
/**
 * Start collecting a trace
 */
declare function startTracing(page: Page): Promise<void>;
/**
 * Stop collecting the trace
 */
declare function stopTracing(page: Page): Promise<TraceEvent[]>;
/**
 * Save trace data to a file
 */
export declare function saveTraceToFile(traceData: any[], outputFile: string): void;
/**
 * Analyze trace data to extract performance metrics
 */
export declare function analyzeTrace(events: any[]): any;
/**
 * Generate an HTML report from trace analysis
 */
export declare function generateTraceReport(metrics: Record<string, number>, outputFile: string, title?: string): void;
/**
 * Collect a trace during the execution of an action
 */
export declare function collectTrace(page: Page, action: () => Promise<void>): Promise<TraceEvent[]>;
/**
 * Saves trace analysis to a file
 */
export declare function saveTraceAnalysis(analysis: TraceAnalysis, filePath: string): void;
export { startTracing, stopTracing, TraceEvent };
