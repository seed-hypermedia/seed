import React from "react";

interface CapabilitiesTabProps {
  data: any;
}

const CapabilitiesTab: React.FC<CapabilitiesTabProps> = ({data}) => {
  return (
    <div className="p-4">
      <h2 className="text-xl font-semibold mb-4">Capabilities</h2>
      <p>Capabilities information will be displayed here.</p>
    </div>
  );
};

export default CapabilitiesTab;
