import {Activity, ArrowRight, Globe, Monitor} from "lucide-react";
import React from "react";
import {Link} from "react-router-dom";
import {loadPerformanceReports} from "../utils/data";

const Dashboard = () => {
  const [metrics, setMetrics] = React.useState<{
    electron: {
      totalReports: number;
      latestReport: any;
      avgStartupTime: number;
      avgMemoryUsage: number;
      avgCpuUsage: number;
    };
    web: {
      totalReports: number;
      latestReport: any;
      avgLCP: number;
      avgFID: number;
      avgCLS: number;
      performanceScore: number;
    };
    landing: {
      totalReports: number;
      latestReport: any;
      avgLCP: number;
      avgFID: number;
      avgCLS: number;
      performanceScore: number;
    };
  } | null>(null);

  React.useEffect(() => {
    const fetchMetrics = async () => {
      try {
        // Load reports for each app
        const electronReports = await loadPerformanceReports("electron");

        console.log(`== ~ fetchMetrics ~ electronReports:`, electronReports);
        // Note: You'll need to implement these functions in your data utils
        const webReports = await loadPerformanceReports("web");

        console.log(`== ~ fetchMetrics ~ webReports:`, webReports);
        const landingReports = await loadPerformanceReports("landing");

        // Calculate averages and get latest reports
        setMetrics({
          electron: {
            totalReports: electronReports.length,
            latestReport: electronReports[0],
            avgStartupTime: calculateAvgStartupTime(electronReports),
            avgMemoryUsage: calculateAvgMemoryUsage(electronReports),
            avgCpuUsage: calculateAvgCpuUsage(electronReports),
          },
          web: {
            totalReports: webReports.length,
            latestReport: webReports[0],
            ...calculateWebMetrics(webReports),
          },
          landing: {
            totalReports: landingReports.length,
            latestReport: landingReports[0],
            ...calculateWebMetrics(landingReports),
          },
        });
      } catch (error) {
        console.error("Error loading dashboard metrics:", error);
      }
    };

    fetchMetrics();
  }, []);

  // Helper functions to calculate averages
  const calculateAvgStartupTime = (reports: any[]) => {
    if (!reports.length) return 0;
    const startupTimes = reports.map((r) => {
      const metrics = r.metrics?.["app-startup"] || {};
      return metrics.appStartupTime || 0;
    });
    return startupTimes.reduce((a, b) => a + b, 0) / startupTimes.length;
  };

  const calculateAvgMemoryUsage = (reports: any[]) => {
    if (!reports.length) return 0;
    const memoryUsages = reports.map((r) => {
      const metrics = Object.values(r.metrics || {}).find(
        (m: any) => m.jsHeapUsedSize
      );
      return metrics?.jsHeapUsedSize || 0;
    });
    return memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length;
  };

  const calculateAvgCpuUsage = (reports: any[]) => {
    if (!reports.length) return 0;
    const cpuUsages = reports.map((r) => {
      const metrics = Object.values(r.metrics || {}).find(
        (m: any) => m.cpuUsage
      );
      return metrics?.cpuUsage?.percentCPUUsage || 0;
    });
    return cpuUsages.reduce((a, b) => a + b, 0) / cpuUsages.length;
  };

  const calculateWebMetrics = (reports: any[]) => {
    if (!reports.length)
      return {
        avgLCP: 0,
        avgFID: 0,
        avgCLS: 0,
        performanceScore: 0,
      };

    const metrics = reports.map((r) => ({
      lcp: r.metrics?.LCP || 0,
      fid: r.metrics?.FID || 0,
      cls: r.metrics?.CLS || 0,
      score: r.metrics?.performanceScore || 0,
    }));

    return {
      avgLCP: metrics.reduce((a, b) => a + b.lcp, 0) / metrics.length,
      avgFID: metrics.reduce((a, b) => a + b.fid, 0) / metrics.length,
      avgCLS: metrics.reduce((a, b) => a + b.cls, 0) / metrics.length,
      performanceScore:
        metrics.reduce((a, b) => a + b.score, 0) / metrics.length,
    };
  };

  // Format helpers
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatMs = (ms: number) => {
    if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${ms.toFixed(2)}ms`;
  };

  if (!metrics) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-gray-500">Loading dashboard data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Seed Frontend Performance Dashboard
        </h1>
        <p className="text-gray-600 max-w-2xl mx-auto">
          Monitor and analyze performance metrics across all applications. Track
          startup times, resource usage, and web vitals to ensure optimal user
          experience.
        </p>
      </div>

      {/* App Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Electron App Card */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <Monitor className="w-6 h-6 text-indigo-600 mr-2" />
                <h2 className="text-xl font-semibold text-gray-900">
                  Electron App
                </h2>
              </div>
              <Link
                to="/electron"
                className="text-indigo-600 hover:text-indigo-700 flex items-center"
              >
                View Details
                <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Average Startup Time</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {formatMs(metrics.electron.avgStartupTime)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Memory Usage</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {formatBytes(metrics.electron.avgMemoryUsage)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">CPU Usage</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {metrics.electron.avgCpuUsage.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-6 py-3">
            <div className="text-sm text-gray-500">
              {metrics.electron.totalReports} reports •{" "}
              {new Date(
                metrics.electron.latestReport?.date
              ).toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Web App Card */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <Activity className="w-6 h-6 text-blue-600 mr-2" />
                <h2 className="text-xl font-semibold text-gray-900">Web App</h2>
              </div>
              <Link
                to="/web"
                className="text-blue-600 hover:text-blue-700 flex items-center"
              >
                View Details
                <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Avg LCP</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {formatMs(metrics.web.avgLCP)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Performance Score</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {metrics.web.performanceScore.toFixed(0)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">CLS</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {metrics.web.avgCLS.toFixed(3)}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-6 py-3">
            <div className="text-sm text-gray-500">
              {metrics.web.totalReports} reports •{" "}
              {new Date(metrics.web.latestReport?.date).toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Landing Page Card */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <Globe className="w-6 h-6 text-green-600 mr-2" />
                <h2 className="text-xl font-semibold text-gray-900">
                  Landing Page
                </h2>
              </div>
              <Link
                to="/landing"
                className="text-green-600 hover:text-green-700 flex items-center"
              >
                View Details
                <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Avg LCP</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {formatMs(metrics.landing.avgLCP)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Performance Score</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {metrics.landing.performanceScore.toFixed(0)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">CLS</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {metrics.landing.avgCLS.toFixed(3)}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-6 py-3">
            <div className="text-sm text-gray-500">
              {metrics.landing.totalReports} reports •{" "}
              {new Date(
                metrics.landing.latestReport?.date
              ).toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>

      {/* Latest Reports Section */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Latest Performance Reports
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Application
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Key Metrics
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {/* Electron Latest Report */}
              <tr>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <Monitor className="w-5 h-5 text-indigo-600 mr-2" />
                    <div className="text-sm font-medium text-gray-900">
                      Electron App
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(
                    metrics.electron.latestReport?.date
                  ).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  Startup: {formatMs(metrics.electron.avgStartupTime)} • CPU:{" "}
                  {metrics.electron.avgCpuUsage.toFixed(1)}%
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                    Healthy
                  </span>
                </td>
              </tr>

              {/* Web App Latest Report */}
              <tr>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <Activity className="w-5 h-5 text-blue-600 mr-2" />
                    <div className="text-sm font-medium text-gray-900">
                      Web App
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(
                    metrics.web.latestReport?.date
                  ).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  LCP: {formatMs(metrics.web.avgLCP)} • Score:{" "}
                  {metrics.web.performanceScore.toFixed(0)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                    Healthy
                  </span>
                </td>
              </tr>

              {/* Landing Page Latest Report */}
              <tr>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <Globe className="w-5 h-5 text-green-600 mr-2" />
                    <div className="text-sm font-medium text-gray-900">
                      Landing Page
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(
                    metrics.landing.latestReport?.date
                  ).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  LCP: {formatMs(metrics.landing.avgLCP)} • Score:{" "}
                  {metrics.landing.performanceScore.toFixed(0)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                    Healthy
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
