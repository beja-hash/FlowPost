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

## FlowPost Agent builds

The current release artifact `FlowPost Agent-0.1.0-arm64.dmg` is for macOS Apple Silicon only: M1, M2, M3, and M4.

```bash
npm run agent:dev
npm run agent:build:mac:arm64
npm run agent:build:mac:x64
npm run agent:build:mac:universal
npm run agent:build:win
npm run agent:build
```

TODO for release packaging:

- Build and test macOS x64 DMG on Intel macOS.
- Build and notarize macOS universal DMG when both arch builds are stable.
- Build and sign Windows NSIS `.exe` on Windows CI.

Agent architecture:

- Electron is only the desktop shell: pairing code, connection status, security settings, disconnect, and local profile deletion.
- Publishing browsers are launched inside the Desktop Agent through Playwright `chromium.launchPersistentContext` with `headless: false`.
- Browser profiles live under the Agent app data directory in `browser-profiles/dzen` and `browser-profiles/vc`.
- Cookies, platform sessions, and Dzen/VC.ru authorization stay in those local profiles and are not sent to FlowPost servers.

Render build command:

```bash
npm ci && npx prisma generate && npx prisma migrate deploy && npm run build
```

Do not add `npx playwright install --with-deps chromium` to the Render build. Visible browser automation belongs in FlowPost Desktop Agent, not on the web server.
