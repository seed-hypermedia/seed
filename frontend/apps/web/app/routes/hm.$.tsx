import {Params, useLoaderData} from "@remix-run/react";
import {DocumentPage, documentPageMeta} from "~/document";
import {loadHMDocument} from "~/loaders";

export const meta = documentPageMeta;

export const loader = async ({
  params,
  request,
}: {
  params: Params;
  request: Request;
}) => {
  const url = new URL(request.url);
  const v = url.searchParams.get("v");
  // todo, use version "v"
  const path = (params["*"] || "").split("/");
  const [accountUid, ...restPath] = path;
  return await loadHMDocument(accountUid, restPath);
};

export default function HypermediaDocument() {
  const data = useLoaderData<typeof loader>();
  return <DocumentPage {...data} />;
}
