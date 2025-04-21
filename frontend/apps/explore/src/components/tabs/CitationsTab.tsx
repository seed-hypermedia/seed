import React from "react";
import {useNavigate} from "react-router-dom";
import DataViewer from "../DataViewer";

const CitationsTab: React.FC<{citations: any[]}> = ({citations}) => {
  const navigate = useNavigate();
  return (
    <div className="p-4">
      <DataViewer data={citations} onNavigate={navigate} />
    </div>
  );
};

export default CitationsTab;
