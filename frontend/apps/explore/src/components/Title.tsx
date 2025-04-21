import React from "react";

interface TitleProps {
  children: React.ReactNode;
  className?: string;
  buttons?: React.ReactNode;
}

export const Title: React.FC<TitleProps> = ({
  children,
  className = "",
  buttons,
}) => {
  return (
    <div className={`flex items-center w-full ${className}`}>
      <h1 className="flex-grow min-w-0 overflow-hidden text-2xl font-bold break-words">
        {children}
      </h1>
      {buttons && <div className="flex flex-shrink-0 ml-auto">{buttons}</div>}
    </div>
  );
};
