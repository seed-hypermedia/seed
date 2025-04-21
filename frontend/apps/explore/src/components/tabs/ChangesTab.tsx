import React, {useMemo} from "react";
import {useNavigate} from "react-router-dom";
import DataViewer from "../DataViewer";

const ChangesTab: React.FC<{changes: any[]}> = ({changes}) => {
  const navigate = useNavigate();
  const preparedChanges = useMemo(() => {
    return changes.map((change) => {
      const {id, author, deps, ...rest} = change;
      const out = {...rest};
      if (author) {
        out.author = `hm://${author}`;
      }
      if (id) {
        out.id = `ipfs://${id}`;
      }
      if (deps) {
        out.deps = deps.map((dep: string) => `ipfs://${dep}`);
      }
      return out;
    });
  }, [changes]);
  return (
    <div className="p-4">
      <DataViewer data={preparedChanges} onNavigate={navigate} />
    </div>
  );
};

export default ChangesTab;
