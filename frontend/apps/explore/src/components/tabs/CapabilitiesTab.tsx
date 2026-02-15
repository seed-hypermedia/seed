import {Shield} from "lucide-react";
import React, {useMemo} from "react";
import {useNavigate} from "react-router-dom";
import DataViewer from "../DataViewer";
import EmptyState from "../EmptyState";

interface CapabilitiesTabProps {
  capabilities?: any[];
}

const CapabilitiesTab: React.FC<CapabilitiesTabProps> = ({capabilities}) => {
  const navigate = useNavigate();
  const preparedCapabilities = useMemo(() => {
    if (!Array.isArray(capabilities)) {
      console.warn("Capabilities is not an array:", capabilities);
      return [];
    }
    return capabilities.map((capability) => {
      const {id, accountUid, grantId, ...rest} = capability;
      const out = {...rest};
      if (id) {
        out.id = id === '_owner' ? id : `ipfs://${id}`;
      }
      if (accountUid) {
        out.accountUid = `hm://${accountUid}`;
      }
      if (grantId) {
        out.grantId = grantId.id;
      }
      return out;
    });
  }, [capabilities]);

  // Handle case where there are no capabilities
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return <EmptyState message="No capabilities available" icon={Shield} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {preparedCapabilities.map((capability) => (
        <div key={capability.id}>
          <DataViewer data={capability} onNavigate={navigate} />
        </div>
      ))}
    </div>
  );
};

export default CapabilitiesTab;
