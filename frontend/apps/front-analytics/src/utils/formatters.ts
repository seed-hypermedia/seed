export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)}${units[unitIndex]}`;
}

export function formatCPUUsage(microseconds: number): string {
  return `${(microseconds / 1000).toFixed(2)}ms`;
}

export function calculateCPUPercentage(
  user: number,
  system: number,
  totalTime: number
): number {
  // Convert microseconds to milliseconds for consistent units
  const totalCPUTime = (user + system) / 1000;
  // Calculate percentage based on total runtime in milliseconds
  return (totalCPUTime / totalTime) * 100;
}
