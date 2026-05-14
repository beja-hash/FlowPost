# Deployment Report: Posting / AI Content Distribution Platform

Дата подготовки: 2026-05-14

Этот отчёт описывает подготовку проекта к ручному деплою на Render. Деплой не выполнялся, логин в Render не использовался, реальные секреты не читались и не переносились.

## 1. Краткое описание проекта

Posting — Next.js / TypeScript SaaS для генерации, адаптации, планирования и публикации статей на VC.ru и Дзен.

Frontend и backend находятся в одном Next.js приложении:

- UI работает через App Router.
- Backend реализован через Next.js API routes.
- Prisma используется для доступа к PostgreSQL.
- Авторизация работает через NextAuth + Google OAuth.
- Генерация статей использует LLM через OpenAI-compatible client с Polza API.
- Стратегии / автопилот используют API routes и сервисные функции.
- Публикация на площадки реализована через Playwright и локальные browser sessions.

Проект нужно деплоить как Render Web Service, а не Static Site, потому что приложению нужны server-side rendering, API routes, Auth callbacks, Prisma и server-side LLM-запросы.

## 2. Что найдено в проекте

### package.json

Основные scripts:

| Script | Command | Назначение |
|---|---|---|
| dev | `next dev` | локальная разработка |
| build | `next build` | production build |
| start | `next start` | production start |
| lint | `eslint . --max-warnings=0` | lint |
| typecheck | `tsc --noEmit` | проверка TypeScript |
| db:generate | `prisma generate` | генерация Prisma Client |
| db:migrate | `prisma migrate dev` | локальные миграции |
| db:push | `prisma db push` | синхронизация схемы без миграций |
| db:studio | `prisma studio` | Prisma Studio |

Добавлено поле:

```json
"engines": {
  "node": ">=20.11.0"
}
```

### Next.js

- Конфиг: `next.config.ts`.
- Router: App Router.
- API routes: `src/app/api/**/route.ts`.
- Auth/proxy: `src/proxy.ts`.
- Dashboard routes: `src/app/(dashboard)/**`.
- Marketing routes: `src/app/(marketing)/**`.

### Prisma

- Schema: `prisma/schema.prisma`.
- Datasource provider: `postgresql`.
- Prisma config: `prisma.config.ts`.
- `DATABASE_URL` читается из env.
- Папки `prisma/migrations` сейчас нет.

Важно: для production лучше иметь реальные Prisma migrations и запускать `npx prisma migrate deploy`. Сейчас проект синхронизировался локально через `prisma db push`, но для production это менее безопасно.

### Auth

Авторизация: NextAuth v4 + Google OAuth + Prisma Adapter.

Основные файлы:

- `src/infrastructure/auth/auth-options.ts`
- `src/infrastructure/auth/session.ts`
- `src/proxy.ts`
- `src/app/api/auth/[...nextauth]/route.ts`

Для production критичны:

- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Google OAuth redirect URI должен быть добавлен в Google Cloud Console:

```text
https://your-app.onrender.com/api/auth/callback/google
```

## 3. Render services

### A. Нужно сразу

#### 1. Web Service

Нужен сразу.

Зачем:

- отдаёт Next.js UI;
- обслуживает API routes;
- выполняет NextAuth callbacks;
- выполняет Prisma-запросы;
- запускает LLM generation endpoints.

Render settings:

| Setting | Value |
|---|---|
| Service Type | Web Service |
| Runtime | Node |
| Root Directory | пусто, если репозиторий содержит проект в корне |
| Build Command | `npm ci && npx prisma generate && npm run build` |
| Start Command | `npm run start` |
| Health Check Path | `/api/health` |

#### 2. PostgreSQL

Нужен сразу.

Зачем:

- пользователи;
- рабочие пространства;
- бренды;
- статьи;
- публикации;
- стратегии;
- задачи автопилота;
- NextAuth accounts/sessions.

Prisma provider уже `postgresql`, менять схему под Render не нужно.

Render создаст `DATABASE_URL`, её нужно передать в Web Service.

### B. Желательно сразу

#### 1. Cron Job для стратегий

Желательно, если автопилот должен работать без ручного клика.

Endpoint:

```text
POST /api/cron/strategies/run
```

Пример schedule:

```text
*/15 * * * *
```

Пример команды Render Cron:

```bash
curl -X POST https://your-app.onrender.com/api/cron/strategies/run \
  -H "Authorization: Bearer $CRON_SECRET"
```

Что делает:

- создаёт rolling week schedule;
- генерирует ближайшие статьи;
- помечает просроченные client-agent публикации как ожидающие агента;
- запускает server-managed публикации только для будущего Premium режима.

Endpoint теперь защищён `CRON_SECRET` в production.

#### 2. Cron Job для scheduled articles

Endpoint:

```text
POST /api/articles/scheduler/run
```

Пример:

```bash
curl -X POST https://your-app.onrender.com/api/articles/scheduler/run \
  -H "Authorization: Bearer $CRON_SECRET"
```

Важно: этот endpoint вызывает `publishDueScheduledArticles()`, а публикация использует Playwright. Для Standard/Middle это не основной путь, потому что публикация должна идти через браузер клиента. Использовать осторожно.

### C. Позже

#### 1. Background Worker

Сейчас отдельного `npm run worker` нет.

Лучше добавить позже для:

- генерации недели пачками;
- long-running LLM jobs;
- очередей публикаций;
- retries;
- progress tracking;
- Premium server-managed publishing.

#### 2. Redis / Valkey / Key Value

Сейчас Redis не используется.

Понадобится позже для:

- job queue;
- locks;
- progress generation UI;
- rate limiting;
- idempotency для тяжелых задач;
- разделения Web Service и Worker.

#### 3. Отдельный Publishing Worker

Понадобится для Premium server-managed публикации, если публикация должна происходить на сервере, а не через компьютер клиента.

## 4. Render blueprint

Добавлен `render.yaml`.

Он описывает:

- `posting-web` как Node Web Service;
- `posting-postgres` как PostgreSQL database;
- основные env variables без реальных секретов.

Cron/worker сервисы в blueprint не добавлены намеренно, чтобы не создавать лишнюю инфраструктуру до стабилизации production jobs.

## 5. Environment variables

| Variable | Required | Used in | Example | Notes |
|---|---:|---|---|---|
| `DATABASE_URL` | yes | `prisma.config.ts`, `src/lib/env.ts`, Prisma adapter | `postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public` | В Render взять из PostgreSQL service |
| `NEXTAUTH_URL` | yes | `src/lib/env.ts`, NextAuth | `https://your-app.onrender.com` | Должен совпадать с публичным URL |
| `NEXTAUTH_SECRET` | yes | `src/lib/env.ts`, `src/proxy.ts`, NextAuth | `random-32-plus-character-secret` | Сгенерировать безопасный секрет |
| `GOOGLE_CLIENT_ID` | yes | `src/lib/env.ts`, `auth-options.ts` | `xxx.apps.googleusercontent.com` | Google OAuth client |
| `GOOGLE_CLIENT_SECRET` | yes | `src/lib/env.ts`, `auth-options.ts` | `change-me` | Google OAuth secret |
| `POLZA_API_KEY` | yes for generation | `src/lib/llm.ts` | `change-me` | Без него генерация статей упадёт |
| `MODEL_ARTICLE_GENERATION` | no | `src/lib/llm.ts` | `openai/gpt-4.1-mini` | Есть default |
| `CRON_SECRET` | yes for production cron | cron endpoints | `random-cron-token` | Используется в Authorization Bearer |
| `STRATEGY_CATCH_UP_WINDOW_HOURS` | no | `strategy-service.ts` | `72` | Default 72 часа |
| `DEBUG_DZEN_NAVIGATION_ONLY` | no | `article-workflow.ts` | `false` | Только локальная диагностика |
| `NODE_ENV` | yes on Render | Next.js / env validation | `production` | Render обычно выставляет сам, но blueprint задаёт явно |

`.env.example` обновлён и не содержит реальных секретов.

## 6. Build and start commands

Рекомендуемый Render Build Command:

```bash
npm ci && npx prisma generate && npm run build
```

Рекомендуемый Render Start Command:

```bash
npm run start
```

Почему не добавлять миграции прямо в build:

- build может запускаться повторно;
- миграции лучше выполнять отдельным manual step / one-off job;
- сейчас в проекте нет папки `prisma/migrations`, поэтому `migrate deploy` нечего применять.

## 7. Prisma production flow

Сейчас:

- schema есть;
- provider PostgreSQL;
- migrations folder отсутствует.

Перед production лучше сделать миграцию:

```bash
npx prisma migrate dev --name init
```

После появления `prisma/migrations` на Render запускать:

```bash
npx prisma migrate deploy
```

Если нужно быстро поднять тестовый Render без миграций, можно один раз выполнить:

```bash
npx prisma db push
```

Но для production это рискованнее, чем migrations.

## 8. Playwright and publishing

Публикация на VC.ru и Дзен использует Playwright.

Ключевые файлы:

- `src/services/article-workflow.ts`
- `src/features/platforms/server/platform-service.ts`
- `src/platforms/dzen/publisher.ts`
- `src/platforms/vc/publisher.ts`
- `src/infrastructure/platforms/session-manager.ts`

Сессии браузера хранятся локально в папке:

```text
sessions/
```

Эта папка добавлена в `.gitignore`.

Важные выводы для Render:

- основной сайт можно деплоить без серверной публикации;
- Standard/Middle автопубликация должна работать через подключённый браузер клиента;
- локальные browser sessions на Render не будут теми же сессиями, что на компьютере клиента;
- без Persistent Disk файлы в `sessions/` на Render могут потеряться;
- для server-side Playwright на Render потребуются Chromium dependencies и, вероятно, build step `npx playwright install chromium`;
- Premium server-managed publishing лучше выносить в отдельный Worker/Service с persistent storage и очередью.

Сейчас не рекомендуется включать серверную публикацию как основной production flow для Standard/Middle.

## 9. Background jobs and cron

Найденные endpoints:

| Endpoint | Purpose | Production readiness |
|---|---|---|
| `POST /api/cron/strategies/run` | jobs стратегий / автопилота | готов к cron, защищён `CRON_SECRET` |
| `POST /api/articles/scheduler/run` | публикация scheduled publications | защищён `CRON_SECRET`, но использует Playwright |
| `POST /api/dev/run-strategy-jobs` | dev ручной запуск jobs | в production возвращает 404 |

Очереди, Redis, BullMQ, node-cron не используются.

## 10. Deployment steps

1. Создать GitHub repo.
2. Запушить код, не добавляя `.env`.
3. Создать PostgreSQL database в Render или использовать `render.yaml`.
4. Создать Web Service.
5. Указать Root Directory пустым, если проект в корне репозитория.
6. Указать Build Command:

   ```bash
   npm ci && npx prisma generate && npm run build
   ```

7. Указать Start Command:

   ```bash
   npm run start
   ```

8. Добавить env variables из таблицы выше.
9. В Google Cloud Console добавить redirect URI:

   ```text
   https://your-app.onrender.com/api/auth/callback/google
   ```

10. Запустить первый deploy.
11. Применить БД:

   - если есть migrations: `npx prisma migrate deploy`;
   - если migrations ещё нет и это тестовый запуск: `npx prisma db push`.

12. Проверить:

   ```text
   https://your-app.onrender.com/api/health
   ```

13. Проверить login через Google.
14. Создать бренд.
15. Проверить генерацию статьи.
16. Проверить создание стратегии.
17. Проверить `POST /api/cron/strategies/run` через Render Cron или curl с `CRON_SECRET`.
18. Проверить, что Standard/Middle публикации ожидают клиентский браузер, а не требуют серверной Playwright публикации.

## 11. Known risks

- Нет `prisma/migrations`: для production нужно создать migrations или осознанно использовать `db push` только для тестового деплоя.
- `NEXTAUTH_URL` должен точно совпадать с Render URL.
- Google OAuth callback должен быть добавлен в Google Cloud Console.
- `POLZA_API_KEY` обязателен для генерации статей.
- Долгие LLM-запросы и генерация недели могут упереться в timeout Web Service/API route.
- Для batch generation лучше добавить background worker и очередь.
- Playwright на Render требует отдельной настройки Chromium и системных зависимостей.
- Локальные browser sessions в `sessions/` не являются надёжным storage на Render без Persistent Disk.
- Server-managed publication для Premium потребует отдельной архитектуры.
- Cron endpoints требуют `CRON_SECRET` в production.
- В production сейчас включён подробный NextAuth debug logger; перед публичным запуском стоит уменьшить шум логов.

## 12. Что нужно сделать до настоящего production deploy

- Создать Prisma migrations.
- Проверить production `DATABASE_URL`.
- Проверить `NEXTAUTH_URL`.
- Проверить Google OAuth callback URL.
- Добавить `POLZA_API_KEY`.
- Добавить `CRON_SECRET`.
- Решить, нужен ли Render Cron сразу.
- Решить, нужна ли серверная Playwright публикация сейчас. Для Standard/Middle — не нужна.
- Проверить production build на чистом окружении.
- После деплоя проверить `/api/health`, login, генерацию, стратегии.

## 13. Результаты локальной проверки

Команды, выполненные во время подготовки:

```bash
npx prisma generate
npm run lint
npm run typecheck
npm run build
```

Build проходит. В сборке остаются Turbopack warnings про NFT trace из-за Playwright/platform publisher imports. Они не ломают сборку, но указывают, что серверная публикация через Playwright требует отдельного внимания перед production hardening.

При обновлении `package-lock.json` команда `npm install --package-lock-only` показала предупреждение `EBADENGINE` для транзитивного пакета `@prisma/streams-local`, который объявляет `node >=22.0.0`. Текущий локальный Node `v20.20.0` всё равно успешно выполнил Prisma generate, lint, typecheck и build. Для Render можно начать с Node 20+, но если Prisma/зависимости начнут требовать Node 22 на clean install, нужно переключить Render Runtime на Node 22.
