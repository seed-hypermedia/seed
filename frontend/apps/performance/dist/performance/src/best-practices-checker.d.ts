import { ElectronApplication, Page } from '@playwright/test';
/**
 * Performance best practice checks
 */
export interface BestPracticeCheck {
    name: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
    check: (app: ElectronApplication, page: Page) => Promise<boolean>;
    recommendation: string;
}
/**
 * Best practice check result
 */
export interface BestPracticeCheckResult {
    name: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
    passed: boolean;
    recommendation?: string;
}
/**
 * Checks for JavaScript and memory performance best practices
 */
export declare const javaScriptAndMemoryChecks: BestPracticeCheck[];
/**
 * Checks for window management best practices
 */
export declare const windowManagementChecks: BestPracticeCheck[];
/**
 * Checks for renderer process best practices
 */
export declare const rendererProcessChecks: BestPracticeCheck[];
/**
 * Runs all the best practice checks
 */
export declare function runBestPracticeChecks(app: ElectronApplication, page: Page): Promise<BestPracticeCheckResult[]>;
/**
 * Generates an HTML report for best practice check results
 */
export declare function generateBestPracticesReport(results: BestPracticeCheckResult[], outputPath: string): void;
