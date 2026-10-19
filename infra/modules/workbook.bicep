@description('Azure region for the workbook.')
param location string

@description('Resource ID of the Application Insights component.')
param appInsightsId string

@description('Resource ID of the Log Analytics Workspace.')
param workspaceId string

@description('Resource ID of the App Service (backend API).')
param appServiceId string

@description('Resource ID of the App Service Plan.')
param appServicePlanId string

@description('Resource ID of the SQL Database.')
param sqlDatabaseId string

@description('Resource ID of the frontend Storage Account.')
param storageAccountId string

@description('Resource ID of the action group the alert rules notify.')
param actionGroupId string

@description('Resource ID of the Azure AI Foundry resource, which needn\'t exist: its charts are empty without it.')
param foundryId string

@description('Resource ID of the Azure AI Translator resource.')
param translatorId string

@description('Default HTTPS URL of the backend App Service, without a trailing slash.')
param apiUrl string

@description('Primary web endpoint for the frontend static website.')
param frontendUrl string

// The workbook JSON is exported from the portal's Advanced editor with each resource ID and site URL
// swapped for a placeholder token, so it can be edited in the portal and pasted back into the repo.
// It's loaded as JSON and serialized again so the indentation goes: with the resource IDs filled in, the
// pretty-printed text passes the 131,072-character limit ARM puts on an expression's result.
var serializedData = reduce(
  items({
    __APP_INSIGHTS_ID__: appInsightsId
    __WORKSPACE_ID__: workspaceId
    __APP_SERVICE_ID__: appServiceId
    __APP_SERVICE_PLAN_ID__: appServicePlanId
    __SQL_DATABASE_ID__: sqlDatabaseId
    __STORAGE_ACCOUNT_ID__: storageAccountId
    __RESOURCE_GROUP_ID__: resourceGroup().id
    __SUBSCRIPTION_ID__: subscription().id
    __ACTION_GROUP_ID__: actionGroupId
    __API_URL__: apiUrl
    __FRONTEND_URL__: frontendUrl
  }),
  string(loadJsonContent('../workbooks/health.workbook.json')),
  (json, token) => replace(json, token.key, token.value)
)

resource workbook 'Microsoft.Insights/workbooks@2023-06-01' = {
  // Workbook names must be GUIDs; a deterministic one keeps redeploys updating the same workbook.
  name: guid(resourceGroup().id, 'flashcardsage-health-workbook')
  location: location
  kind: 'shared'
  properties: {
    displayName: 'FlashCardSage Health'
    category: 'workbook'
    // Lowercase so the portal lists it under Application Insights → Workbooks.
    sourceId: toLower(appInsightsId)
    serializedData: serializedData
  }
}

// How many people use the app and what they do with it. It only reads Application Insights, so that's the one ID it needs.
resource usageWorkbook 'Microsoft.Insights/workbooks@2023-06-01' = {
  name: guid(resourceGroup().id, 'flashcardsage-usage-workbook')
  location: location
  kind: 'shared'
  properties: {
    displayName: 'FlashCardSage Usage'
    category: 'workbook'
    sourceId: toLower(appInsightsId)
    serializedData: replace(string(loadJsonContent('../workbooks/usage.workbook.json')), '__APP_INSIGHTS_ID__', appInsightsId)
  }
}

// What the AI models are used for and what they cost, from Application Insights, the AI resources' metrics and Cost
// Management.
resource aiWorkbook 'Microsoft.Insights/workbooks@2023-06-01' = {
  name: guid(resourceGroup().id, 'flashcardsage-ai-workbook')
  location: location
  kind: 'shared'
  properties: {
    displayName: 'FlashCardSage AI'
    category: 'workbook'
    sourceId: toLower(appInsightsId)
    serializedData: reduce(
      items({
        __APP_INSIGHTS_ID__: appInsightsId
        __FOUNDRY_ID__: foundryId
        __TRANSLATOR_ID__: translatorId
        __RESOURCE_GROUP_ID__: resourceGroup().id
      }),
      string(loadJsonContent('../workbooks/ai.workbook.json')),
      (json, token) => replace(json, token.key, token.value)
    )
  }
}

@description('Resource ID of the health workbook.')
output workbookId string = workbook.id
