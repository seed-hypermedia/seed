import {packHmId, UnpackedHypermediaId} from "@shm/shared";
import {History} from "lucide-react";
import React, {useMemo} from "react";
import {useNavigate} from "react-router-dom";
import DataViewer from "../DataViewer";
import EmptyState from "../EmptyState";

const ChangesTab: React.FC<{changes: any[]; docId: UnpackedHypermediaId}> = ({
  changes,
  docId,
}) => {
  const navigate = useNavigate();
  const preparedChanges = useMemo(() => {
    if (!Array.isArray(changes)) {
      console.warn("Changes is not an array:", changes);
      return [];
    }
    return changes.map((change) => {
      const {id, author, deps, ...rest} = change;
      const out = {...rest};
      if (author) {
        out.author = `hm://${author}`;
      }
      if (id) {
        out.id = `ipfs://${id}`;
        out.version = packHmId({...docId, version: id});
      }
      if (deps) {
        out.deps = deps.map((dep: string) => `ipfs://${dep}`);
      }
      return out;
    });
  }, [changes, docId]);

  if (!Array.isArray(changes) || changes.length === 0) {
    return <EmptyState message="No changes available" icon={History} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {preparedChanges.map((change) => (
        <div key={change.id}>
          <DataViewer data={change} onNavigate={navigate} />
        </div>
      ))}
    </div>
  );
};

export default ChangesTab;
