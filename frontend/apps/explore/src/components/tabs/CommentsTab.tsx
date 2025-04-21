import React from "react";
import {useNavigate} from "react-router-dom";
import DataViewer from "../DataViewer";

const CommentsTab: React.FC<{comments: any[]}> = ({comments}) => {
  const navigate = useNavigate();
  return <DataViewer data={comments} onNavigate={navigate} />;
};

export default CommentsTab;
