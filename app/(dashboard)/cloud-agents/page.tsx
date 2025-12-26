/**
 * Cloud Agents Dashboard Page
 *
 * Purpose:
 * - Top-level page that hosts the CloudAgentsDashboard feature.
 */
import Link from 'next/link';
import { CloudAgentsDashboard } from '@/features/cloud-agents/components/CloudAgentsDashboard';

export default function CloudAgentsPage() {
  return (
    <main className="h-screen flex flex-col relative z-10 w-full overflow-hidden bg-background">
      <header className="flex-shrink-0 px-2 sm:px-3 md:px-4 py-2 sm:py-2.5 md:py-3 border-b border-border bg-card-raised/80 backdrop-blur-md shadow-elevation-1">
        <div className="flex items-center justify-between gap-1.5 sm:gap-2 md:gap-3">
          <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 min-w-0 flex-1">
            <div className="relative flex-shrink-0">
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-primary rounded-full animate-ping opacity-75"></div>
              <div className="relative w-2.5 h-2.5 sm:w-3 sm:h-3 bg-primary rounded-full"></div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[0.6rem] sm:text-[0.65rem] md:text-xs font-mono text-muted-foreground mb-0.5 truncate hidden sm:block">Cursor Cloud Monitor</p>
              <h1 className="text-sm sm:text-base md:text-lg lg:text-xl font-semibold text-foreground tracking-tight truncate">
                <span className="hidden sm:inline">Cloud Agents Dashboard 🚀 UPDATED</span>
                <span className="sm:hidden">Agents 🚀</span>
              </h1>
            </div>
          </div>
          <div className="flex gap-0.5 sm:gap-1 md:gap-2 flex-shrink-0">
            <Link
              href="/cloud-agents/orchestrations"
              className="inline-flex items-center justify-center gap-0 sm:gap-1 md:gap-2 px-1.5 sm:px-2 md:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-border bg-card text-foreground hover:bg-primary/20 hover:border-primary/50 transition-smooth touch-manipulation min-w-[36px] sm:min-w-auto"
              title="Orchestrations"
            >
              <svg
                className="w-4 h-4 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="hidden md:inline">Orchestrations</span>
            </Link>
            <Link
              href="/cloud-agents/orchestrate"
              className="inline-flex items-center justify-center gap-0 sm:gap-1 md:gap-2 px-1.5 sm:px-2 md:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-smooth touch-manipulation min-w-[36px] sm:min-w-auto"
              title="Start Orchestration"
            >
              <svg
                className="w-4 h-4 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="hidden lg:inline">Start Orchestration</span>
              <span className="lg:hidden hidden sm:inline">Start</span>
            </Link>
            <Link
              href="/cloud-agents/repository-profiles"
              className="inline-flex items-center justify-center gap-0 sm:gap-1 md:gap-2 px-1.5 sm:px-2 md:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-border bg-card text-foreground hover:bg-primary/20 hover:border-primary/50 transition-smooth touch-manipulation min-w-[36px] sm:min-w-auto"
              title="Profiles"
            >
              <svg
                className="w-4 h-4 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="hidden md:inline">Profiles</span>
            </Link>
            <Link
              href="/cloud-agents/settings"
              className="inline-flex items-center justify-center gap-0 sm:gap-1 md:gap-2 px-1.5 sm:px-2 md:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-border bg-card text-foreground hover:bg-primary/20 hover:border-primary/50 transition-smooth touch-manipulation min-w-[36px] sm:min-w-auto"
              title="Settings"
            >
              <svg
                className="w-4 h-4 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <span className="hidden md:inline">Settings</span>
            </Link>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden">
        <CloudAgentsDashboard />
      </div>
    </main>
  );
}
