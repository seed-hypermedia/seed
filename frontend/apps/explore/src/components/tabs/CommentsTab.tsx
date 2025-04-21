import {entityQueryPathToHmIdPath, hmId, packHmId} from "@shm/shared";
import React, {useMemo} from "react";
import {useNavigate} from "react-router-dom";
import DataViewer from "../DataViewer";

const CommentsTab: React.FC<{comments: any[]}> = ({comments}) => {
  const navigate = useNavigate();
  const preparedComments = useMemo(() => {
    return comments?.map((comment) => {
      const {id, author, targetPath, targetAccount, targetVersion, ...rest} =
        comment;
      const out = {...rest};
      if (id) {
        out.id = `hm://c/${id}`;
      }
      if (author) {
        out.author = `hm://${author}`;
      }
      if (targetAccount) {
        out.target = packHmId(
          hmId("d", targetAccount, {
            path: entityQueryPathToHmIdPath(targetPath || ""),
            version: targetVersion,
          })
        );
      }
      return out;
    });
  }, [comments]);
  return (
    <div className="flex flex-col gap-4">
      {preparedComments?.map((comment) => (
        <div key={comment.id}>
          <DataViewer data={comment} onNavigate={navigate} />
        </div>
      ))}
    </div>
  );
};

export default CommentsTab;
