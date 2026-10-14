<h1 align="center"><img src="images/logo.svg" alt="FlashCardSage" width="360"></h1>

[![CI](https://github.com/dylan-smith/FlashCardSage/actions/workflows/ci.yml/badge.svg)](https://github.com/dylan-smith/FlashCardSage/actions/workflows/ci.yml)

A flash card app for learning a language, with:
- **Backend:** ASP.NET Core Web API (.NET 10) + Entity Framework Core + SQL Server
- **Frontend:** React 19 + TypeScript (Vite + Material UI)

## Features

- Sign in with a Google account; each user only sees their own flash cards
- Add, edit and delete flash cards (each card is a Spanish word or phrase and its English translation, and can have more than one of either for the same meaning, e.g. "solo" and "únicamente" for "only")
- Type either side of a card and the other is filled in with a translation from Azure AI Translator; type over it to change it
- Import a built-in deck (about 30 of them, such as Numbers 0–20, Food or Common verbs), which copies its cards and tags into your own; cards you already have are left out
- A handful of suggested new cards, which gpt-5-mini on Azure AI Foundry picks to go with your cards; add one with a click
- Ask for a picture of what a card means, made by FLUX.2-pro on Azure AI Foundry, which goes on the card when you save it unless you discard it; practice mode shows it once the card is revealed
- A Preferences page, where each user can turn off pictures, suggested cards and translation as they type
- RESTful API with OpenAPI support

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js](https://nodejs.org/) (LTS recommended)
- [npm](https://www.npmjs.com/)
- SQL Server (optional — an in-memory database is used by default in development)

## Local Development Setup

### Backend

```bash
cd backend/FlashCardSage.Api
dotnet run
```

The API starts at `http://localhost:5269` by default. In development mode an in-memory database is used automatically (configured in `appsettings.Development.json`). The OpenAPI document is served at `/openapi/v1.json`, and you can explore the API interactively with Scalar at `/scalar` (e.g. `http://localhost:5269/scalar`). Both are available in every environment, including production.

To use SQL Server for local development instead, set `UseInMemoryDatabase` to `false` and update the connection string in `backend/FlashCardSage.Api/appsettings.Development.json`.

Translation (`POST /api/translations`, which fills in the other side of a card as the user types) is off locally: without a `Translator:Key` the API answers it with a 503, and the frontend leaves both sides to the user. To try it, give the API the key of an Azure AI Translator resource (such as the preview one, `flashcardsage-preview-translator`) with `dotnet user-secrets set Translator:Key <key>` in `backend/FlashCardSage.Api`. The E2E tests stand in for the translator with Playwright's `page.route`.

Pictures (`POST /api/flashcards/images/generate`, which makes a picture of what a card means) are off locally the same way: without `ImageGeneration:Endpoint` and `ImageGeneration:Key` the API answers with a 503, and the form says pictures aren't available. To try it, give the API the endpoint and a key of an Azure AI Foundry resource with a `flux-2-pro` deployment (such as the preview one, `flashcardsage-preview-foundry`) with `dotnet user-secrets set ImageGeneration:Endpoint https://<name>.services.ai.azure.com/` and `dotnet user-secrets set ImageGeneration:Key <key>`. Pictures put on cards go to Azure Blob Storage when `ImageStore:StorageConnectionString` is set; otherwise (locally and in the E2E tests) the API keeps them as files in `backend/FlashCardSage.Api/App_Data/card-images` and serves them on `/card-images`. The E2E tests stand in for the generator with `page.route` and go through the real local image store.

Card suggestions (`GET /api/card-suggestions`, a handful of new cards that go with the user's) and tag suggestions (`POST /api/tag-suggestions`, which of the user's tags fit a card being added or edited) are off locally too: without `CardSuggestions:Endpoint` and `CardSuggestions:Key` the API answers with a 503, and the cards page leaves out the Suggested cards section and suggests no tags. To try it, use the same Foundry resource, which has a `gpt-5-mini` deployment too, with `dotnet user-secrets set CardSuggestions:Endpoint https://<name>.openai.azure.com/` and `dotnet user-secrets set CardSuggestions:Key <key>`. The E2E tests stand in for the model with `page.route`.

### Frontend

```bash
cd frontend
npm ci
npm run dev
```

The frontend dev server starts at `http://localhost:5173`. Set the `VITE_API_BASE_URL` environment variable if your backend runs on a different URL.

### Sign-in

Every API endpoint except `/health`, `/openapi/v1.json` and `/scalar` needs a signed-in user, sent as a bearer token. Flash cards belong to the user who created them, and nobody else can see or change them. The API knows three kinds of token:

- **Google ID tokens**: the frontend signs in with [Google Identity Services](https://developers.google.com/identity/gsi/web) and sends the ID token Google gives it. The API checks it against Google's keys and the OAuth client ID in `Authentication:Google:ClientId`. The frontend shows the Google button when `VITE_GOOGLE_CLIENT_ID` is set at build time. Google only accepts the origins registered on the OAuth client, so this is used in production (and locally if you set both values and `http://localhost:5173` is registered).
- **Test sign-in** (`test:<name>`): signs in as any name with no password, each name with its own data. It's on when `Authentication:AllowTestSignIn` is `true`, which `appsettings.Development.json`, the E2E tests and PR previews set; production never does. The frontend shows the test sign-in form in the Vite dev server and in builds with `VITE_ENABLE_TEST_SIGN_IN=true`.
- **The service token**: the secret in `Authentication:ServiceToken` signs in as one service user, so the production smoke tests and the Generate Load workflow can use the API. It's off when empty.

Locally, `dotnet run` and `npm run dev` need nothing more: sign in with the test sign-in form. To call the API from Scalar or curl, add a header such as `Authorization: Bearer test:Me`.

### Dev Container

The repo includes a dev container (`.devcontainer/`) with everything preinstalled: .NET 10, Node 24, Playwright Chromium, the Azure CLI with Bicep, the GitHub CLI and Claude Code. It also runs a SQL Server 2022 container next to the app. Open the repo in VS Code and choose **Dev Containers: Reopen in Container**, or open it in GitHub Codespaces. Docker is required locally.

When the container is created it restores packages, installs the frontend dependencies and Playwright, and runs the DbUp migrations against the SQL container. Inside the container:

- `dotnet run` for the API uses the SQL container by default (`UseInMemoryDatabase=false` and `ConnectionStrings__FlashCardSage` are set as container environment variables). Set `UseInMemoryDatabase=true` to use the in-memory database instead.
- The database lives in a named Docker volume, so data persists across container rebuilds. To apply new migrations, re-run `dotnet run --project backend/FlashCardSage.Database -- "$ConnectionStrings__FlashCardSage"`.
- The E2E tests always run the API in-memory, because they delete existing flash cards. Playwright never reuses an API that is already running, so stop your dev API before running `npm run test:e2e`, or Playwright fails because port 5269 is taken.
- Sign in to `az`, `gh` and `claude` yourself inside the container. Claude Code's config is stored in a named volume, so you only need to sign in once.

## Common Tasks

### Running Backend Tests

```bash
cd backend/FlashCardSage.Api.Tests
dotnet test
```

### Linting the Frontend

```bash
cd frontend
npm run lint
```

### Building the Frontend for Production

```bash
cd frontend
npm run build
```

The output is written to `frontend/dist`.

### Previewing the Production Build

```bash
cd frontend
npm run build && npm run preview
```

## Deployment

1. **Backend** — Publish the API with `dotnet publish -c Release` from `backend/FlashCardSage.Api`. Deploy the output to any host that supports .NET 10 (Azure App Service, Docker, etc.). Configure the `ConnectionStrings:FlashCardSage` setting to point to your production SQL Server instance and set `UseInMemoryDatabase` to `false`. Set `Authentication:Google:ClientId` to your Google OAuth client ID (see [Sign-in](#sign-in)), and `Authentication:ServiceToken` if anything needs to call the API without a person signing in. If the frontend will be served from a different origin than the API, also configure `Cors:AllowedOrigins` to include the production frontend URL(s) so the browser can call the API.

   **Application Insights** — The API automatically sends telemetry to Azure Application Insights when a connection string is available. Set the `APPLICATIONINSIGHTS_CONNECTION_STRING` environment variable (or the `AzureMonitor:ConnectionString` app setting) to your Application Insights connection string. When using Azure App Service, you can connect Application Insights directly from the Azure Portal, which sets `APPLICATIONINSIGHTS_CONNECTION_STRING` automatically. Telemetry is silently disabled when neither value is configured (e.g. during local development).

2. **Frontend** — Run `npm run build` in `frontend` and serve the contents of `frontend/dist` with any static file host (Azure Storage Account static website, Nginx, etc.). Set `VITE_API_BASE_URL` to the production API URL and `VITE_GOOGLE_CLIENT_ID` to the Google OAuth client ID before building. When using a different origin for the frontend, make sure the backend `Cors:AllowedOrigins` setting includes that frontend URL. Serve `index.html` with `Cache-Control: no-cache` so browsers pick up new versions; the hashed files under `assets/` can be cached for a long time. `npm run deploy` (`.github/scripts/deploy-frontend.sh`) does this for the Azure Storage static website.

   **Application Insights** — The frontend sends page views, exceptions, API calls and flash card events to Application Insights using the Application Insights JavaScript SDK when `VITE_APPINSIGHTS_CONNECTION_STRING` is set at build time (CI reads it from the API's `APPLICATIONINSIGHTS_CONNECTION_STRING` app setting, so both report to the same resource). API calls carry a W3C `traceparent` header, so each browser request and the API request it triggers share one operation in Application Insights. The SDK sets `ai_user` and `ai_session` cookies to count users and sessions. Telemetry is disabled when the variable isn't set (local development, unit tests and E2E runs).

## Project Structure

```
FlashCardSage/
├── backend/
│   ├── FlashCardSage.Api/          # ASP.NET Core Web API
│   ├── FlashCardSage.Database/     # Database CLI project for migrations
│   └── FlashCardSage.Api.Tests/    # xUnit backend tests
├── frontend/                        # React + TypeScript (Vite)
├── infra/                           # Bicep Infrastructure as Code
│   ├── main.bicep                   # Root Bicep template
│   ├── main.bicepparam              # Production parameter values
│   └── modules/                     # Reusable Bicep modules
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
└── README.md
```

## Run Playwright E2E tests

Playwright automatically starts the backend and frontend servers when tests run.
Before running tests for the first time, install dependencies and the test browser:

```bash
cd frontend
npm ci
npx playwright install chromium --with-deps
```

Then run the tests (this builds the frontend and launches both servers automatically):

```bash
npm run test:e2e
```

To run tests with the interactive UI:
```bash
npm run test:e2e:ui
```

## Azure Deployment

The CI workflow (`.github/workflows/ci.yml`) includes deployment jobs that run after all checks pass. Production deployment only runs on pushes to `main`; pull requests get a throwaway [preview environment](#pr-preview-environments) instead.

### Setting up a new environment

The templates create the Azure resources, but not the identities, role assignments, database users, GitHub settings or the Google OAuth client. `infra/Setup-Environment.ps1` sets up all of those except the Google OAuth client. It reads the names from `infra/main.bicepparam` and `infra/preview-shared.bicepparam`, creates whatever is missing and leaves what's already there, so it can be re-run, and `-WhatIf` shows what it would do. It needs the Azure CLI (`az login`) and the GitHub CLI (`gh auth login`, with admin access to the repository). Setting up for the first time, in order:

1. **Parameters**: in `infra/main.bicepparam`, set the resource names, `githubRepository`, `alertEmail`, `budgetStartDate` and the SQL Entra admin (`sqlEntraAdminLogin`, `sqlEntraAdminObjectId`: the person who will run step 5), and in `infra/preview-shared.bicepparam` the preview names. Storage account and SQL server names are global, so check they're free (`az storage account check-name`).
2. **Google OAuth client**: in the Google Cloud console, create a web application OAuth client. Its authorized JavaScript origins need the frontend origin, which exists after the first deployment (`https://flashcardsage.z22.web.core.windows.net`, or the custom domain), so come back to add it.
3. **Identities, roles and GitHub settings**: run `.\infra\Setup-Environment.ps1 -GoogleClientId <client id>`. It creates the resource groups (`FlashCardSage` and `FlashCardSage-Preview`), the four identities in [Identities & Permissions](#identities--permissions) with their federated credentials and role assignments, the `production` and `alert-investigation` environments restricted to `main`, the [variables](#required-github-variables), the `AZURE_SQL_CONNECTION_STRING` and service token [secrets](#required-github-secrets), and the [branch ruleset](CONTRIBUTING.md#branch-protection). It also writes the preview identity into `infra/preview-shared.bicepparam`, so commit that.
4. **First deployment**: push to `main`. `deploy-infrastructure` creates the resources, then `deploy-backend` fails at the migrations because the database users don't exist yet.
5. **Database users and backend URL**: run `.\infra\Setup-Environment.ps1 -Stage PostDeploy`, signed in to Azure as the SQL Entra admin. It creates the database users, sets `AZURE_BACKEND_URL` from the new App Service (Azure adds a random suffix to its host name) and re-runs the failed deployment. Then add the frontend origin it prints to the Google OAuth client.
6. **Optional**: Slack alerts and Claude investigations ([Alerts](#alerts), [Alert Investigation](#alert-investigation)), a [custom domain](#custom-domain), and the Dependabot and CI investigation tokens ([Required GitHub Secrets](#required-github-secrets)). The script's `-SlackWebhookUrl`, `-ClaudeCodeOAuthToken`, `-AlertInvestigationToken`, `-AutomergeToken` and `-TsCompatPrToken` parameters save those secrets; re-running it with just those changes nothing else.

### Infrastructure as Code

All Azure resources are defined using [Bicep](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/overview) templates located in the `infra/` directory:

```
infra/
├── main.bicep           # Root template — wires all modules together
├── main.bicepparam      # Production parameter values (resource names, regions, SKUs)
├── preview.bicep        # A pull request's preview environment (see PR preview environments)
├── preview.bicepparam   # Preview parameter values
├── preview-shared.bicep # The App Service plan, SQL server, Translator and Azure AI Foundry resource every preview shares
├── preview-shared.bicepparam # Their parameter values
├── Setup-Environment.ps1 # One-time setup of what the templates don't create (see Setting up a new environment)
├── modules/
│   ├── alerts.bicep     # Alert rules, action group, availability test, Slack notifier and budget
│   ├── appservice.bicep # App Service Plan + App Service (Linux/.NET 10) and its app settings
│   ├── foundry.bicep    # Azure AI Foundry with the image model (FLUX.2-pro) and the chat model (gpt-5-mini), which the API makes cards' pictures and suggests new cards with
│   ├── monitoring.bicep # Log Analytics Workspace + Application Insights
│   ├── sql.bicep        # Azure SQL Server (Entra-only auth) + serverless Database and its diagnostic logs
│   ├── storage.bicep    # Storage Account for the frontend static website, its custom domain and the cards' pictures
│   ├── translator.bicep # Azure AI Translator, which the API translates cards with
│   └── workbook.bicep   # "FlashCardSage Health" Azure Monitor Workbook
└── workbooks/
    └── health.workbook.json # Workbook content, with placeholder tokens for resource IDs
```

The `deploy-infrastructure` CI job runs `infra/main.bicep` on every push to `main`, ensuring the Azure environment is always in sync with the declared configuration. All other deployment jobs depend on this job.

The template owns **all** App Service app settings (connection string, CORS origin, Application Insights, the Translator and Azure AI Foundry keys and the storage account's connection string, which it reads from those resources themselves), so add new settings in `infra/modules/appservice.bicep` rather than in the portal — anything set by hand is removed on the next deployment. The static website (`$web` container, `index.html` documents) is a data-plane setting that ARM can't manage, so CI enables it with `az storage blob service-properties update`.

The **FlashCardSage Health** workbook (Application Insights → Workbooks, or in the resource group) shows API, frontend and infrastructure health on one page. It combines Application Insights telemetry, App Service and SQL logs from the workspace, and platform metrics for the App Service, SQL database and Storage account. Its **Overview** tab starts with any active alerts and shows the `/health` availability test results. Its **Overall** tile is the worst of the colored tiles, so it answers "is the app healthy?" at a glance. Exceptions only count against health when they need attention: API exceptions logged below Error (such as retried SQL connections while the database resumes), automated test traffic (smoke tests and Generate Load, which run in headless Chrome) and browser network errors the user recovered from are counted as expected, and the exception tables give the reason for each. Its **Alerts** tab shows how often each alert rule fired, when, and how long it took to resolve, for up to the last 30 days (how long Azure keeps fired alerts). Viewers with Reader on only the resource group don't see the subscription-wide Service Health alert there, and budget notifications are listed separately because they come from Cost Management. Its **Costs** tab shows this month's spend and forecast against the monthly budget, with a daily actual-and-forecast chart, then what the resource group costs in total, by service, by day and by resource, from Azure Cost Management (viewers need at least Reader on the resource group). Its **Investigate** tab links to the portal tools, logs and deployment history to check when digging into an incident, and says where to look when each alert fires. Its Application Insights time charts mark each backend deployment with the release annotation `azure/webapps-deploy` adds (green for success, red for a failed deployment). The workbook is also owned by the template, so edits made only in the portal are overwritten on the next deployment. To change it, edit it in the portal, copy the JSON from **Edit → Advanced Editor**, swap the resource IDs and site URLs back to the `__*__` tokens listed in `infra/modules/workbook.bicep`, and commit it to `infra/workbooks/health.workbook.json`.

To put some data on the workbook, run the **Generate Load** workflow (`.github/workflows/load-test.yml`) from the Actions tab and choose how many minutes it should run. It drives real browsers through the frontend and calls the API directly, including a few requests that fail on purpose, and deletes every flash card it created. It uses the `production` environment, so it can only run from `main`.

#### Alerts

`infra/modules/alerts.bicep` defines the alerts. They all notify the **FlashCardSage-Alerts** action group, which sends an email and an Azure mobile app push to `alertEmail` (set in `infra/main.bicepparam`). When the `SLACK_WEBHOOK_URL` secret is set, it also posts to Slack through the **FlashCardSage-SlackAlerts** Logic App. Metric and log alerts also send a message when they resolve. Each Slack message says what was measured against the threshold (or Azure's own explanation for resource and service health), links to the resource, the alert and the health workbook, and, when it fires, lists numbered **What to do** steps for investigating and fixing it. The steps live next to each rule in `alerts.bicep` (`steps`, or `alertSteps` for rules that aren't metric alerts), so update them when a rule or the workbook changes.

| Alert | Fires when | Sev |
|-------|------------|-----|
| API down | The availability test on `{api}/health` (one location, every 15 minutes) fails 3 of its last 4 runs, after 30 to 45 minutes of downtime | 1 |
| Resource health | Azure reports the App Service, database or storage account unavailable or degraded | 1 |
| Service health | Azure reports an incident or planned maintenance for App Service, SQL Database, Storage or Monitor in West US/West US 2 | 2 |
| API server errors | More than 5 HTTP 5xx responses in 15 minutes | 2 |
| API dependency failures | More than 10 failed backend dependency calls (mostly SQL) in 15 minutes | 2 |
| Browser errors | More than 5 frontend exceptions in an hour, not counting automated tests in headless Chrome | 2 |
| Browser API call failures | More than 5 failed API calls from the frontend in an hour | 2 |
| CPU quota | More than 45 of the F1 plan's 60 daily CPU minutes used in 24 hours (the app stops when they run out) | 2 |
| SQL free offer running out | Less than 20% of the month's free vCore-seconds left (the database pauses until next month when they run out) | 2 |
| Frontend storage availability | Blob storage less than 99% available over an hour | 2 |
| Slow API | Average response time over 5 seconds for 30 minutes (at least 10 requests, not counting deployment calls) | 3 |
| Slow page loads | 75th percentile page load over 4 seconds in 6 hours (at least 5 loads) | 3 |
| SQL storage | Database over 80% of its maximum size | 3 |
| Failure anomalies | Application Insights smart detection sees an unusual rise in failures | 3 |
| Monthly budget | Resource group costs pass 80% of `monthlyBudget`, or are forecast to pass 100% | — |

`/health` doesn't check the database, so the availability test doesn't stop the serverless database from auto-pausing. A backend deployment turns the availability test off while it has the API paused and back on when it finishes, so a deployment doesn't fire **API down**. If a deployment leaves the API paused, the test is still turned back on so the alert fires.

To set up Slack, create a Slack app with an **Incoming Webhook** for the alerts channel and save the webhook URL as the `SLACK_WEBHOOK_URL` repository secret. The next deployment creates the Logic App. To get push notifications, sign in to the Azure mobile app as `alertEmail`. To check the whole chain, open the action group in the portal and choose **Test**.

When the `ALERT_INVESTIGATION_TOKEN` secret is set too, Claude investigates every fired alert and posts what it finds in the same Slack channel. See [Alert Investigation](#alert-investigation).

Azure won't move a budget's start date once it exists, so `budgetStartDate` in `infra/main.bicepparam` stays fixed at the month the budget was first deployed. A new environment should set it to the first of the month it's created in.

#### Deploying Infrastructure Manually

To preview or apply infrastructure changes outside of CI, log in to Azure (`az login`, with MFA), set the runtime connection string and the sign-in settings, and run:

```powershell
$env:AZURE_SQL_CONNECTION_STRING = '<connection string>'
$env:GOOGLE_CLIENT_ID = '<Google OAuth client ID>'
$env:FLASHCARDSAGE_SERVICE_TOKEN = '<service token>'

# Preview — should show no Create/Delete against the existing resources
az deployment group what-if --resource-group FlashCardSage --template-file infra/main.bicep --parameters infra/main.bicepparam

# Apply
az deployment group create --resource-group FlashCardSage --template-file infra/main.bicep --parameters infra/main.bicepparam
```

#### Identities & Permissions

The template doesn't manage identities, role assignments or database users; `infra/Setup-Environment.ps1` creates them for a new environment (see [Setting up a new environment](#setting-up-a-new-environment)). The exception is [PR preview environments](#pr-preview-environments): the `deploy-preview` job creates each preview web app's database user itself.

| Identity | Grants |
|----------|--------|
| `flashcardsage-deploy` (user-assigned managed identity, `AZURE_CLIENT_ID`) | Federated credential for subject `repo:dylan-smith@<owner id>/FlashCardSage@<repo id>:environment:production`; **Contributor** and **Storage Blob Data Owner** on the resource group (static website setup, `npm run deploy` and database backup uploads use `--auth-mode login`, and the storage account doesn't exist until the first deployment); `db_owner` database user (runs the migrations and pre-migration backups) |
| `flashcardsage-pr-whatif` (user-assigned managed identity, `AZURE_WHATIF_CLIENT_ID`) | Federated credential for subject `repo:dylan-smith@<owner id>/FlashCardSage@<repo id>:pull_request`; custom **FlashCardSage What-If Reader** role (`*/read`, `Microsoft.Resources/deployments/validate/action`, `Microsoft.Resources/deployments/whatIf/action`, `Microsoft.Resources/deployments/write`) on the resource group |
| `flashcardsage-alert-investigator` (user-assigned managed identity, `AZURE_ALERT_INVESTIGATOR_CLIENT_ID`) | Federated credential for subject `repo:dylan-smith@<owner id>/FlashCardSage@<repo id>:environment:alert-investigation`; **Reader**, **Monitoring Reader**, **Log Analytics Reader** and **Cost Management Reader** on the resource group; **Monitoring Reader** on the subscription (Service Health events). Read-only, used by the alert investigation workflow |
| App Service system-assigned identity | `db_datareader` + `db_datawriter` database user (the API's runtime connection) |
| `flashcardsage-preview-deploy` (user-assigned managed identity, `AZURE_PREVIEW_CLIENT_ID`) | Federated credential for subject `repo:dylan-smith@<owner id>/FlashCardSage@<repo id>:pull_request`; **Contributor** and **Storage Blob Data Owner** on the `FlashCardSage-Preview` resource group; Entra admin of the preview SQL server (set by `infra/preview-shared.bicep`, so it can run migrations on and create users in every preview database). Deploys [PR preview environments](#pr-preview-environments), so it must have no rights outside that resource group: PR branches control the workflow that uses it |
| Preview web app system-assigned identities | `db_datareader` + `db_datawriter` user in the PR's database, created by the `deploy-preview` job |

GitHub issues OIDC tokens for this repo with immutable-ID subjects, so federated credentials must use the portal's **Other issuer** scenario (issuer `https://token.actions.githubusercontent.com`) rather than the GitHub Actions template. `<owner id>` and `<repo id>` are the numeric IDs from `gh api users/dylan-smith --jq .id` and `gh api repos/dylan-smith/FlashCardSage --jq .id`. The database users are created from the identities' client IDs (`CREATE USER ... WITH SID = ..., TYPE = E`, as in `.github/scripts/preview-db-user.sql`) rather than `FROM EXTERNAL PROVIDER`, which would need the SQL server to read Microsoft Entra ID.

#### PR Preview Environments

Every pull request from this repository (not forks, and not opened by Dependabot) is deployed to a preview environment of its own, so the change can be tried before it's merged. The `deploy-preview` job in `ci.yml` runs once the backend and frontend builds pass, and posts (then keeps updating) a **Preview environment** comment on the PR with the frontend and API links, the deployed commit and the time. It's done when the comment says **Ready**, which is after the smoke tests have passed against the preview. Only the run for the PR's latest commit deploys, and only while the PR is open, so an older run that finishes its builds late doesn't overwrite a newer deployment. `.github/workflows/preview-cleanup.yml` deletes the environment when the PR is closed or merged, then sweeps the resource group for previews of other closed PRs whose own deletion failed. It runs only on PR events, because the preview identity only trusts pull request tokens.

Previews live in the `FlashCardSage-Preview` resource group and are kept cheap by sharing the fixed-cost resources. The shared ones are defined by `infra/preview-shared.bicep`, which each deployment applies from the PR's base branch, so a PR can't change them for every other preview (a change to them reaches previews once it's merged). Each PR's own resources are defined by `infra/preview.bicep`.

| Resource | Shared or per PR | Notes |
|----------|------------------|-------|
| App Service plan `FlashCardSage-Preview-Plan` | Shared | Free (F1) Linux plan: 60 CPU minutes a day, 1 GB and at most 10 web apps, shared by every preview. When the minutes run out, every preview stops until the next day. `appServicePlanSku` in `preview-shared.bicepparam` can raise it to B1 |
| SQL server `flashcardsage-preview-sql` | Shared | Entra-only auth; the `flashcardsage-preview-deploy` identity is its Entra admin (set by `preview-shared.bicep`) |
| Translator `flashcardsage-preview-translator` | Shared | Azure AI Translator on the S1 tier (about $10 per million characters, nothing when unused), since production has the subscription's one free (F0) Translator. Each preview deployment finds it in the resource group, and a preview runs without translation while it doesn't exist |
| Azure AI Foundry `flashcardsage-preview-foundry` | Shared | Makes cards' pictures with its `flux-2-pro` deployment (a few cents a picture, nothing when unused), and suggests new cards with its `gpt-5-mini` deployment (a fraction of a cent a time). Its deployments share the subscription's per-minute quotas for the model with production's, so each is kept small. Each preview deployment finds it in the resource group, and a preview runs without pictures while it doesn't exist |
| Web app `flashcardsage-pr-<N>` | Per PR | Same settings as production minus Application Insights (telemetry is off). The API URL has a random suffix, so take it from the PR comment |
| Database `FlashCardSage-pr-<N>` | Per PR | Serverless, auto-pauses after an hour, is reset to sample flash cards on every deployment (see below), and uses the [SQL free offer](https://learn.microsoft.com/azure/azure-sql/database/free-offer) like production. The offer covers 10 databases per subscription including production's; if a deployment fails because they're used up, close stale PRs or set `useFreeLimit = false` in `preview.bicepparam` (about $0.25 an hour while active, nothing while paused) |
| Storage account `flashcardsagepr<N><suffix>` | Per PR | Static website and the `card-images` container, deployed exactly like production. Storage account names are unique across Azure, so the name ends with 5 characters derived from the resource group |

The first request after a while can take a minute while the app and database start. Each deployment runs the PR's migrations against its database, then creates the web app's database user from its managed identity's client ID (`.github/scripts/preview-db-user.sql`), so no database users are set up by hand. A deployment still running for the PR finishes before a newer push deploys (closing the PR cancels it). The database is recreated empty when a migration script it already ran has been edited, or its last migration run didn't finish (`.github/scripts/preview-migrations.sh`); otherwise it's kept, and scripts added since run against it. Previews have no Google sign-in (Google won't accept their origins), so they use test sign-in instead. Every deployment then deletes the decks and flash cards of the test user **Preview User** (the name the sign-in page suggests), turns their preferences back on, and adds the sample flash cards and decks in `.github/scripts/preview-seed-data.json`, through the API; edit that file to change them. A card with a `"picture"` gets that file from `.github/scripts/preview-pictures`, and so do the built-in cards listed in `systemCardPictures` (through `seed-preview-system-pictures.sh`, since no API can give a built-in card a picture). The pictures were made once by the image generator and committed, so deployments never call it. So each push starts the preview over from the sample data, and anything reviewers changed as Preview User is lost; cards made under other names are kept. The `migrations` tag is carried through each Bicep deployment, which would otherwise replace it. If a preview is still broken, close and reopen the PR.

To preview the templates by hand (needs rights on the `FlashCardSage-Preview` resource group):

```powershell
az deployment group what-if --resource-group FlashCardSage-Preview --template-file infra/preview-shared.bicep --parameters infra/preview-shared.bicepparam

$env:PREVIEW_PR_NUMBER = '1'  # any PR number; what-if doesn't change anything
az deployment group what-if --resource-group FlashCardSage-Preview --template-file infra/preview.bicep --parameters infra/preview.bicepparam
```

Setting up previews for a new environment: create the `FlashCardSage-Preview` resource group, the `flashcardsage-preview-deploy` identity and its grants (see [Identities & Permissions](#identities--permissions)), put the identity's object ID in `preview-shared.bicepparam` (`sqlEntraAdminObjectId`) and its client ID in the `AZURE_PREVIEW_CLIENT_ID` repository variable. The first deployment creates the plan and SQL server.

### Deployment Architecture

| Component | Azure Service | Endpoint |
|-----------|--------------|----------|
| Backend API | Azure App Service (Linux/.NET 10) | `https://flashcardsage-<suffix>.westus2-01.azurewebsites.net` (Azure picks the suffix; it's the `AZURE_BACKEND_URL` variable) |
| Frontend | Azure Storage Account (static website) | `https://flashcardsage.com` (the [custom domain](#custom-domain)); the web endpoint `https://flashcardsage.z22.web.core.windows.net` also works |
| Database | Azure SQL serverless database (Entra-only auth) | — |
| Translation | Azure AI Translator `flashcardsage-translator` (free F0 tier: 2 million characters a month) | Called by the API with the key from its app settings |
| Card suggestions | The same Azure AI Foundry resource, with a Global Standard deployment of `gpt-5-mini` (OpenAI), billed per token (a fraction of a cent per page visit) | Called by the API with the resource's key from its app settings, through its Azure OpenAI v1 chat completions API (`https://flashcardsage-foundry.openai.azure.com/openai/v1/chat/completions`) |
| Pictures | Azure AI Foundry `flashcardsage-foundry` in `westus3` with a Global Standard deployment of `FLUX.2-pro` (Black Forest Labs), billed per megapixel (a few cents a picture). The OpenAI image models (`gpt-image-1-mini` and the like) have no quota on this free-tier subscription, which is why it's FLUX. The pictures themselves are in the `card-images` container of the storage account, readable by anyone with a picture's random URL | Called by the API with the key from its app settings, through the resource's Black Forest Labs API (`/providers/blackforestlabs/v1/flux-2-pro`); browsers load the pictures from `https://flashcardsage.blob.core.windows.net/card-images/` |

The image model's deployment takes a slice of the subscription's per-minute quota for the model (`az cognitiveservices usage list -l westus3 --query "[?name.value=='AIServices.GlobalStandard.FLUX.2-pro'].limit"`), shared with the previews' deployment. Setting `deployFoundry` to `false` in `main.bicepparam` (and `preview-shared.bicepparam`) deploys no Foundry resource; the API then answers picture requests with a 503 and the form says pictures aren't available.
| Monitoring | Log Analytics + Application Insights (App Service HTTP/console/app/platform logs and SQL errors, timeouts, blocks, deadlocks and automatic tuning go to the `FlashCardSage` workspace), plus the **FlashCardSage Health** workbook | — |

### Custom Domain

The frontend is served on `flashcardsage.com`, set as `frontendCustomDomain` in `infra/main.bicepparam` (empty serves the storage account's web endpoint instead). The storage account's static website can't serve a custom domain over HTTPS by itself, so Cloudflare proxies the domain to it and serves it over HTTPS. Bicep registers the domain on the storage account, so the static website answers requests for it, and allows it in the API's CORS origins next to the web endpoint, which keeps working. The API stays on its `azurewebsites.net` URL, because the Free (F1) App Service plan doesn't support custom domains.

Before the first deployment with the domain (Azure checks it then, and the deployment fails if it can't), set up the zone in Cloudflare:

| Type | Name | Target | Proxy status |
|------|------|--------|--------------|
| CNAME | `asverify` | `asverify.flashcardsage.blob.core.windows.net` | DNS only |
| CNAME | `@` | `flashcardsage.z22.web.core.windows.net` | Proxied |
| CNAME | `www` | `flashcardsage.com` | Proxied |

- Keep the `asverify` record, since every deployment sends the domain again. Azure verifies the domain through it (`useSubDomainName` in `infra/modules/storage.bicep`), which is also what lets the bare domain work: Azure's docs say only subdomains are supported, but that restriction is about the domain itself needing a CNAME, which Cloudflare's proxy takes care of.
- Under **Rules → Configuration Rules**, a rule for the hostname sets **SSL** to **Full**. The storage account's certificate is for `*.web.core.windows.net`, so **Full (strict)** fails, and **Flexible** connects over HTTP, which the storage account refuses.
- Under **Rules → Redirect Rules**, a rule sends `www.flashcardsage.com` to `https://flashcardsage.com` with the path, so the `www` record never reaches Azure (the storage account only knows the bare domain). A **Cache Rule** for the hostname respects the origin's cache headers, so `index.html` (`no-cache`) is always fresh while the hashed assets are cached.
- **SSL/TLS → Edge Certificates → Always Use HTTPS** is on, since Google sign-in needs HTTPS.
- In the Google Cloud console, add `https://flashcardsage.com` to the OAuth client's **Authorized JavaScript origins**, or Google sign-in won't load there.

For another app, the same records work for a subdomain (`asverify.<sub>` and `<sub>`) with `frontendCustomDomain` set to the full name.

### Database Backups

Before running migrations, the `deploy-backend` job exports the database to a BACPAC and uploads it to the private `db-backups` container in the `flashcardsage` storage account. It does this on every deploy, including the daily scheduled run. Files are named `FlashCardSage-<UTC timestamp>-<commit>.bacpac`. A lifecycle management rule deletes backups older than `backupRetentionDays` (30 days, set in `infra/main.bicepparam`). If the backup fails, the migrations don't run.

To restore, import a backup into a **new** database, check it, then point the app at it or swap the names:

```powershell
az storage blob list --auth-mode login --account-name flashcardsage --container-name db-backups --output table
az storage blob download --auth-mode login --account-name flashcardsage --container-name db-backups --name <file>.bacpac --file backup.bacpac
sqlpackage /Action:Import /SourceFile:backup.bacpac /TargetServerName:flashcardsage-sql.database.windows.net /TargetDatabaseName:FlashCardSage-Restored /UniversalAuthentication:True
```

The Azure SQL built-in point-in-time restore (7 days) is still available for restoring to a moment between backups.

### Required GitHub Variables

| Variable | Description |
|----------|-------------|
| `AZURE_CLIENT_ID` | Client ID of the `flashcardsage-deploy` managed identity (for OIDC login) |
| `AZURE_TENANT_ID` | Azure Active Directory tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_RESOURCE_GROUP` | Azure resource group containing all resources |
| `AZURE_BACKEND_APP_NAME` | Name of the Azure App Service for the backend |
| `AZURE_BACKEND_URL` | Public URL of the backend API (e.g. `https://flashcardsage-<suffix>.westus2-01.azurewebsites.net`) |
| `AZURE_STORAGE_ACCOUNT_NAME` | Name of the Azure Storage Account used to host the frontend static website |
| `GOOGLE_CLIENT_ID` | Client ID of the Google OAuth web client used for sign-in. The infrastructure deployment gives it to the API, and the frontend build embeds it (it isn't secret) |

All other resource names, regions and SKUs live in `infra/main.bicepparam`.

The `infrastructure-what-if` and `deploy-preview` PR jobs (and `preview-cleanup.yml`) don't use the `production` environment, so they only see **repository-level** variables. Define these at repository level (the environment can keep its own copies):

| Variable | Description |
|----------|-------------|
| `AZURE_WHATIF_CLIENT_ID` | Client ID of the read-only managed identity used for PR what-if previews |
| `AZURE_PREVIEW_CLIENT_ID` | Client ID of the `flashcardsage-preview-deploy` managed identity that deploys and deletes PR preview environments |
| `AZURE_TENANT_ID` | Azure Active Directory tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_RESOURCE_GROUP` | Azure resource group containing all resources |

The what-if identity is a user-assigned managed identity with a federated credential for this repository's `pull_request` tokens and a custom role on the resource group limited to `*/read`, `Microsoft.Resources/deployments/validate/action`, `Microsoft.Resources/deployments/whatIf/action` and `Microsoft.Resources/deployments/write` (needed for nested module deployments; it can't write any resource).

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `AZURE_SQL_CONNECTION_STRING` | SQL Server connection string used at runtime and for migrations (applied to the App Service by the Bicep deployment) |
| `FLASHCARDSAGE_SERVICE_TOKEN` | Secret token (at least 32 characters) that signs in as the service user. The infrastructure deployment gives it to the API, and the production smoke tests and the Generate Load workflow send it. Store it in the `production` environment |
| `SLACK_WEBHOOK_URL` | Optional. Slack incoming webhook URL that alerts post to. Without it, alerts only go to email and the Azure mobile app |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code OAuth token (from `claude setup-token`) used by the CI failure and alert investigation workflows |
| `ALERT_INVESTIGATION_TOKEN` | Optional. Fine-grained personal access token for this repository only, with **Actions: Read and write**. The infrastructure deployment gives it to the Slack Logic App, which uses it to start the alert investigation workflow. Without it (or `SLACK_WEBHOOK_URL`), alerts aren't investigated |
| `AUTOMERGE_TOKEN` | Personal access token with write access to contents and pull requests. The Dependabot workflows use it to comment, the Auto-update PRs workflow uses it to merge main into PRs with auto-merge enabled (so CI runs on them), and the CI failure investigation workflow uses it to push fix branches and open PRs (so CI runs on them). Save it as both an Actions secret and a Dependabot secret |
| `TS_COMPAT_PR_TOKEN` | Fine-grained personal access token for this repository with Contents, Pull requests and Workflows read/write, used by the nightly TypeScript/ESLint compatibility and Pkcs pin check workflows to open PRs that delete a workflow file |

### CI Failure Investigation

When CI fails on a pull request, `.github/workflows/ci-failure-investigation.yml` runs Claude Code to investigate. If a code change fixes the failure, Claude opens a separate PR from a `claude/ci-fix/` branch, based on the failing PR's branch, and never pushes to the failing branch itself. Either way, it comments on the failing PR with the root cause and what it did. It skips fork PRs, Dependabot PRs and its own `claude/ci-fix/` PRs. CI runs on pull requests into any branch, so the stacked fix PRs are checked too.

### Alert Investigation

When an alert fires (not when it resolves) or a budget alert is sent, the **FlashCardSage-SlackAlerts** Logic App posts the alert to Slack, adds a note that Claude is investigating, and starts `.github/workflows/alert-investigation.yml` with the alert payload. Claude Code reads the alert rule in `infra/modules/alerts.bicep`, queries Application Insights, Log Analytics, metrics, the activity log, resource health and costs, and checks recent deployments and Generate Load runs. It then posts a follow-up in the same channel with its verdict: for a real problem, the steps to fix it; for a false positive, the change to the rule (threshold, window, filter or query) that would stop it firing falsely. If Claude can't finish, or the Logic App can't start the workflow (for example because the token expired), Slack gets a message saying so.

Claude only has read access: the `flashcardsage-alert-investigator` identity can't change Azure resources, and its GitHub token can only read the repository. It never sees the Slack webhook either: it uploads its findings as an artifact, and a separate job on a fresh runner posts them. The Logic App hides its HTTP actions' inputs (the webhook URL and GitHub token) from its run history.

To set it up:

1. Create the `flashcardsage-alert-investigator` identity and its roles (see [Identities & Permissions](#identities--permissions)); `infra/Setup-Environment.ps1` does this.
2. Create a GitHub environment named `alert-investigation`, restrict its deployment branches to `main`, and add the `AZURE_ALERT_INVESTIGATOR_CLIENT_ID` variable to it (the script does this too). The workflow also uses the repository-level `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and `AZURE_RESOURCE_GROUP` variables.
3. Save a fine-grained personal access token as the `ALERT_INVESTIGATION_TOKEN` secret (see [Required GitHub Secrets](#required-github-secrets)), and renew it before it expires. The next deployment adds it to the Logic App.

To try it, choose **Test** on the **FlashCardSage-Alerts** action group, or run **Alert Investigation** from the Actions tab and paste an alert payload, such as the trigger body of a Logic App run.

### Environment

The workflow uses the `production` GitHub Environment for all deployments. Configure the `production` environment in your repository settings to enable approval gates and environment-specific secrets, and restrict its deployment branches to `main` so pull requests can't use its credentials or secrets.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to get started.

Use the provided templates when opening issues or pull requests:

- [Bug Report](https://github.com/dylan-smith/FlashCardSage/issues/new?template=bug_report.md)
- [Feature Request](https://github.com/dylan-smith/FlashCardSage/issues/new?template=feature_request.md)
- [Enhancement](https://github.com/dylan-smith/FlashCardSage/issues/new?template=enhancement.md)

Pull requests should follow the [PR template](./.github/PULL_REQUEST_TEMPLATE.md) checklist before requesting review.

## Security

To report a security vulnerability, see [SECURITY.md](SECURITY.md).

## License

This project is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE) for details.
