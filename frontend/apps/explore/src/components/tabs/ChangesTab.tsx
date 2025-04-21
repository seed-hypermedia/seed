import React from "react";
import {useNavigate} from "react-router-dom";
import DataViewer from "../DataViewer";

const ChangesTab: React.FC<{changes: any[]}> = ({changes}) => {
  const navigate = useNavigate();
  return (
    <div className="p-4">
      <DataViewer data={changes} onNavigate={navigate} />
    </div>
  );
};

export default ChangesTab;
