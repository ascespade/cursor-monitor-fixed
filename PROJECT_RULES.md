# Project Rules & Conventions (Starter)

> **Purpose**: This file defines the baseline architecture, naming, and quality
> standards for any project derived from this starter. AI agents and humans
> must treat this as the source of truth.

## 1. Architecture Overview

- **App Router (Next.js)**
  - `app/` contains routing and thin page/layout components only.
  - No heavy business logic directly inside `app/`.

- **Core / Domain (`src/core/`)**
  - `domain/`: entities, value objects, pure domain logic.
  - `interfaces/`: contracts for repositories, services, and use-cases.
  - `security/`: auth, RBAC, and cross-cutting security concerns.
  - `use-cases`: application services that orchestrate domain operations.

- **Infrastructure (`src/infrastructure/`)**
  - `supabase/`: Supabase client and repository implementations.
  - `integrations/`: external APIs (e.g. payments, messaging, AI, etc.).

- **Features (`src/features/`)**
  - Vertical slices per domain area (e.g. `auth/`, `monitoring/`, `billing/`).
  - Each feature may contain:
    - `api/` – feature-specific API routes or handlers.
    - `components/` – feature-local UI.
    - `services/` – feature-level orchestration/building on core use-cases.
    - `validations/` – Zod schemas.
    - `types/` – feature-specific types.

- **Shared (`src/shared/`)**
  - `components/` – reusable UI across features.
  - `utils/` – pure utility functions (no I/O side effects).
  - `constants/` – global constants.
  - `types/` – global shared types.
  - `validations` – shared Zod schemas.
  - `hooks/` – reusable React hooks.
  - `providers/` – global React providers (Supabase, theme, etc.).

- **Config (`src/config/`)**
  - `env.ts` – Zod-validated env config.
  - `agent-prompts.ts` – centralized AI prompts.
  - `prompts/` – individual prompt files (master + modes).

## 2. Naming & File Placement

- **Files**
  - Components (React): `PascalCase.tsx` (e.g. `UserCard.tsx`).
  - Hooks: `use-name.hook.ts` (e.g. `use-auth.hook.ts`).
  - Services: `name.service.ts` (e.g. `user.service.ts`).
  - Repositories: `name.repository.ts`.
  - Validations: `name.validations.ts`.
  - API route helpers: `name.api.ts` (if extracted from route handlers).

- **Folders**
  - Feature folders: `kebab-case` (e.g. `example-feature`, `auth`, `monitoring`).
  - Shared and core folders follow the existing pattern (`components`, `utils`, etc.).

- **Placement Rules**
  - UI that is **reused across multiple features** → `src/shared/components/`.
  - UI that is **specific to a single feature** → `src/features/<feature>/components/`.
  - Cross-feature utilities → `src/shared/utils/`.
  - Domain/business rules → `src/core/domain/` or `src/core/use-cases/`.
  - External API wiring or DB details → `src/infrastructure/`.

## 3. Centralization & DRY

- Prefer **one canonical implementation** per concern:
  - Supabase client: centralized in `src/infrastructure/supabase/`.
  - Env parsing: centralized in `src/config/env.ts`.
  - AI prompts: centralized in `src/config/agent-prompts.ts` and `src/config/prompts/`.

- When duplication appears (same pattern in 3+ places):
  - Extract to `src/shared/` or `src/core/` depending on whether it is UI or domain.

## 4. Code Quality & Clean Code

- **TypeScript**
  - No `any` – use proper types, generics, or `unknown` with type guards.
  - Explicit return types for all exported functions.
  - Avoid non-null assertions (`!`) except in extremely well-guarded situations.

- **React / Next.js**
  - Components should be small, focused, and composable.
  - Move business logic to hooks or services, not directly in components.
  - Explicitly handle loading/empty/error/success states.

- **Validation**
  - Use Zod for all external inputs (API, forms, env).

- **Error Handling & Logging**
  - Use structured logging utilities from `src/shared/utils/logger.ts` (when added).
  - No `console.log` in production code paths.

## 5. Supabase & Auth

- Supabase clients must be created via the helpers in `src/infrastructure/supabase/`.
- Do not instantiate Supabase clients ad-hoc in random files.
- Auth-related UI and flows should live in a dedicated `src/features/auth/` module
  (to be created per project), not scattered across pages.

## 6. Tailwind & Preline

- Tailwind utility classes are preferred for layout and styling.
- Preline is enabled via `PrelineClient` and Tailwind plugin; interactive components
  should follow Preline patterns where appropriate.

## 7. AI Agents & Rules

- AI agents must:
  - Use `src/config/agent-prompts.ts` as the authoritative prompt source.
  - Respect these rules as described in the MASTER_PROMPT and modes.
  - Prefer reading this file (`PROJECT_RULES.md`) when unsure about structure
    or naming.

- When modifying architecture or adding features, the agent should:
  - Align changes with the architecture described above.
  - Prefer incremental refactors that leave the project in a cleaner state.

## 8. Documentation Rules

- Documentation files are **centralized and minimal**:
  - Global rules and conventions → `PROJECT_RULES.md` (this file).
  - High-level architecture notes → `docs/architecture.md` (optional, if needed).
  - Feature overviews → either a section in `docs/features.md` or a single
    `README.md` inside `src/features/<feature>/`.

- **Do NOT** create ad-hoc markdown files (e.g. `FINAL_STATUS_2.md`,
  `featureX-notes.md`) in the project root or scattered folders.

- When updating a feature or architecture:
  - Prefer updating the existing relevant doc/section.
  - Only add a new doc if there is a clear, persistent need.

- Small refactors or minor fixes:
  - Do not require new docs; rely on code headers and commit messages.

## 9. Scripts Rules

- All reusable scripts must live under `scripts/`.

- Only create a new script when:
  - The operation will be reused (e.g. seeding, migrations, reference builders).
  - Or it performs a non-trivial, multi-step operation.

- **Do NOT** create one-off scripts for tiny edits (e.g. to change a line
  in a single file). Prefer editing files directly.

- Every script must include a header comment that documents:
  - Purpose
  - Usage (npm script or CLI command)
  - When it should be run (and by whom)

---

This file is intentionally concise. Per-project teams can extend it with
additional rules, but should keep the same structure and spirit.
