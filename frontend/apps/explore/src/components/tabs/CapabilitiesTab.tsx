import React, {useMemo} from "react";
import {useNavigate} from "react-router-dom";
import DataViewer from "../DataViewer";

interface CapabilitiesTabProps {
  capabilities?: any[];
}

const CapabilitiesTab: React.FC<CapabilitiesTabProps> = ({capabilities}) => {
  const navigate = useNavigate();
  const preparedCapabilities = useMemo(() => {
    return capabilities?.map((capability) => {
      const {id, issuer, delegate, account, ...rest} = capability;
      const out = {...rest};
      if (id) {
        out.id = `ipfs://${id}`;
      }
      if (issuer) {
        out.issuer = `hm://${issuer}`;
      }
      if (delegate) {
        out.delegate = `hm://${delegate}`;
      }
      if (account) {
        out.account = `hm://${account}`;
      }
      return out;
    });
  }, [capabilities]);
  return preparedCapabilities?.map((capability) => (
    <div className="p-4">
      <DataViewer data={capability} onNavigate={navigate} />
    </div>
  ));
};

export default CapabilitiesTab;
