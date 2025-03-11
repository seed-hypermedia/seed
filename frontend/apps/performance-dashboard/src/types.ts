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
