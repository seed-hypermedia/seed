import React, {useEffect, useState} from "react";
import type {WebPerformanceResult} from "../types";
import {loadWebPerformanceResults, transformWebResult} from "../utils/data";
import {formatBytes} from "../utils/format";
import WebPerformanceTrends from "./WebPerformanceTrends";

interface MetricCardProps {
  title: string;
  value: number;
  threshold?: number;
  unit?: string;
  device: "mobile" | "desktop";
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  threshold,
  unit,
  device,
}) => {
  const isOverThreshold = threshold && value > threshold;
  const formattedValue =
    unit === "bytes"
      ? formatBytes(value)
      : unit === "ms"
      ? `${value.toFixed(0)}ms`
      : unit === "s"
      ? `${(value / 1000).toFixed(2)}s`
      : value.toString();

  return (
    <div
      className={`p-4 rounded-lg border ${
        isOverThreshold ? "border-red-400 bg-red-50" : "border-gray-200"
      }`}
    >
      <h3 className="text-sm font-medium text-gray-500">{title}</h3>
      <div className="mt-1 flex items-baseline justify-between">
        <div className="text-2xl font-semibold text-gray-900">
          {formattedValue}
        </div>
        <div
          className={`text-sm ${
            device === "mobile" ? "text-blue-600" : "text-purple-600"
          }`}
        >
          {device}
        </div>
      </div>
      {threshold && (
        <div className="mt-1 text-xs text-gray-500">
          Threshold:{" "}
          {unit === "bytes"
            ? formatBytes(threshold)
            : unit === "ms"
            ? `${threshold}ms`
            : unit === "s"
            ? `${(threshold / 1000).toFixed(2)}s`
            : threshold}
        </div>
      )}
    </div>
  );
};

interface WebPerformanceProps {
  app: "web" | "landing";
}

export const WebPerformance: React.FC<WebPerformanceProps> = ({app}) => {
  const [results, setResults] = useState<WebPerformanceResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchResults = async () => {
      try {
        setIsLoading(true);
        const data = await loadWebPerformanceResults(app);

        console.log(`== ~ fetchResults ~ data:`, data);
        if (data) {
          setResults(data);
        } else {
          setError(`Failed to load ${app} performance results`);
          throw new Error(`Failed to load ${app} performance results`);
        }
      } catch (error) {
        setError(`Failed to load ${app} performance results`);
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchResults();
  }, [app]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-gray-500">Loading {app} performance data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 rounded-lg">
        <div className="text-red-700">{error}</div>
        <div className="text-red-600 text-sm mt-1">
          Check that performance test results exist and are accessible.
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="p-4 bg-yellow-50 rounded-lg">
        <div className="text-yellow-800">
          No {app} performance test results found.
        </div>
        <div className="text-yellow-700 text-sm mt-1">
          Run performance tests to generate data for the dashboard.
        </div>
      </div>
    );
  }

  const latestResult = results[0];
  const report = transformWebResult(latestResult);

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          {app === "web" ? "Web App" : "Landing Page"} Performance Dashboard
        </h2>
        <p className="text-gray-500 mb-6">
          Latest results from {new Date(report.timestamp).toLocaleString()}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Core Web Vitals - Mobile */}
          <MetricCard
            title="Largest Contentful Paint (LCP)"
            value={latestResult.mobile.lcp}
            threshold={4000}
            unit="ms"
            device="mobile"
          />
          <MetricCard
            title="Interaction to Next Paint (INP)"
            value={latestResult.mobile.inp}
            threshold={500}
            unit="ms"
            device="mobile"
          />
          <MetricCard
            title="Cumulative Layout Shift (CLS)"
            value={latestResult.mobile.cls}
            threshold={0.25}
            device="mobile"
          />

          {/* Core Web Vitals - Desktop */}
          <MetricCard
            title="Largest Contentful Paint (LCP)"
            value={latestResult.desktop.lcp}
            threshold={2500}
            unit="ms"
            device="desktop"
          />
          <MetricCard
            title="Interaction to Next Paint (INP)"
            value={latestResult.desktop.inp}
            threshold={200}
            unit="ms"
            device="desktop"
          />
          <MetricCard
            title="Cumulative Layout Shift (CLS)"
            value={latestResult.desktop.cls}
            threshold={0.1}
            device="desktop"
          />

          {/* Other Metrics - Mobile */}
          <MetricCard
            title="Time to First Byte (TTFB)"
            value={latestResult.mobile.ttfb}
            threshold={1000}
            unit="ms"
            device="mobile"
          />
          <MetricCard
            title="Page Load Time"
            value={latestResult.mobile.pageLoadTime}
            unit="ms"
            device="mobile"
          />
          <MetricCard
            title="Page Size"
            value={latestResult.mobile.pageSize}
            threshold={2000000}
            unit="bytes"
            device="mobile"
          />

          {/* Other Metrics - Desktop */}
          <MetricCard
            title="Time to First Byte (TTFB)"
            value={latestResult.desktop.ttfb}
            threshold={600}
            unit="ms"
            device="desktop"
          />
          <MetricCard
            title="Page Load Time"
            value={latestResult.desktop.pageLoadTime}
            unit="ms"
            device="desktop"
          />
          <MetricCard
            title="Page Size"
            value={latestResult.desktop.pageSize}
            threshold={2000000}
            unit="bytes"
            device="desktop"
          />
        </div>

        {report.budgetViolations.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold text-red-600 mb-4">
              Performance Budget Violations
            </h2>
            <div className="bg-red-50 p-4 rounded-lg">
              <ul className="space-y-2">
                {report.budgetViolations.map((violation, index) => (
                  <li key={index} className="text-red-700">
                    {violation.metric} ({violation.device}):{" "}
                    {violation.actual.toFixed(2)} (limit: {violation.limit})
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Historical Trends Section */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">
          Performance Trends
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Core Web Vitals Trends */}
          <WebPerformanceTrends
            results={results}
            metric="lcp"
            device="mobile"
            title="Largest Contentful Paint"
            unit="ms"
          />
          <WebPerformanceTrends
            results={results}
            metric="inp"
            device="mobile"
            title="Interaction to Next Paint"
            unit="ms"
          />
          <WebPerformanceTrends
            results={results}
            metric="cls"
            device="mobile"
            title="Cumulative Layout Shift"
          />
          <WebPerformanceTrends
            results={results}
            metric="ttfb"
            device="mobile"
            title="Time to First Byte"
            unit="ms"
          />
          <WebPerformanceTrends
            results={results}
            metric="pageLoadTime"
            device="mobile"
            title="Page Load Time"
            unit="ms"
          />
          <WebPerformanceTrends
            results={results}
            metric="pageSize"
            device="mobile"
            title="Page Size"
            unit="bytes"
          />
        </div>
      </div>
    </div>
  );
};

export default WebPerformance;
