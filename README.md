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

## Сборка FlowPost Agent

FlowPost Agent — desktop-приложение, которое подключается к FlowPost по одноразовому pairing code и запускает локальный браузер через Playwright. Electron используется только как оболочка Agent: окно приложения, ввод кода, статус подключения, подготовка браузера, отключение и удаление локальных профилей.

Playwright runner находится в `apps/agent/src/automation-runner.js`. Он запускает Chromium через `chromium.launchPersistentContext` с `headless: false`. Профили браузера хранятся локально:

- macOS: `~/Library/Application Support/FlowPost/browser-profiles/dzen` и `~/Library/Application Support/FlowPost/browser-profiles/vc`
- Windows: `%APPDATA%/FlowPost/browser-profiles/dzen` и `%APPDATA%/FlowPost/browser-profiles/vc`

Пользователь не устанавливает Node.js, npm, Playwright или Chromium вручную. В текущей реализации используется first-run подготовка браузера: Agent проверяет Playwright Chromium в `%APPDATA%/FlowPost/ms-playwright` или `~/Library/Application Support/FlowPost/ms-playwright`, при необходимости скачивает его сам и показывает в UI статус “FlowPost подготавливает браузер для публикации”.

```bash
npm run agent:dev
npm run agent:build:mac:arm64
npm run agent:build:mac:x64
npm run agent:build:mac:universal
npm run agent:build:win
npm run agent:build
```

Архитектуры:

- `arm64` — Mac Apple Silicon: M1/M2/M3/M4.
- `x64` — Intel Mac.
- `universal` — объединенная macOS-сборка. Если локальная сборка universal нестабильна, используйте отдельные `arm64` и `x64` артефакты, а universal оставьте как release TODO.
- `win` — Windows NSIS installer. Надежнее собирать на Windows runner в GitHub Actions.

Стабильные имена артефактов:

- `apps/agent/dist/FlowPost-Agent-0.1.0-arm64.dmg`
- `apps/agent/dist/FlowPost-Agent-0.1.0-x64.dmg`
- `apps/agent/dist/FlowPost-Agent-0.1.0-win.exe`

Загрузите готовые файлы в GitHub Releases, например в release `agent-v0.1.0`, затем добавьте ссылки в Render env:

```bash
NEXT_PUBLIC_AGENT_MAC_DOWNLOAD_URL=https://github.com/<owner>/<repo>/releases/download/agent-v0.1.0/FlowPost-Agent-0.1.0-arm64.dmg
NEXT_PUBLIC_AGENT_WINDOWS_DOWNLOAD_URL=https://github.com/<owner>/<repo>/releases/download/agent-v0.1.0/FlowPost-Agent-0.1.0-win.exe
```

Если позже разделяем Mac-ссылки по архитектурам:

```bash
NEXT_PUBLIC_AGENT_MAC_ARM64_DOWNLOAD_URL=https://github.com/<owner>/<repo>/releases/download/agent-v0.1.0/FlowPost-Agent-0.1.0-arm64.dmg
NEXT_PUBLIC_AGENT_MAC_X64_DOWNLOAD_URL=https://github.com/<owner>/<repo>/releases/download/agent-v0.1.0/FlowPost-Agent-0.1.0-x64.dmg
NEXT_PUBLIC_AGENT_WINDOWS_DOWNLOAD_URL=https://github.com/<owner>/<repo>/releases/download/agent-v0.1.0/FlowPost-Agent-0.1.0-win.exe
```

GitHub Actions:

- `.github/workflows/build-agent.yml` собирает macOS `arm64`/`x64` DMG и Windows `.exe`.
- Запускается вручную через `workflow_dispatch` или при push tag `agent-v*`.

Signing/notarization:

- macOS может показать предупреждение при первом запуске, если сборка не подписана Apple Developer ID и не notarized.
- Windows может показать SmartScreen, если `.exe` не подписан code signing certificate.
- Для production release нужно добавить Apple signing/notarization и Windows code signing. Не пишите в интерфейсе, что Apple или Microsoft уже проверили приложение, пока это не настроено.

Render build command:

```bash
npm ci && npx prisma generate && npx prisma migrate deploy && npm run build
```

Do not add `npx playwright install --with-deps chromium` to the Render build. Visible browser automation belongs in FlowPost Desktop Agent, not on the web server.
