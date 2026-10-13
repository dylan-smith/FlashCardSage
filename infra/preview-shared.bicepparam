using './preview-shared.bicep'

// Values for the resources shared by every preview environment in the FlashCardSage-Preview resource group. CI
// deploys these from the PR's base branch, so a change here reaches previews once it's merged.
param location = 'westus2'

param appServicePlanName = 'FlashCardSage-Preview-Plan'
param appServicePlanSku = 'F1'
param sqlServerName = 'flashcardsage-preview-sql'

// The flashcardsage-preview-deploy managed identity (see README, Identities & Permissions). Replace the object ID
// with the identity's once it's created; the first preview deployment fails until then.
param sqlEntraAdminLogin = 'flashcardsage-preview-deploy'
param sqlEntraAdminObjectId = '62ce86fe-94aa-4f21-981e-a5a4184602d1'

param translatorName = 'flashcardsage-preview-translator'
