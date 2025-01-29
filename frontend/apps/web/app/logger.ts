export function logDebug(...args: any[]) {
  if (!process.env.LOG_LEVEL) return;
  console.log(...args);
}
