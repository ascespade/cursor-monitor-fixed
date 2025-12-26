/**
 * HomePage (Starter Landing Screen)
 *
 * Purpose:
 * - Explain what this starter provides: Next.js App Router, Clean Architecture layout,
 *   centralized AI agent prompts, and a reference-library builder for external docs.
 *
 * Audience:
 * - Engineers bootstrapping a new project from this template and exploring the available tooling.
 */
import { redirect } from 'next/navigation';

export default function HomePage() {
  redirect('/cloud-agents');
}
