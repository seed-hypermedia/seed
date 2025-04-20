import React from "react";
import {FiDownload} from "react-icons/fi";

interface DownloadButtonProps {
  url: string;
}

export const DownloadButton: React.FC<DownloadButtonProps> = ({url}) => {
  const handleDownload = () => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <button
      onClick={handleDownload}
      className="p-2 ml-2 text-gray-500 transition-colors hover:text-gray-700"
      title="Download"
    >
      <FiDownload />
    </button>
  );
};
