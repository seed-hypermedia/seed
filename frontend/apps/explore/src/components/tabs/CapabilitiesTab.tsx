import React from "react";
import {useNavigate} from "react-router-dom";
import DataViewer from "../DataViewer";

interface CapabilitiesTabProps {
  capabilities: any[];
}

const CapabilitiesTab: React.FC<CapabilitiesTabProps> = ({capabilities}) => {
  const navigate = useNavigate();
  return (
    <div className="p-4">
      <DataViewer data={capabilities} onNavigate={navigate} />
    </div>
  );
};

export default CapabilitiesTab;
