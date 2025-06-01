import {LucideIcon} from "lucide-react";

interface EmptyStateProps {
  message: string;
  icon?: LucideIcon;
  className?: string;
}

export function EmptyState({
  message,
  icon: Icon,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-gray-500 ${className}`}
    >
      {Icon && <Icon className="w-12 h-12 mb-3 text-gray-400" />}
      <p className="text-center">{message}</p>
    </div>
  );
}

export default EmptyState;
