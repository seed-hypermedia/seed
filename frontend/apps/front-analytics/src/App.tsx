import {useState} from "react";
import {CPUChart} from "./components/CPUChart";
import {FileSelector} from "./components/FileSelector";
import {MemoryChart} from "./components/MemoryChart";
import {OverviewPanel} from "./components/OverviewPanel";
import {MetricsData} from "./types";
import {parseMetricsFile} from "./utils/parser";

function App() {
  const [metricsData, setMetricsData] = useState<MetricsData | null>(null);

  const handleFileContent = (content: string) => {
    const parsedData = parseMetricsFile(content);
    setMetricsData(parsedData);
  };

  return (
    <div className="flex flex-col min-h-screen w-full bg-gradient-to-b from-slate-50 to-slate-100/50 dark:from-slate-900 dark:to-slate-800">
      <nav className="sticky top-0 z-10 w-full bg-white/70 dark:bg-slate-800/70 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <div className="flex items-center justify-between gap-4 w-full">
            <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-100">
              Seed Electron Performance Analytics
            </h1>
            <div className="flex items-center gap-4">
              {metricsData && (
                <button
                  onClick={() => setMetricsData(null)}
                  className="inline-flex items-center text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 transition-colors px-3 py-2 text-sm"
                >
                  <svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  Clear Data
                </button>
              )}
              <FileSelector onFileSelect={handleFileContent} />
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-[90rem] mx-auto">
          {metricsData ? (
            <div className="space-y-8">
              <OverviewPanel data={metricsData} />
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl ring-1 ring-slate-900/5 dark:ring-slate-500/10 p-6 hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors">
                  <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-4">
                    Memory Usage Over Time
                  </h3>
                  <div className="bg-white/70 dark:bg-slate-800/70 rounded-lg p-4">
                    <MemoryChart periodicStats={metricsData.periodicStats} />
                  </div>
                </div>
                <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl ring-1 ring-slate-900/5 dark:ring-slate-500/10 p-6 hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors">
                  <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-4">
                    CPU Usage Over Time
                  </h3>
                  <div className="bg-white/70 dark:bg-slate-800/70 rounded-lg p-4">
                    <CPUChart periodicStats={metricsData.periodicStats} />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center min-h-[calc(100vh-10rem)]">
              <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl ring-1 ring-slate-900/5 dark:ring-slate-500/10 p-10 max-w-lg w-full shadow-xl shadow-slate-200/50 dark:shadow-slate-900/50">
                <div className="text-center">
                  <div className="w-16 h-16 bg-blue-50 dark:bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg
                      className="w-8 h-8 text-blue-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mb-4">
                    Welcome to Performance Analytics
                  </h2>
                  <p className="text-slate-600 dark:text-slate-300 text-lg mb-2">
                    Select a metrics file from the dropdown above or upload a
                    new one to view detailed analytics about your Electron
                    application's performance.
                  </p>
                  <p className="text-slate-500 dark:text-slate-400 text-sm">
                    Supported formats: .log
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
