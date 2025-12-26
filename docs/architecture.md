# Architecture Overview (Starter)

This document complements `PROJECT_RULES.md` and provides a brief overview of how
this starter is intended to evolve:

- App Router pages in `app/` are thin; they delegate to feature modules.
- Domain and application logic are centralized under `src/core/`.
- Supabase integration lives under `src/infrastructure/supabase/` with helpers.
- Features live in `src/features/` as vertical slices.
- Shared UI and utilities live in `src/shared/`.

Projects derived from this starter should extend these sections with
project-specific notes rather than creating ad-hoc docs elsewhere.
