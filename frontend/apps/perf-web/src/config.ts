import type {AppBudgets} from "./types.js";

export const PORTS = {
  web: 3000,
  landing: 4173,
} as const;

export const budgets: Record<string, AppBudgets> = {
  web: {
    mobile: {
      lcp: 4000, // 4s
      inp: 500, // 500ms
      cls: 0.25, // 0.25
      ttfb: 1000, // 1s
      pageSize: 2000000, // 2MB
    },
    desktop: {
      lcp: 2500, // 2.5s
      inp: 200, // 200ms
      cls: 0.1, // 0.1
      ttfb: 600, // 600ms
      pageSize: 2000000, // 2MB
    },
  },
  landing: {
    mobile: {
      lcp: 3000, // 3s - slightly more lenient as it's a static site
      inp: 500, // 500ms
      cls: 0.25, // 0.25
      ttfb: 800, // 800ms
      pageSize: 1500000, // 1.5MB
    },
    desktop: {
      lcp: 2000, // 2s
      inp: 200, // 200ms
      cls: 0.1, // 0.1
      ttfb: 500, // 500ms
      pageSize: 1500000, // 1.5MB
    },
  },
};

export const LIGHTHOUSE_CONFIG = {
  extends: "lighthouse:default",
  settings: {
    onlyCategories: ["performance"],
    formFactor: "desktop" as const,
    throttling: {
      rttMs: 40,
      throughputKbps: 10240,
      cpuSlowdownMultiplier: 1,
    },
  },
};
