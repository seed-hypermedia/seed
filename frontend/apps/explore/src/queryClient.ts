// Re-export queryClient from shared to ensure single instance
export {queryClient} from "@shm/shared";

const API_HOST_STORAGE_KEY = "explore_api_host";

export function getApiHost(): string {
  // First try to get from localStorage
  const storedHost = localStorage.getItem(API_HOST_STORAGE_KEY);
  if (storedHost) {
    return storedHost;
  }

  // Fall back to environment variable
  return (
    import.meta.env.VITE_PUBLIC_EXPLORE_API_HOST || "http://localhost:3000"
  );
}

export function setApiHost(host: string): void {
  localStorage.setItem(API_HOST_STORAGE_KEY, host);
}
