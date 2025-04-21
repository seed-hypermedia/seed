import {packHmId, UnpackedHypermediaId} from "@shm/shared";
import React, {useMemo} from "react";
import {useNavigate} from "react-router-dom";
import DataViewer from "../DataViewer";

const ChangesTab: React.FC<{changes: any[]; docId: UnpackedHypermediaId}> = ({
  changes,
  docId,
}) => {
  const navigate = useNavigate();
  const preparedChanges = useMemo(() => {
    return changes?.map((change) => {
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
  }, [changes]);
  return preparedChanges?.map((change) => (
    <div key={change.id} className="p-4">
      <DataViewer data={change} onNavigate={navigate} />
    </div>
  ));
};

export default ChangesTab;
