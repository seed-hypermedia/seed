export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  description?: string;
  threshold?: number;
}

export interface ScenarioResult {
  name: string;
  timestamp?: string;
  metrics: PerformanceMetric[];
  traces?: string[];
  screenshots?: string[];
}

export interface PerformanceReport {
  id: string;
  date: string;
  scenarios: ScenarioResult[];
  summary?: {
    totalScenarios: number;
    passedBudgets: number;
    failedBudgets: number;
  };
}

// Web Performance Types
export interface WebPerformanceMetric {
  name: string;
  value: number;
  device: "mobile" | "desktop";
  threshold?: number;
}

export interface DeviceMetrics {
  lcp: number; // Largest Contentful Paint
  inp: number; // Interaction to Next Paint
  cls: number; // Cumulative Layout Shift
  ttfb: number; // Time to First Byte
  pageLoadTime: number;
  pageSize: number;
  totalRequests: number;
}

export interface BudgetViolation {
  metric: string;
  device: "mobile" | "desktop";
  actual: number;
  limit: number;
}

export interface WebPerformanceResult {
  timestamp: string;
  app: "web" | "landing";
  commit: string;
  branch: string;
  mobile: DeviceMetrics;
  desktop: DeviceMetrics;
  budgetViolations: BudgetViolation[];
}

export interface WebPerformanceReport {
  id: string;
  date: string;
  timestamp: string;
  app: "web" | "landing";
  metrics: WebPerformanceMetric[];
  budgetViolations: BudgetViolation[];
}
