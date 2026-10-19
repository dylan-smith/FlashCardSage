@description('Azure region for resources.')
param location string

@description('Name of the Azure Storage Account (must be globally unique, lowercase, 3-24 characters).')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Days to keep database backups in the db-backups container before they are deleted automatically.')
@minValue(1)
param backupRetentionDays int = 30

@description('Custom domain (e.g. app.example.com) the static website is also served on. Leave empty for none.')
param customDomainName string = ''

// The static website itself ($web container, index/404 documents) is a data-plane setting that ARM
// can't manage; CI enables it with `az storage blob service-properties update --static-website`.
resource storageAccount 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: storageAccountName
  location: location
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
    // Registers the domain so the static website answers requests for it. Azure checks it through the
    // asverify.<domain> CNAME, so the domain itself can point at the web endpoint through a proxy (Cloudflare),
    // which also serves it over HTTPS.
    customDomain: empty(customDomainName)
      ? null
      : {
          name: customDomainName
          useSubDomainName: true
        }
  }
}

// The origins the frontend is served on, without the trailing slash the browser leaves off: the custom domain
// first when there is one, and the web endpoint either way.
var webEndpointOrigin = replace(storageAccount.properties.primaryEndpoints.web, '.net/', '.net')
var frontendOrigins = empty(customDomainName)
  ? [webEndpointOrigin]
  : ['https://${customDomainName}', webEndpointOrigin]

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    // The page fetches the pictures on cards itself to keep them for offline practice, which needs CORS here.
    cors: {
      corsRules: [
        {
          allowedOrigins: frontendOrigins
          allowedMethods: ['GET', 'HEAD', 'OPTIONS']
          allowedHeaders: ['*']
          exposedHeaders: ['*']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

// Private container for the BACPAC exports CI takes before running database migrations.
resource backupContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: 'db-backups'
  properties: {
    publicAccess: 'None'
  }
}

// The pictures on cards, which browsers load straight from here. Anyone with a picture's URL can see it, but the
// names are random, so a picture is only found through its card.
resource cardImagesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: 'card-images'
  properties: {
    publicAccess: 'Blob'
  }
}

// Deletes old backups so the container doesn't grow indefinitely.
resource lifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2025-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'delete-old-db-backups'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['${backupContainer.name}/']
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterCreationGreaterThan: backupRetentionDays
                }
              }
            }
          }
        }
      ]
    }
  }
}

@description('Primary web endpoint for the static website.')
output primaryWebEndpoint string = storageAccount.properties.primaryEndpoints.web

@description('Origin the frontend is served on: the custom domain when there is one, otherwise the web endpoint.')
output frontendOrigin string = frontendOrigins[0]

@description('Resource ID of the Storage Account.')
output storageAccountId string = storageAccount.id

@description('Name of the container that holds the pictures on cards.')
output cardImagesContainerName string = cardImagesContainer.name
