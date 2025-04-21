import React, {useMemo} from "react";
import {useNavigate} from "react-router-dom";
import DataViewer from "../DataViewer";

const CitationsTab: React.FC<{citations: any[]}> = ({citations}) => {
  const navigate = useNavigate();
  const preparedCitations = useMemo(() => {
    return citations?.map((citation) => {
      const {sourceBlob, ...rest} = citation;
      const out = {...rest};
      if (sourceBlob) {
        const {cid, author, ...rest} = sourceBlob;
        out.sourceBlob = {
          id: `ipfs://${cid}`,
          author: `hm://${author}`,
          ...rest,
        };
      }
      return out;
    });
  }, [citations]);
  return preparedCitations?.map((citation) => (
    <div className="p-4">
      <DataViewer data={citation} onNavigate={navigate} />
    </div>
  ));
};

export default CitationsTab;
