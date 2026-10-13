@description('Name of the Azure OpenAI resource. It\'s also the resource\'s subdomain (name.openai.azure.com), so it\'s unique across Azure.')
param name string

@description('Azure region for the resource. The image model is only offered in some regions (see main.bicepparam).')
param location string

@description('Name of the image model\'s deployment, which the API calls by name.')
param deploymentName string = 'gpt-image-1-mini'

@description('How many pictures a minute the deployment can make. The subscription has a quota for the model that every deployment of it shares, so keep this small.')
@minValue(1)
param capacity int = 2

// The API makes a card's picture with the image model. It signs in with the resource's key, which the App Service
// settings read straight from the resource, so there's no secret to store anywhere else.
resource openAi 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: name
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    // Gives the resource an endpoint of its own, which the API calls.
    customSubDomainName: name
    publicNetworkAccess: 'Enabled'
  }
}

// gpt-image-1-mini is the cheapest image model, and a card's picture only needs to be clear. Global Standard is the
// only kind of deployment it's offered as.
resource imageModel 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: openAi
  name: deploymentName
  sku: {
    name: 'GlobalStandard'
    capacity: capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-image-1-mini'
      version: '2025-10-06'
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

@description('Name of the Azure OpenAI resource.')
output name string = openAi.name

@description('Name of the image model\'s deployment.')
output deploymentName string = imageModel.name
