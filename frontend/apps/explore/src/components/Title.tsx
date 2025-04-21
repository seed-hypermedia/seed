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
    <div className={`flex items-center ${className}`}>
      <h1 className="text-2xl font-bold">{children}</h1>
      {buttons && <div className="flex ml-2">{buttons}</div>}
    </div>
  );
};
