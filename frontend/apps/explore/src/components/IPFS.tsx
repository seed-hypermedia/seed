import React from "react";
import {useParams} from "react-router-dom";
import {useCID} from "../models";

const IPFS: React.FC = () => {
  const {cid} = useParams();
  const {data, isLoading} = useCID(cid);
  return (
    <div className="container p-4 mx-auto">
      <h1 className="mb-4 text-2xl font-bold">IPFS Route</h1>
      <p>This is the IPFS route page.</p>
      <p>CID: {cid}</p>
      <p>Data: {JSON.stringify(data)}</p>
    </div>
  );
};

export default IPFS;
