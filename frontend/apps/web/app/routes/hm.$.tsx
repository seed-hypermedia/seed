import {Params, useLoaderData} from "@remix-run/react";
import {hmId} from "@shm/shared";
import {DocumentPage, documentPageMeta} from "~/document";
import {loadSiteDocument, SiteDocumentPayload} from "~/loaders";
import {unwrap} from "~/wrapping";

export const meta = documentPageMeta;

export const loader = async ({
  params,
  request,
}: {
  params: Params;
  request: Request;
}) => {
  const url = new URL(request.url);
  const version = url.searchParams.get("v");
  const latest = url.searchParams.get("l") === "";
  const waitForSync = url.searchParams.get("waitForSync") !== null;
  const path = (params["*"] || "").split("/").filter((term) => !!term);
  const [accountUid, ...restPath] = path;
  return await loadSiteDocument(
    url.hostname,
    hmId("d", accountUid, {path: restPath, version, latest}),
    waitForSync
  );
};

export default function HypermediaDocument() {
  const data = unwrap<SiteDocumentPayload>(useLoaderData());
  return <DocumentPage {...data} />;
}
