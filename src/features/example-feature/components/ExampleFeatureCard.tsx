/**
 * ExampleFeatureCard
 *
 * Purpose:
 * - Minimal example of a feature-level UI component that follows the
 *   shared design language and can be used as a reference for new features.
 */
import type { FC } from 'react';

export interface ExampleFeatureCardProps {
  title?: string;
}

export const ExampleFeatureCard: FC<ExampleFeatureCardProps> = ({ title = 'Example Feature' }) => {
  return (
    <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/60 flex flex-col gap-1">
      <span className="text-[0.7rem] font-mono text-slate-500">Feature Skeleton</span>
      <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      <p className="text-xs text-slate-400">
        This is an example feature component. Use this pattern when adding real features
        (feature-local components under src/features/&lt;name&gt;/components).
      </p>
    </div>
  );
};
