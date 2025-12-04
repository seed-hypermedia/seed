import {UnpackedHypermediaId} from "@shm/shared";
import {FileText} from "lucide-react";
import {useApiHost} from "../../apiHostStore";
import EmptyState from "../EmptyState";
import {DocumentListItem} from "./DocumentListItem";

export function ChildrenDocsTab({
  list,
  id,
}: {
  list: any[] | undefined;
  id: UnpackedHypermediaId;
}) {
  const apiHost = useApiHost();

  // Handle case where there are no children documents
  if (!Array.isArray(list)) {
    console.warn("List is not an array:", list);
    return (
      <EmptyState message="No children documents available" icon={FileText} />
    );
  }

  if (list.length === 0) {
    return (
      <EmptyState message="No children documents available" icon={FileText} />
    );
  }

  return (
    <div className="space-y-2">
      {list.map((doc) => (
        <DocumentListItem key={doc.id.id} doc={doc} apiHost={apiHost} />
      ))}
    </div>
  );
}
