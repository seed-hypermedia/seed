import {ParsedRequest} from "./request";

export function useFullRender(parsedRequest: ParsedRequest) {
  const {url, headers} = parsedRequest;
  return (
    headers.get("x-full-render") === "true" ||
    url.searchParams.get("full") ||
    url.pathname.startsWith("/hm") ||
    url.pathname.startsWith("/assets")
  );
}
