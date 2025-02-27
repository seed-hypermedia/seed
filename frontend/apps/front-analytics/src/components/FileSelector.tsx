import {useEffect, useState} from "react";

interface FileSelectorProps {
  onFileSelect: (content: string) => void;
}

export function FileSelector({onFileSelect}: FileSelectorProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");

  useEffect(() => {
    // Fetch list of available result files
    fetch("/metrics")
      .then((response) => response.json())
      .then((data) => setFiles(data))
      .catch((error) => console.error("Error fetching metrics files:", error));
  }, []);

  const handleFileSelect = async (filename: string) => {
    try {
      const response = await fetch(`/metrics/${filename}`);
      const content = await response.text();
      onFileSelect(content);
      setSelectedFile(filename);
    } catch (error) {
      console.error("Error loading file:", error);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <select
        value={selectedFile}
        onChange={(e) => handleFileSelect(e.target.value)}
        className="bg-white/50 dark:bg-slate-800/50 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">Select a metrics file</option>
        {files.map((file) => (
          <option key={file} value={file}>
            {file.replace("results-", "").replace(".log", "")}
          </option>
        ))}
      </select>
      <span className="text-sm text-slate-500 dark:text-slate-400">or</span>
      <label className="bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-md cursor-pointer transition-all hover:shadow-md active:transform active:scale-95 inline-flex items-center">
        <svg
          className="w-5 h-5 mr-2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
          />
        </svg>
        Upload File
        <input
          type="file"
          className="hidden"
          accept=".log"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              file.text().then(onFileSelect);
            }
          }}
        />
      </label>
    </div>
  );
}
