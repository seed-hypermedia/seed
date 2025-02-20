import {Params, useLoaderData} from "@remix-run/react";
import {hmId} from "@shm/shared";
import {useFullRender} from "~/cache-policy";
import {DocumentPage, documentPageHeaders, documentPageMeta} from "~/document";
import {loadSiteDocument, SiteDocumentPayload} from "~/loaders";
import {parseRequest} from "~/request";
import {unwrap} from "~/wrapping";

export const meta = documentPageMeta;

export const headers = documentPageHeaders;

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
  const path = (params["*"] || "").split("/").filter((term) => !!term);
  const [accountUid, ...restPath] = path;
  return await loadSiteDocument(
    hostname,
    hmId("d", accountUid, {path: restPath, version, latest})
  );
};

export default function HypermediaDocument() {
  const data = unwrap<SiteDocumentPayload>(useLoaderData());
  return <DocumentPage {...data} />;
}
