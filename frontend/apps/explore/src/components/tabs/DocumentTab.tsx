import React from "react";
import {DataViewer} from "../DataViewer";

interface DocumentTabProps {
  data: any;
  onNavigate: (url: string) => void;
}

const DocumentTab: React.FC<DocumentTabProps> = ({data, onNavigate}) => {
  return data ? <DataViewer data={data} onNavigate={onNavigate} /> : null;
};

export default DocumentTab;
