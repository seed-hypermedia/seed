import { PerformanceMetrics } from './perf-utils';
/**
 * Performance budget definition
 */
export interface PerformanceBudget {
    metric: string;
    scenario: string;
    threshold: number;
    operator: 'lt' | 'lte' | 'gt' | 'gte';
    severity: 'error' | 'warning';
    description: string;
}
/**
 * Performance budget violation
 */
export interface BudgetViolation {
    budget: PerformanceBudget;
    actualValue: number;
    expectedValue: number;
    percentageDiff: number;
}
/**
 * Performance budget check results
 */
export interface BudgetCheckResult {
    violations: BudgetViolation[];
    passed: BudgetViolation[];
    timestamp: string;
}
/**
 * Default performance budgets
 */
export declare const defaultBudgets: PerformanceBudget[];
/**
 * Checks metrics against defined performance budgets
 */
export declare function checkPerformanceBudgets(metrics: Record<string, PerformanceMetrics>, budgets?: PerformanceBudget[]): BudgetCheckResult;
/**
 * Generates an HTML report for budget violations
 */
export declare function generateBudgetReport(result: BudgetCheckResult, outputPath: string): void;
/**
 * Load custom performance budgets from a JSON file
 */
export declare function loadBudgetsFromFile(filePath: string): PerformanceBudget[];
