import {LoaderFunction, MetaFunction} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {HMDocument} from "@shm/shared";
import {deserialize} from "superjson";
import {DocumentPage} from "~/document";
import {loadHMDocument} from "~/loaders";

export const meta: MetaFunction = ({data}) => {
  const document: HMDocument = deserialize(data.document);
  return [
    {title: document.metadata?.name || "Untitled"},
    // {name: "description", content: "Welcome to Remix!"},
  ];
};

export const loader: LoaderFunction = async ({params, request}) => {
  const url = new URL(request.url);
  const v = url.searchParams.get("v");
  // todo, use version "v"
  const path = (params["*"] || "").split("/");
  const [accountUid, ...restPath] = path;
  return await loadHMDocument(accountUid, restPath);
};

export default function HypermediaDocument() {
  // const {"*": path} = useParams();
  const data = useLoaderData<typeof loader>();
  const document: HMDocument = deserialize(data.document);
  return <DocumentPage document={document} />;
}
