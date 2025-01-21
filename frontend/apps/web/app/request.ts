export function parseRequest(request: Request) {
  const url = new URL(request.url);
  const hostname = request.headers.get("x-forwarded-host") || url.hostname;
  return {hostname, url};
}
