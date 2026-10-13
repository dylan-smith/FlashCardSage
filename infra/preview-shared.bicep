// The resources every pull request's preview environment shares: an App Service plan, a SQL server, a Translator
// and an Azure AI Foundry resource. The deploy-preview CI job deploys this template from the PR's base branch (not
// the PR) before deploying the PR's own resources (preview.bicep), so every preview shares one configuration and a
// PR can't change it for the others, or revert a newer one from its older checkout. A change here reaches previews
// once it's merged.
//
// The resources mirror the production modules (modules/appservice.bicep, modules/sql.bicep, modules/translator.bicep
// and modules/foundry.bicep) without their monitoring, so keep their settings in sync when changing a module.
// Nothing here touches production.
targetScope = 'resourceGroup'

@description('Azure region for resources.')
param location string = resourceGroup().location

@description('Name of the App Service Plan shared by every preview.')
param appServicePlanName string

@description('SKU of the shared App Service Plan.')
param appServicePlanSku string

@description('Name of the Azure SQL Server shared by every preview.')
param sqlServerName string

@description('Entra ID admin login of the shared SQL Server: the preview deployment identity, which runs the migrations and creates each web app\'s database user.')
param sqlEntraAdminLogin string

@description('Object ID of the preview deployment identity.')
param sqlEntraAdminObjectId string

@description('Name of the Azure AI Translator resource shared by every preview.')
param translatorName string

@description('Whether to deploy the Azure AI Foundry resource. Without it, previews run without pictures or card suggestions.')
param deployFoundry bool = true

@description('Name of the Azure AI Foundry resource shared by every preview, which is also its subdomain.')
param foundryName string

@description('Azure region for the Azure AI Foundry resource: one the image model (FLUX.2-pro) is offered in.')
param foundryLocation string

resource appServicePlan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: {
    name: appServicePlanSku
  }
  properties: {
    // Marks the plan as Linux; the OS can't be changed on an existing plan.
    reserved: true
  }
}

// Entra-only authentication, with the deployment identity as admin so it can reach every preview database
// without a database user of its own.
resource sqlServer 'Microsoft.Sql/servers@2023-08-01' = {
  name: sqlServerName
  location: location
  properties: {
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: sqlEntraAdminLogin
      sid: sqlEntraAdminObjectId
      tenantId: tenant().tenantId
      principalType: 'Application'
    }
  }
}

// GitHub-hosted runners run in Azure, so this lets the migrations reach the server.
resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01' = {
  parent: sqlServer
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// Previews translate with a Translator of their own, so they never touch production's. Production has the
// subscription's one free (F0) Translator, so this one is paid per character, which previews barely use.
resource translator 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: translatorName
  location: 'global'
  kind: 'TextTranslation'
  sku: {
    name: 'S1'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
  }
}

// Previews make cards' pictures with an Azure AI Foundry resource of their own (as modules/foundry.bicep makes
// production's), so they never touch production's. Its deployment of the image model shares the subscription's
// quota for the model with production's, so it's kept small.
resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' = if (deployFoundry) {
  name: foundryName
  location: foundryLocation
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: foundryName
    publicNetworkAccess: 'Enabled'
  }
}

resource imageModel 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = if (deployFoundry) {
  parent: foundry
  name: 'flux-2-pro'
  sku: {
    name: 'GlobalStandard'
    capacity: 2
  }
  properties: {
    model: {
      format: 'Black Forest Labs'
      name: 'FLUX.2-pro'
      version: '1'
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

// The chat model previews suggest new cards with (as modules/foundry.bicep deploys production's). It shares the
// subscription's quota for the model with production's, so it's kept small.
resource suggestionModel 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = if (deployFoundry) {
  parent: foundry
  name: 'gpt-5-mini'
  sku: {
    name: 'GlobalStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-5-mini'
      version: '2025-08-07'
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
  dependsOn: [
    imageModel
  ]
}
