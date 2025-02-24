import {useFullRender} from "@/cache-policy";
import {DocumentPage, documentPageHeaders, documentPageMeta} from "@/document";
import {loadSiteDocument, SiteDocumentPayload} from "@/loaders";
import {parseRequest} from "@/request";
import {getConfig} from "@/site-config";
import {unwrap} from "@/wrapping";
import {Params, useLoaderData} from "@remix-run/react";
import {hmId} from "@shm/shared";

export const headers = documentPageHeaders;

export const meta = documentPageMeta;

export const loader = async ({
  params,
  request,
}: {
  params: Params;
  request: Request;
}) => {
  const parsedRequest = parseRequest(request);
  if (!useFullRender(parsedRequest)) return null;
  const {url, hostname} = parsedRequest;
  const version = url.searchParams.get("v");
  const latest = url.searchParams.get("l") === "";
  const serviceConfig = await getConfig(hostname);
  if (!serviceConfig) throw new Error(`No config defined for ${hostname}`);
  const {registeredAccountUid} = serviceConfig;
  if (!registeredAccountUid) throw new Error("No registered account uid");
  const path = (params["*"] || "").split("/");
  return await loadSiteDocument(
    parsedRequest,
    hmId("d", registeredAccountUid, {path, version, latest})
  );
};

export default function SiteDocument() {
  // const {"*": path} = useParams();
  const data = unwrap<SiteDocumentPayload>(useLoaderData());
  return <DocumentPage {...data} />;
}
