import {toPlainMessage} from "@bufbuild/protobuf";
import {LoaderFunction} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {HMDocument, hmId} from "@shm/shared";
import {DocContent, DocContentProvider} from "@shm/ui/src/document-content";
import {deserialize, serialize} from "superjson";
import {queryClient} from "~/client";

export const loader: LoaderFunction = async ({params, request}) => {
  const url = new URL(request.url);
  const v = url.searchParams.get("v");
  // todo, use version "v"
  const path = (params["*"] || "").split("/");
  const [entityId, ...restPath] = path;
  const rawDoc = await queryClient.documents.getDocument({
    account: entityId,
    path: `/${restPath.join("/")}`,
    // version
  });
  const document = toPlainMessage(rawDoc);
  console.log("path", path);
  return {
    document: serialize(document),
    id: hmId("d", entityId, {
      path: restPath,
      // version: v,
    }),
  };
};

export default function HypermediaDocument() {
  // const {"*": path} = useParams();
  const data = useLoaderData<typeof loader>();
  const document: HMDocument = deserialize(data.document);
  // console.log("document", document);
  return (
    <div>
      <h1>{document.metadata?.name}</h1>
      <DocContentProvider
        entityComponents={{
          Document: () => null,
          Comment: () => null,
          Inline: () => null,
        }}
        ipfsBlobPrefix="http://localhost:57001/ipfs/"
        onLinkClick={(href, e) => {}}
        onCopyBlock={(blockId, blockRange) => {}}
        saveCidAsFile={async (cid, name) => {}}
        textUnit={18}
        layoutUnit={24}
        debug={false}
      >
        <DocContent document={document} />
      </DocContentProvider>
    </div>
  );
}
