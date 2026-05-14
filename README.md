# Northstar UI System

Static SaaS UI system built with:

- Next.js App Router
- TypeScript
- Tailwind CSS v4
- shadcn/ui

## What is included

- Responsive dashboard shell with sidebar and topbar
- Modern SaaS visual language inspired by Linear / Notion-style density
- Reusable cards, tables, buttons, inputs, toggles, tabs, and modal patterns
- Static mock pages with no business logic

## Routes

- `/dashboard` overview dashboard
- `/projects` card system + management table
- `/content` queue patterns + tabs
- `/analytics` metric and reporting layouts
- `/settings` buttons, inputs, toggles, modals
- `/sign-in` auth screen template
- `/pricing` marketing pricing template

## Structure

```text
src/
  app/                route layouts and static demo pages
  components/saas/    reusable SaaS-specific UI blocks
  components/ui/      shadcn/ui primitives
  entities/           shared navigation config
  lib/                utilities and mock demo data
```

## Run locally

```bash
npm install
npm run dev
```

## Verification

```bash
npm run lint
npm run typecheck
npm run build
```
