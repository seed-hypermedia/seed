export type AppType = 'web' | 'landing'

export interface PerformanceMetrics {
  lcp: number
  inp: number
  cls: number
  ttfb: number
  pageSize: number
  totalRequests: number
  pageLoadTime: number
}

export interface BudgetConfig {
  lcp: number
  inp: number
  cls: number
  ttfb: number
  pageSize: number
}

export interface AppBudgets {
  mobile: BudgetConfig
  desktop: BudgetConfig
}

export interface BudgetViolation {
  metric: keyof PerformanceMetrics
  actual: number
  limit: number
  device: 'mobile' | 'desktop'
}

export interface PerformanceResult {
  timestamp: string
  app: AppType
  commit: string
  branch: string
  mobile: PerformanceMetrics
  desktop: PerformanceMetrics
  budgetViolations: BudgetViolation[]
}
