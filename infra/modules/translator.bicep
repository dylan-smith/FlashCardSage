@description('Name of the Azure AI Translator resource.')
param name string

@description('Pricing tier: F0 is free for 2M characters a month (one per subscription), S1 is paid per character.')
@allowed(['F0', 'S1'])
param sku string

// Global, so the API's requests don't need a region header. The API signs in with the resource's key, which the
// App Service settings read straight from the resource, so there's no secret to store anywhere else.
resource translator 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: 'global'
  kind: 'TextTranslation'
  sku: {
    name: sku
  }
  properties: {
    publicNetworkAccess: 'Enabled'
  }
}

@description('Name of the Translator resource.')
output name string = translator.name
