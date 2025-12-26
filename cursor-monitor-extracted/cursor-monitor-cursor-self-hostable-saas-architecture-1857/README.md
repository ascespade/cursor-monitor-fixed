# Next Supabase Preline Starter

Next.js App Router + Supabase Auth/DB + Tailwind CSS + Preline UI starter, designed as a **professional SaaS baseline** and GitHub template.

## Stack

- **Next.js App Router** (14.x)
- **TypeScript** (strict config)
- **Supabase** (Auth + DB client helpers)
- **Tailwind CSS** + **Preline** (component-friendly Tailwind plugin)
- **Zod** for env validation
- Centralized **AI prompts** for agents (Cursor / similar) in `src/config/`

## Project Structure (High Level)

- `app/`
  - App Router routes, layouts, and route groups (thin UI orchestration).
  - Example routes:
    - `/(auth)/login` – email magic-link login with Supabase.
    - `/(dashboard)/dashboard` – simple authenticated area.
    - `/api/profile` – protected API endpoint using Supabase auth & shared error handling.
- `src/config/`
  - `env.ts` – Zod-validated env config.
  - `agent-prompts.ts` + `prompts/` – master + per-mode AI prompts.
- `src/core/`
  - `errors/` – `AppError` hierarchy for HTTP errors.
- `src/infrastructure/`
  - `supabase/` – browser/client helpers.
- `src/features/`
  - `auth/` – Supabase-based email login feature.
  - `example-feature/` – minimal feature skeleton.
- `src/shared/`
  - `components/` – `ErrorBoundary` etc.
  - `providers/` – `SupabaseProvider`, `PrelineClient`.
  - `utils/` – logger, API response + error handler.
- `docs/`
  - `architecture.md` – high-level architecture notes.
  - `features.md` – feature overview.
- `PROJECT_RULES.md`
  - Canonical rules for architecture, naming, docs, and scripts.

## Getting Started

1. **Clone the template-derived repo** (or click "Use this template" on GitHub).
2. Install dependencies:

```bash
npm install
```

3. Configure environment variables (e.g. in `.env.local`):

```bash
NEXT_PUBLIC_SUPABASE_URL=...      # Your Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=... # Your Supabase anon key
SUPABASE_SERVICE_ROLE_KEY=...     # Optional, server-side only
```

4. Run the dev server:

```bash
npm run dev
```

5. Visit:

- `http://localhost:3000/` – starter landing page.
- `http://localhost:3000/login` – email magic-link login.
- `http://localhost:3000/dashboard` – example authenticated area (after login).
- `http://localhost:3000/api/profile` – JSON profile endpoint (requires auth cookies).

## Quality Gates

- `npm run lint` – ESLint with `next/core-web-vitals` + `@typescript-eslint`.
- `npm run check` – `next lint` + `tsc --noEmit` (recommended before commits).

## AI Agent Usage

- System prompts and role prompts are defined in:
  - `src/config/prompts/master.prompt.ts` – `MASTER_PROMPT` (main system prompt).
  - `src/config/prompts/*.prompt.ts` – per-role mode prompts.
- Agents are expected to:
  - Respect `PROJECT_RULES.md` for structure, docs, and scripts.
  - Avoid creating ad-hoc docs/scripts outside the allowed locations.

## When Starting a New Project

- Adapt `metadata` in `app/layout.tsx` (title/description).
- Create real features under `src/features/<feature>/` using:
  - `templates/` for API routes, services, components, and hooks.
- Document new features in `docs/features.md` or a single `README.md` inside
  the feature folder, following `PROJECT_RULES.md`.

This starter is intentionally opinionated to keep future projects **consistent,
secure, and maintainable** out of the box.