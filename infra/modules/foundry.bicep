@description('Name of the Azure AI Foundry resource. It\'s also the resource\'s subdomain (name.services.ai.azure.com), so it\'s unique across Azure.')
param name string

@description('Azure region for the resource. The image model is only offered in some regions (see main.bicepparam).')
param location string

@description('Name of the image model\'s deployment, which the API calls by name. It\'s also the model\'s path in the Black Forest Labs API, so it\'s the model\'s name in lowercase.')
param deploymentName string = 'flux-2-pro'

@description('How many pictures a minute the deployment can make. The subscription has a quota for the model that every deployment of it shares, so keep this small.')
@minValue(1)
param capacity int = 2

@description('Name of the chat model\'s deployment, which the API suggests new cards with.')
param suggestionDeploymentName string = 'gpt-5-mini'

@description('Thousands of tokens a minute the chat model\'s deployment can use, out of the subscription\'s quota for the model. A request for suggestions is a few thousand.')
@minValue(1)
param suggestionCapacity int = 50

// The API makes a card's picture with the image model. It signs in with the resource's key, which the App Service
// settings read straight from the resource, so there's no secret to store anywhere else.
resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: name
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  properties: {
    // Gives the resource an endpoint of its own, which the API calls.
    customSubDomainName: name
    publicNetworkAccess: 'Enabled'
  }
}

// FLUX.2-pro (Black Forest Labs) makes a clear picture for a few cents, and the subscription has quota for it where
// it has none for the OpenAI image models. Global Standard is the kind of deployment that's offered everywhere.
resource imageModel 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: foundry
  name: deploymentName
  sku: {
    name: 'GlobalStandard'
    capacity: capacity
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

// gpt-5-mini suggests new cards from the user's cards: it's quick and cheap, writes good Spanish, and the
// subscription has quota for it. A resource changes one deployment at a time, so it waits for the image model's.
resource suggestionModel 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: foundry
  name: suggestionDeploymentName
  sku: {
    name: 'GlobalStandard'
    capacity: suggestionCapacity
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

@description('Name of the Azure AI Foundry resource.')
output name string = foundry.name

@description('Name of the image model\'s deployment.')
output deploymentName string = imageModel.name

@description('Name of the chat model\'s deployment.')
output suggestionDeploymentName string = suggestionModel.name
