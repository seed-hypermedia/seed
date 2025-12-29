export function logDebug(...args: any[]) {
  if (!process.env.LOG_LEVEL) return;
  console.log(...args);
}

export function logDebugTiming() {
  if (!process.env.LOG_LEVEL) return () => {};
  const start = Date.now();
  return (msg: string) => {
    const end = Date.now();
    console.log(`${msg} took ${end - start}ms`);
  };
}
