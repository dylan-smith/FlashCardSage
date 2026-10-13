// A pull request's preview environment: a web app, a serverless database and a static-website storage account
// of its own, on the App Service plan and SQL server every preview shares (preview-shared.bicep, which CI deploys
// first). The deploy-preview CI job deploys this template on each push to a PR, and preview-cleanup.yml deletes
// the PR's resources when it closes.
//
// The resources mirror the production modules (modules/appservice.bicep, modules/sql.bicep and
// modules/storage.bicep) without their monitoring, alerts or backups, so keep their settings in sync when
// changing a module. Nothing here touches production.
targetScope = 'resourceGroup'

@description('Number of the pull request this preview is for. Names every per-PR resource.')
@minValue(1)
// Keeps the storage account name (flashcardsagepr + this + a 5-character suffix) within its 24-character limit.
@maxValue(9999)
param prNumber int

@description('Azure region for resources.')
param location string = resourceGroup().location

@description('Name of the App Service Plan shared by every preview.')
param appServicePlanName string

@description('Name of the Azure SQL Server shared by every preview.')
param sqlServerName string

@description('Name of the Translator resource every preview shares (preview-shared.bicep), which CI looks up in the resource group. Empty turns translation off, while there isn\'t one.')
param translatorName string = ''

@description('Name of the Azure OpenAI resource every preview shares (preview-shared.bicep), which CI looks up in the resource group. Empty turns pictures off, while there isn\'t one.')
param openAiName string = ''

@description('Name of the image model\'s deployment on the shared Azure OpenAI resource.')
param imageDeploymentName string = 'gpt-image-1-mini'

@description('Use the Azure SQL free offer for the database. The offer covers a limited number of databases per subscription, and can\'t be turned on for an existing database.')
param useFreeLimit bool = true

@description('The database\'s current tags. A deployment replaces a resource\'s tags with the ones it declares, so CI passes these in to keep the one its scripts set (migrations) through the deployment.')
param existingDatabaseTags object = {}

var appServiceName = 'flashcardsage-pr-${prNumber}'
var sqlDatabaseName = 'FlashCardSage-pr-${prNumber}'
// Storage account names are lowercase letters and digits only, and unique across all of Azure, so a suffix from
// the resource group's ID keeps another tenant's account from blocking a PR. CI reads the name from the
// storageAccountName output, and cleanup finds the account by its pr-number tag.
var storageAccountName = 'flashcardsagepr${prNumber}${take(uniqueString(resourceGroup().id), 5)}'

// Lets the cleanup workflow find a PR's resources.
var prTags = {
  'pr-number': string(prNumber)
}

// ---- Shared by every preview (preview-shared.bicep) ----

resource appServicePlan 'Microsoft.Web/serverfarms@2024-11-01' existing = {
  name: appServicePlanName
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01' existing = {
  name: sqlServerName
}

resource translator 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = if (!empty(translatorName)) {
  name: translatorName
}

resource openAi 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = if (!empty(openAiName)) {
  name: openAiName
}

// Free and Shared plans don't support Always On.
var isFreeOrShared = startsWith(appServicePlan.sku.name, 'F') || startsWith(appServicePlan.sku.name, 'D')

// ---- This pull request's resources ----

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  tags: union(existingDatabaseTags, prTags)
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 2
  }
  // freeLimitExhaustionBehavior is only valid with the free offer, so it's omitted (not sent as null) otherwise.
  properties: union(
    {
      collation: 'SQL_Latin1_General_CP1_CI_AS'
      maxSizeBytes: 34359738368
      minCapacity: json('0.5')
      autoPauseDelay: 60
      zoneRedundant: false
      requestedBackupStorageRedundancy: 'Local'
      useFreeLimit: useFreeLimit
    },
    useFreeLimit ? { freeLimitExhaustionBehavior: 'AutoPause' } : {}
  )
}

// The static website itself ($web container, index/404 documents) is a data-plane setting that ARM
// can't manage; CI enables it with `az storage blob service-properties update --static-website`.
resource storageAccount 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: storageAccountName
  location: location
  tags: prTags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: true
    allowSharedKeyAccess: true
    allowCrossTenantReplication: false
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: storageAccount
  name: 'default'
}

// The pictures on the preview's cards, which browsers load straight from here (see modules/storage.bicep).
resource cardImagesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: 'card-images'
  properties: {
    publicAccess: 'Blob'
  }
}

resource appService 'Microsoft.Web/sites@2024-11-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  tags: prTags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    autoGeneratedDomainNameLabelScope: 'TenantReuse'
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      alwaysOn: !isFreeOrShared
      minTlsVersion: '1.2'
      ftpsState: 'FtpsOnly'
    }
  }
}

// This replaces the app's entire settings collection, so every setting the app needs must be declared here.
// There's no Application Insights for previews; the API logs that telemetry is off and carries on.
resource appSettings 'Microsoft.Web/sites/config@2024-11-01' = {
  parent: appService
  name: 'appsettings'
  properties: union(
    {
      // The web app connects as its own managed identity; CI creates the database user for it.
      ConnectionStrings__FlashCardSage: 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Initial Catalog=${sqlDatabase.name};Authentication=Active Directory Managed Identity;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;'
      // The browser sends the origin without a trailing slash.
      Cors__AllowedOrigins__0: replace(storageAccount.properties.primaryEndpoints.web, '.net/', '.net')
      // Google only accepts the origins registered with it, and every preview has its own, so previews use test
      // sign-in instead: anyone can sign in as any name. Never set this in main.bicep.
      Authentication__AllowTestSignIn: 'true'
      // The API writes pictures with the account's key (see modules/appservice.bicep).
      ImageStore__StorageConnectionString: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
      ImageStore__ContainerName: cardImagesContainer.name
      WEBSITE_ENABLE_SYNC_UPDATE_SITE: 'true'
    },
    // Without a key the API answers translations with a 503 and the user types both sides.
    empty(translatorName) ? {} : { Translator__Key: translator!.listKeys().key1 },
    // Without an endpoint and key the API answers picture requests with a 503, and cards go without pictures.
    empty(openAiName)
      ? {}
      : {
          ImageGeneration__Endpoint: openAi!.properties.endpoint
          ImageGeneration__Key: openAi!.listKeys().key1
          ImageGeneration__Deployment: imageDeploymentName
        }
  )
}

@description('Resource ID of the App Service.')
output appServiceId string = appService.id

@description('Default HTTPS URL of the App Service.')
output appServiceUrl string = 'https://${appService.properties.defaultHostName}'

@description('Principal ID of the App Service system-assigned managed identity.')
output appServicePrincipalId string = appService.identity.principalId

@description('Fully qualified domain name of the SQL Server.')
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName

@description('Name of the SQL Database.')
output sqlDatabaseName string = sqlDatabase.name

@description('Name of the Storage Account.')
output storageAccountName string = storageAccount.name

@description('Primary web endpoint for the static website.')
output frontendWebEndpoint string = storageAccount.properties.primaryEndpoints.web
