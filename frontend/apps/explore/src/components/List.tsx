import {useApiHost} from "../apiHostStore";
import {useRootDocuments} from "../models";
import {DocumentListItem} from "./tabs/DocumentListItem";

export default function List() {
  const {data, isLoading} = useRootDocuments();
  const apiHost = useApiHost();
  return (
    <div className="container p-4 mx-auto max-w-4xl">
      <h1 className="mb-6 text-3xl font-bold text-gray-900">
        All Hypermedia Sites
      </h1>
      {isLoading && <p>Loading...</p>}
      {data && (
        <div className="space-y-2">
          {data.documents.map((doc) => {
            return (
              <DocumentListItem key={doc.id.id} doc={doc} apiHost={apiHost} />
            );
          })}
        </div>
      )}
    </div>
  );
}
