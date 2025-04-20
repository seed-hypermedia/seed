import React from "react";
import {FiExternalLink} from "react-icons/fi";

interface ExternalOpenButtonProps {
  url: string;
}

export const ExternalOpenButton: React.FC<ExternalOpenButtonProps> = ({
  url,
}) => {
  const handleClick = () => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <button
      onClick={handleClick}
      className="p-2 ml-2 text-gray-500 transition-colors hover:text-gray-700"
      title="Open in new tab"
    >
      <FiExternalLink />
    </button>
  );
};
