import { ParsedRequest } from "./request";

export const ENABLE_HTML_CACHE = false;

export function useFullRender(parsedRequest: ParsedRequest) {
  if (!ENABLE_HTML_CACHE) return true;
  const { url, headers } = parsedRequest;
  return (
    headers.get("x-full-render") === "true" ||
    url.searchParams.get("full") ||
    url.pathname.startsWith("/hm") ||
    url.pathname.startsWith("/assets")
  );
}
