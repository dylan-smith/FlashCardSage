using './main.bicep'

// Production values for the FlashCardSage resource group. Deploying with these values into an empty resource
// group provisions the whole environment; redeploying updates the existing resources in place, so renaming
// anything here creates a new resource instead of renaming the old one.
param location = 'westus2'
param storageLocation = 'westus'
param appInsightsLocation = 'westus'

// App Service (backend API)
param appServiceName = 'FlashCardSage'
param appServicePlanName = 'FlashCardSage-Plan'
param appServicePlanSku = 'F1'

// Storage Account (frontend static website; globally unique, lowercase, 3-24 characters)
param storageAccountName = 'flashcardsage'

// Azure AI Translator, which fills in the other side of a card as the user types (F0 is free; a subscription can
// only have one, so previews use S1)
param translatorName = 'flashcardsage-translator'
param translatorSku = 'F0'

// Claude, which suggests new cards from the user's cards, with the key from the ANTHROPIC_API_KEY secret (never
// commit it). Suggestions are off when it isn't set.
param anthropicApiKey = readEnvironmentVariable('ANTHROPIC_API_KEY', '')

// Azure AI Foundry, which makes a picture of what a card means with FLUX.2-pro (Black Forest Labs). The model isn't
// offered in westus2, so the resource is in the nearest region that has it. The subscription's quota for the model
// (`az cognitiveservices usage list -l westus3`, AIServices.GlobalStandard.FLUX.2-pro: 15 a minute in October
// 2026) is shared with the previews' resource, so each deployment takes a small slice. The OpenAI image models
// (gpt-image-1-mini and the like) have no quota on this free-tier subscription, which is why it's FLUX.
//
// Turning deployFoundry off deploys no resource, and the API answers picture requests with a 503.
param deployFoundry = true
param foundryName = 'flashcardsage-foundry'
param foundryLocation = 'westus3'
param foundryCapacity = 2

// Database backups (BACPAC exports taken by CI before migrations, in the db-backups container)
param backupRetentionDays = 30

// Custom domain for the frontend, e.g. 'flashcardsage.example.com'. Cloudflare proxies it to the static website
// and serves it over HTTPS; see the README's "Custom Domain" section for the DNS records it needs before deploying.
// Empty serves the frontend on the storage account's web endpoint.
param frontendCustomDomain = 'flashcardsage.com'

// SQL Server and Database (Entra-only auth; the server name is globally unique)
param sqlServerName = 'flashcardsage-sql'
param sqlDatabaseName = 'FlashCardSage'
param sqlEntraAdminLogin = 'Dylan@devopsdylan.com'
param sqlEntraAdminObjectId = '148c80fc-4e2d-4fec-9539-aa1a23b344ab'
param sqlEntraAdminPrincipalType = 'User'

// Passed in from the AZURE_SQL_CONNECTION_STRING secret; never commit it.
param sqlConnectionString = readEnvironmentVariable('AZURE_SQL_CONNECTION_STRING')

// Sign-in: the Google OAuth client ID from the GOOGLE_CLIENT_ID variable, and the service token the smoke and load
// tests use from the FLASHCARDSAGE_SERVICE_TOKEN secret; never commit the token.
param googleClientId = readEnvironmentVariable('GOOGLE_CLIENT_ID')
param serviceToken = readEnvironmentVariable('FLASHCARDSAGE_SERVICE_TOKEN')

// Monitoring
param logAnalyticsWorkspaceName = 'FlashCardSage'
param appInsightsName = 'FlashCardSage'

// Alerts (email + Azure mobile app push; Slack when the SLACK_WEBHOOK_URL secret is set)
param alertEmail = 'Dylan@devopsdylan.com'
param slackWebhookUrl = readEnvironmentVariable('SLACK_WEBHOOK_URL', '')
// Claude investigates fired alerts when ALERT_INVESTIGATION_TOKEN is set too (.github/workflows/alert-investigation.yml)
param alertInvestigationToken = readEnvironmentVariable('ALERT_INVESTIGATION_TOKEN', '')
param githubRepository = 'dylan-smith/FlashCardSage'
param monthlyBudget = 10
// The month the budget was first deployed. Azure won't change it on an existing budget, so a new environment should
// use the first of the month it's created in.
param budgetStartDate = '2026-10-01'
