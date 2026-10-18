using './preview-shared.bicep'

// Values for the resources shared by every preview environment in the FlashCardSage-Preview resource group. CI
// deploys these from the PR's base branch, so a change here reaches previews once it's merged.
param location = 'westus2'

param appServicePlanName = 'FlashCardSage-Preview-Plan'
// B1, since every preview's files share the plan's storage, and F1's 1 GB only holds about 7 of them.
param appServicePlanSku = 'B1'
param sqlServerName = 'flashcardsage-preview-sql'

// The flashcardsage-preview-deploy managed identity (see README, Identities & Permissions). Replace the object ID
// with the identity's once it's created; the first preview deployment fails until then.
param sqlEntraAdminLogin = 'flashcardsage-preview-deploy'
param sqlEntraAdminObjectId = '62ce86fe-94aa-4f21-981e-a5a4184602d1'

param translatorName = 'flashcardsage-preview-translator'

// Azure AI Foundry with the image model (FLUX.2-pro) and the chat model (gpt-5-mini), in a region the image model
// is offered in (see main.bicepparam)
param deployFoundry = true
param foundryName = 'flashcardsage-preview-foundry'
param foundryLocation = 'westus3'
