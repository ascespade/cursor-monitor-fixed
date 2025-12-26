/**
 * Component Template
 *
 * Purpose:
 * - Provide a reference structure for shared or feature components
 *   with typed props, clear responsibilities, and Tailwind/Preline usage.
 */
import type { FC, ReactNode } from 'react';

export interface ExampleCardProps {
  title: string;
  description?: string;
  icon?: ReactNode;
}

export const ExampleCard: FC<ExampleCardProps> = ({ title, description, icon }) => {
  return (
    <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60">
      <div className="flex items-center gap-3 mb-2">
        {icon && <div className="flex-shrink-0 text-slate-300">{icon}</div>}
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      {description && <p className="text-xs text-slate-400">{description}</p>}
    </div>
  );
};
