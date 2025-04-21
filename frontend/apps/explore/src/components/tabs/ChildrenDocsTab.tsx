import {UnpackedHypermediaId} from "@shm/shared";
import {useApiHost} from "../../apiHostStore";
import {DocumentListItem} from "./DocumentListItem";

export function ChildrenDocsTab({
  list,
  id,
}: {
  list: any[];
  id: UnpackedHypermediaId;
}) {
  const apiHost = useApiHost();
  return (
    <div className="space-y-4">
      {list?.map((doc) => (
        <DocumentListItem key={doc.id.id} doc={doc} apiHost={apiHost} />
      ))}
    </div>
  );
}
