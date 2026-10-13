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

// Azure OpenAI, which makes a picture of what a card means with gpt-image-1-mini. The model is only offered in some
// regions (eastus2, westus3, polandcentral, swedencentral and uaenorth as of October 2026), not westus2, so the
// resource is in the nearest of them. The subscription's quota for the model is shared with the previews' resource.
//
// Off until the subscription has quota for the model: the gpt-image series needs access approval
// (https://aka.ms/oai/gptimage1access), and in October 2026 `az cognitiveservices usage list -l westus3` showed a
// limit of 0 for OpenAI.GlobalStandard.gpt-image-1-mini. Deploying it then would fail, and with it every deployment.
// Until it's on, the API answers picture requests with a 503 and the form says pictures aren't available.
param deployOpenAi = false
param openAiName = 'flashcardsage-openai'
param openAiLocation = 'westus3'
param openAiCapacity = 2

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
