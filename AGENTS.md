# AGENTS.md

Instructions for AI coding agents (Claude Code, GitHub Copilot, Codex, etc.) working in this repository.
See [README.md](README.md) for full setup, deployment and Azure details.

## Project overview

FlashCardSage is a flash card app for learning a language. The first version is a plain list of flash cards,
each with one or more Spanish words or phrases and their English translations (e.g. "solo" and "únicamente"
for "only"), that the signed-in user can add, edit and delete. A card can have a picture of its meaning, made by
FLUX.2-pro on Azure AI Foundry on request and kept in Azure Blob Storage (or as local files when no storage connection string is set, as in local development and E2E tests).
The cards page also suggests a handful of new cards, which gpt-5-mini on the same Foundry resource picks from the
user's cards, and which of the user's tags fit a card being added or edited. The Tags page suggests a handful of new
tags the same way. The Import cards page can also scan a
document the user uploads for up to 100 new cards, made by the same model.

- `backend/FlashCardSage.Api`: ASP.NET Core Web API (.NET 10) with EF Core, SQL Server and controllers.
  OpenAPI is served at `/openapi/v1.json` and Scalar at `/scalar` in every environment.
- `backend/FlashCardSage.Api/Mcp` and `Startup/McpSetup.cs`: the MCP server at `/mcp` (ModelContextProtocol.AspNetCore,
  stateless), whose tools let an AI assistant work with the signed-in user's cards, tags and decks through the same
  services the controllers use. See the README's "Connect an AI assistant (MCP)" section.
- `backend/FlashCardSage.Database`: DbUp console app that runs the SQL migrations in `Scripts/`.
- `backend/FlashCardSage.Api.Tests`: xUnit backend tests.
- `frontend`: React 19 + TypeScript + Material UI (Vite). Unit tests use Vitest in `src/test`,
  and Playwright E2E tests are in `e2e`.
- `infra`: Bicep templates for Azure (App Service, Azure SQL, Storage static website,
  monitoring). `preview.bicep` is a pull request's preview environment, and `preview-shared.bicep`
  the plan and SQL server every preview shares (deployed from the PR's base branch).
- `.github/workflows/ci.yml`: build, test, CodeQL, E2E, PR what-if preview, deploy each PR to a
  preview environment, and deploy to production on `main`. `preview-cleanup.yml` deletes a PR's
  preview when it closes.

## Validation commands

Run the checks for every area you change. These match CI.

Backend (from repo root):

```bash
dotnet restore
dotnet build --no-restore
dotnet format FlashCardSage.slnx --verify-no-changes --no-restore
dotnet test --no-build
```

Frontend (from `frontend/`):

```bash
npm ci
npx tsc -b
npx vite build
npx eslint . --max-warnings 0
npx prettier --check .
npm test
```

E2E (from `frontend/`; Playwright starts the backend and frontend itself):

```bash
npx playwright install chromium --with-deps   # first time only
npm run test:e2e
```

## Running locally

- Backend: `cd backend/FlashCardSage.Api && dotnet run` runs at `http://localhost:5269`. Development
  uses an in-memory database by default (`UseInMemoryDatabase` in `appsettings.Development.json`).
- Frontend: `cd frontend && npm run dev` runs at `http://localhost:5173`. Set `VITE_API_BASE_URL`
  if the API is elsewhere.
- Dev container: `.devcontainer/` runs the app next to a SQL Server container, and the API uses
  SQL by default there. See the README's "Dev Container" section.

## Conventions

- Keep changes minimal and scoped to the requested task. Don't edit unrelated files for style.
- Reuse existing patterns and naming in nearby files, and match the surrounding comment density.
- Avoid new dependencies unless they're needed.
- Formatting is enforced: `.editorconfig` + `dotnet format` for C#, Prettier + ESLint for the
  frontend. Line endings are LF.
- Warnings fail the build. The backend uses `AnalysisLevel` `latest-recommended` with
  `TreatWarningsAsErrors` (`backend/Directory.Build.props`). Frontend ESLint uses type-checked
  typescript-eslint rules plus the jsx-a11y, Vitest, Testing Library and Playwright plugins, with
  `--max-warnings 0`.
- Controllers and MCP tools don't use `FlashCardDbContext`. Their data access goes in a service in `Services/` (or
  `OAuth/`), which `LayeringTests` enforces.
- Add or update tests for new or changed behavior.

### Sign-in and data ownership

- Every API endpoint needs a signed-in user unless it's marked `AllowAnonymous` (`/health`, OpenAPI, Scalar, and the
  OAuth server's `/.well-known/*` and `/oauth/*`). See `backend/FlashCardSage.Api/Authentication/`,
  `backend/FlashCardSage.Api/OAuth/` and the README's "Sign-in" section. The OAuth server's `fcs_at_` access tokens
  only sign in on `/mcp`.
- Flash cards belong to a user. `FlashCardDbContext` filters them to the current user and sets the owner on new
  ones. Anything added later that hangs off a card must be reached through its card, so a new endpoint must look
  that up first, or it can reach another user's data.
- The built-in decks users can import belong to a system user (`Subject` `system`, which no sign-in can produce). The
  API adds any that are missing from `backend/FlashCardSage.Api/SystemDecks/system-decks.json` when it starts, and
  only `SystemDeckImporter` reads them past the query filter. Importing copies them, so edit the JSON to change
  them: a deck that's already in the database is left as it is, so a changed deck needs a new name or a script.
  Their pictures are committed in `SystemDecks/images` (made by `scripts/Generate-SystemDeckImages.ps1`), and the API
  puts them on the cards, and in the picture cache, when it starts (`SystemDeckImageSync`). Importing a card shares
  its built-in picture through the cache rather than copying it. A new built-in card needs the script run for it too.
- Cached translations (`Translations`, read and written by `CachedTranslator`) and generated pictures
  (`GeneratedImages`, read and written by `CachedImageGenerator`) are the only things that belong to no user: a text
  translates the same way for everyone and a picture of some words suits anyone, so there's no owner and no query
  filter. A card given a generated picture points at the cached file, which every card with it shares, so card code
  must delete pictures through `TryDeleteCardPicturesAsync`, which leaves cached ones alone. The OAuth server's
  apps, sign-ins in progress and tokens have no owner or filter either, since they're looked up before anyone is
  signed in; a token reaches its grant (owned like a card) with `IgnoreQueryFilters()`.
- MCP tools follow the same rules: they act only through the services, and report problems by throwing
  `McpException` with the controllers' user-facing messages (`Mcp/ToolErrors.cs`). Register a new tool class with `WithTools<T>()` in `McpSetup` (the assembly-scanning overloads fail the build). A new or renamed
  tool updates the pinned list in `McpServerTests` and gets tests of its own in `FlashCardSage.Api.Tests/Mcp/`.
- Local dev, E2E and PR previews use test sign-in (`Bearer test:<name>`); production never turns it on.
- Admin endpoints use `[Authorize(Policy = AuthenticationSetup.AdminPolicy)]`, which lets in only the users whose email
  or subject is in the `Admin:Users` allow-list (`Admin/AdminUsers.cs`; production's comes from `ADMIN_USERS`). They
  read past the per-user query filters only through `AdminService`, which is read-only and shows people only.

### Database

- The schema is owned by DbUp scripts in `backend/FlashCardSage.Database/Scripts/`, not EF Core
  migrations. For a schema change, add a new numbered script (e.g. `0003-Description.sql`) and
  never edit one that has already shipped. Keep the EF model in `FlashCardSage.Api` in sync with it.
- When the schema changes, review the preview seed data (`.github/scripts/preview-seed-data.json`,
  loaded through the API by `.github/scripts/seed-preview.sh`) and update it if needed, so new
  previews show the new data (e.g. a new field on cards).
- Production is an Azure SQL Basic database, but PR previews are serverless and auto-pause. Keep the
  transient-error retry handling in `Startup/DatabaseSetup.cs` and `DbUpRunner.cs` intact.

### Infrastructure

- Bicep in `infra/` owns **all** App Service app settings. Add new settings in
  `infra/modules/appservice.bicep` (and `infra/preview.bicep` for previews), never by hand in the
  portal.
- The templates don't manage identities, role assignments or database users. Production's are set
  up by `infra/Setup-Environment.ps1` (see README), so a new identity, role or GitHub variable
  belongs there too. Preview web apps' database users are created by the `deploy-preview` job
  (`.github/scripts/preview-db-user.sql`), so don't add manual steps for them.
- A deployment doesn't delete resources removed from the template. After deploying, `deploy-infrastructure` deletes any
  alert rules the template no longer defines (`.github/scripts/orphaned-resources.sh` and `delete-orphaned-alerts.sh`)
  and warns about anything else, and the PR what-if comment lists the same resources.
- Pushes to `main` deploy to production, so treat changes to `ci.yml` and `infra/` with care.

## Pull requests

- Keep PRs small and focused, and follow `.github/PULL_REQUEST_TEMPLATE.md`.
- Make sure the backend and frontend checks pass for the areas you touched.
- When a change affects the UI, take screenshots and attach them to the PR description.
- Whenever you push to a branch that has an open PR, first `git fetch origin` and check whether the branch
  conflicts with the PR's base branch (usually `main`). If it does, resolve the conflicts in the same push: merge
  the base into the branch (don't rebase or force-push), keep both sides' intent, then rerun the checks for every
  area the merge touched. They also catch breaks Git doesn't flag, like a type the base started using in a new
  way. Mention the merge and anything you had to change when you report the push.
