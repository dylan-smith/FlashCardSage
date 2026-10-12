#Requires -Version 7.0
<#
.SYNOPSIS
Sets up everything the Bicep templates and CI don't create for a new environment: the Azure resource groups,
managed identities, federated credentials and role assignments, the GitHub environments, variables, secrets and
branch ruleset, and, after the first deployment, the database users.

.DESCRIPTION
Reads the resource names from infra/main.bicepparam and infra/preview-shared.bicepparam, so a repository
scaffolded like this one needs no arguments beyond the Google OAuth client ID. Every step creates what's missing
and leaves what already exists, so the script can be re-run, and -WhatIf shows what it would do.

Run it in two stages, as the README's "Setting up a new environment" describes:

  1. .\infra\Setup-Environment.ps1 -GoogleClientId <id>
     Before the first push to main. Creates the resource groups, identities, roles and GitHub settings, and
     writes the preview identity into infra/preview-shared.bicepparam, which then needs to be committed.

  2. .\infra\Setup-Environment.ps1 -Stage PostDeploy
     After the first deployment has created the App Service, storage account and database. Creates the database
     users, sets AZURE_BACKEND_URL and re-runs the failed deployment.

Needs the Azure CLI (az login, as the SQL Entra admin from main.bicepparam for the PostDeploy stage) and the
GitHub CLI (gh auth login, with admin access to the repository).

.EXAMPLE
.\infra\Setup-Environment.ps1 -GoogleClientId 1234-abcd.apps.googleusercontent.com -WhatIf

.EXAMPLE
.\infra\Setup-Environment.ps1 -SlackWebhookUrl https://hooks.slack.com/... -ClaudeCodeOAuthToken sk-ant-...
Re-running the Initial stage later only adds the secrets that are passed; everything else is already set up.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('Initial', 'PostDeploy')]
    [string]$Stage = 'Initial',

    # The repository root. Defaults to the parent of this script's folder.
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),

    # The Azure subscription to use. Defaults to the Azure CLI's current subscription.
    [string]$SubscriptionId,

    # Resource group names. Default to the App Service name from main.bicepparam and "<name>-Preview".
    [string]$ResourceGroup,
    [string]$PreviewResourceGroup,

    # Prefix of the managed identity names (<prefix>-deploy, -pr-whatif, -alert-investigator, -preview-deploy).
    # Defaults to the App Service name in lower case.
    [string]$IdentityPrefix,

    # The Google OAuth client ID for sign-in (the GOOGLE_CLIENT_ID variable). Needed the first time; later runs
    # keep the existing value when it's omitted.
    [string]$GoogleClientId,

    # The service token (at least 32 characters) the smoke and load tests sign in with. Generated when omitted
    # and the secret doesn't exist yet.
    [string]$ServiceToken,

    # Optional repository secrets. Omitted ones are left as they are. See the README's "Required GitHub Secrets".
    [string]$SlackWebhookUrl,
    [string]$ClaudeCodeOAuthToken,
    [string]$AlertInvestigationToken,
    [string]$AutomergeToken,
    [string]$TsCompatPrToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Exit codes are checked by hand so the errors say which command failed.
$PSNativeCommandUseErrorActionPreference = $false

# ----------------------------------------------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------------------------------------------

function Write-Step([string]$Message) { Write-Host "`n== $Message" -ForegroundColor Cyan }
function Write-Done([string]$Message) { Write-Host "   $Message" -ForegroundColor Green }
function Write-Kept([string]$Message) { Write-Host "   $Message (already there)" -ForegroundColor DarkGray }
function Write-Note([string]$Message) { Write-Host "   $Message" -ForegroundColor Yellow }

# Runs az and returns its JSON output as objects. Its warnings go to the console; a non-zero exit code throws.
function Invoke-Az {
    param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
    $output = & az @Arguments --output json --only-show-errors
    if ($LASTEXITCODE -ne 0) { throw "az $($Arguments -join ' ') failed (exit code $LASTEXITCODE)" }
    if ([string]::IsNullOrWhiteSpace(($output -join ''))) { return $null }
    return ($output -join "`n") | ConvertFrom-Json
}

# Runs gh and returns its output lines. A non-zero exit code throws.
function Invoke-Gh {
    param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
    $output = & gh @Arguments
    if ($LASTEXITCODE -ne 0) { throw "gh $($Arguments -join ' ') failed (exit code $LASTEXITCODE)" }
    return $output
}

# Calls the GitHub REST API with a JSON body and returns the parsed response.
# Calls the GitHub REST API, with the body as JSON, and returns the parsed response. The .NET file calls are used
# because the cmdlets (New-TemporaryFile, Set-Content) would do nothing under -WhatIf, and reads need the file.
function Invoke-GhApi([string]$Method, [string]$Path, [hashtable]$Body) {
    $file = [System.IO.Path]::GetTempFileName()
    try {
        $arguments = @('api', '--method', $Method, $Path)
        if ($Body) {
            [System.IO.File]::WriteAllText($file, ($Body | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))
            $arguments += @('--input', $file)
        }
        $response = Invoke-Gh @arguments
        if ($response) { return ($response -join "`n") | ConvertFrom-Json }
    }
    finally {
        [System.IO.File]::Delete($file)
    }
}

# Reads a single-quoted string parameter from a .bicepparam file.
function Read-BicepParam([string]$Path, [string]$Name) {
    $match = Select-String -Path $Path -Pattern "^param\s+$Name\s*=\s*'([^']*)'" | Select-Object -First 1
    if (-not $match) { throw "Couldn't find param $Name in $Path" }
    return $match.Matches[0].Groups[1].Value
}

# Replaces a single-quoted string parameter's value in a .bicepparam file, keeping LF line endings.
function Set-BicepParam([string]$Path, [string]$Name, [string]$Value) {
    $content = Get-Content -Path $Path -Raw
    $updated = [regex]::Replace($content, "(?m)^(param\s+$Name\s*=\s*)'[^']*'", "`${1}'$Value'")
    if ($updated -eq $content) { throw "Couldn't find param $Name in $Path" }
    [System.IO.File]::WriteAllText($Path, $updated, [System.Text.UTF8Encoding]::new($false))
}

# Role definitions and new identities take a little while to be visible everywhere, so a few steps retry.
function Invoke-WithRetry([scriptblock]$Action, [string]$What, [int]$Attempts = 8, [int]$DelaySeconds = 15) {
    for ($attempt = 1; ; $attempt++) {
        try {
            return & $Action
        }
        catch {
            if ($attempt -ge $Attempts) { throw }
            Write-Note "$What failed (attempt $attempt of $Attempts): $($_.Exception.Message -split "`n" | Select-Object -First 1). Retrying in $DelaySeconds s"
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

function New-RandomToken([int]$Length = 56) {
    $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(96)
    $alphanumeric = [Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', ''
    return $alphanumeric.Substring(0, $Length)
}

# ----------------------------------------------------------------------------------------------------------------
# Names, read from the Bicep parameter files
# ----------------------------------------------------------------------------------------------------------------

$mainParams = Join-Path $RepoRoot 'infra/main.bicepparam'
$previewParams = Join-Path $RepoRoot 'infra/preview-shared.bicepparam'
foreach ($file in $mainParams, $previewParams) {
    if (-not (Test-Path $file)) { throw "Not found: $file. Run this from a repository with the infra/ templates, or pass -RepoRoot." }
}

$appName = Read-BicepParam $mainParams 'appServiceName'
$location = Read-BicepParam $mainParams 'location'
$storageAccountName = Read-BicepParam $mainParams 'storageAccountName'
$sqlServerName = Read-BicepParam $mainParams 'sqlServerName'
$sqlDatabaseName = Read-BicepParam $mainParams 'sqlDatabaseName'
$sqlEntraAdminLogin = Read-BicepParam $mainParams 'sqlEntraAdminLogin'
$repository = Read-BicepParam $mainParams 'githubRepository'
$owner, $repoName = $repository -split '/', 2
if (-not $repoName) { throw "githubRepository in main.bicepparam must be owner/repo, not '$repository'" }

# The service token secret's name is whatever main.bicepparam reads it from (e.g. FLASHCARDSAGE_SERVICE_TOKEN).
$tokenMatch = Select-String -Path $mainParams -Pattern "readEnvironmentVariable\('([A-Z0-9_]+_SERVICE_TOKEN)'" | Select-Object -First 1
if (-not $tokenMatch) { throw "Couldn't find the *_SERVICE_TOKEN environment variable main.bicepparam reads" }
$serviceTokenSecretName = $tokenMatch.Matches[0].Groups[1].Value

if (-not $ResourceGroup) { $ResourceGroup = $appName }
if (-not $PreviewResourceGroup) { $PreviewResourceGroup = "$appName-Preview" }
if (-not $IdentityPrefix) { $IdentityPrefix = $appName.ToLowerInvariant() }

$identities = [ordered]@{
    deploy            = @{ Name = "$IdentityPrefix-deploy"; ResourceGroup = $ResourceGroup }
    whatIf            = @{ Name = "$IdentityPrefix-pr-whatif"; ResourceGroup = $ResourceGroup }
    alertInvestigator = @{ Name = "$IdentityPrefix-alert-investigator"; ResourceGroup = $ResourceGroup }
    preview           = @{ Name = "$IdentityPrefix-preview-deploy"; ResourceGroup = $PreviewResourceGroup }
}
$whatIfRoleName = "$appName What-If Reader"

# ----------------------------------------------------------------------------------------------------------------
# Azure and GitHub accounts
# ----------------------------------------------------------------------------------------------------------------

Write-Step 'Checking the Azure and GitHub sign-ins'

if ($SubscriptionId) { Invoke-Az account set --subscription $SubscriptionId | Out-Null }
$account = Invoke-Az account show
if (-not $account) { throw 'Not signed in to Azure. Run az login first.' }
$SubscriptionId = $account.id
$tenantId = $account.tenantId
$signedInUser = $account.user.name
Write-Done "Azure: $($account.name) ($SubscriptionId) as $signedInUser"

Invoke-Gh auth status --hostname github.com | Out-Null
$ownerId = (Invoke-Gh api "users/$owner" --jq .id) -join ''
$repoId = (Invoke-Gh api "repos/$repository" --jq .id) -join ''
Write-Done "GitHub: $repository (owner id $ownerId, repository id $repoId)"

$productionScope = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup"
$previewScope = "/subscriptions/$SubscriptionId/resourceGroups/$PreviewResourceGroup"

# GitHub Actions OIDC tokens for this repository use immutable-ID subjects.
$subjectPrefix = "repo:$owner@$ownerId/$repoName@$repoId"

# ----------------------------------------------------------------------------------------------------------------
# GitHub helpers that need the repository
# ----------------------------------------------------------------------------------------------------------------

# The environments that exist, so variable lookups in one that isn't created yet (under -WhatIf) are skipped.
$script:ghEnvironments = @(Invoke-Gh api "repos/$repository/environments" --jq '.environments[].name')

function Test-GhEnvironment([string]$Name) { return $script:ghEnvironments -contains $Name }

function Get-GhNames([string]$Kind, [string]$Environment) {
    if ($Environment -and -not (Test-GhEnvironment $Environment)) { return @() }
    $arguments = @($Kind, 'list', '--repo', $repository, '--json', 'name', '--jq', '.[].name')
    if ($Environment) { $arguments += @('--env', $Environment) }
    return @(Invoke-Gh @arguments)
}

# Sets a variable or secret unless it already has that value (secrets can't be read back, so they're always set
# when a value is passed in). $Environment empty means repository level.
function Set-GhValue([string]$Kind, [string]$Name, [string]$Value, [string]$Environment, [switch]$Dependabot) {
    $where = if ($Dependabot) { 'Dependabot' } elseif ($Environment) { "environment $Environment" } else { 'repository' }
    if ($Kind -eq 'variable' -and -not $Dependabot -and (-not $Environment -or (Test-GhEnvironment $Environment))) {
        $arguments = @('variable', 'list', '--repo', $repository, '--json', 'name,value', '--jq', ".[] | select(.name == `"$Name`") | .value")
        if ($Environment) { $arguments += @('--env', $Environment) }
        $current = (Invoke-Gh @arguments) -join ''
        if ($current -eq $Value) { Write-Kept "$where $Kind $Name"; return }
    }
    if ($PSCmdlet.ShouldProcess("$where $Kind $Name", 'Set')) {
        $arguments = @($Kind, 'set', $Name, '--repo', $repository, '--body', $Value)
        if ($Environment) { $arguments += @('--env', $Environment) }
        if ($Dependabot) { $arguments += @('--app', 'dependabot') }
        Invoke-Gh @arguments | Out-Null
        Write-Done "$where $Kind $Name set"
    }
}

function Set-GhSecretIfGiven([string]$Name, [string]$Value, [string]$Environment) {
    if ($Value) { Set-GhValue 'secret' $Name $Value $Environment }
}

# Creates (or updates) an environment that only main can deploy to.
function Set-GhEnvironment([string]$Name) {
    if ($PSCmdlet.ShouldProcess("environment $Name", 'Create or update, restricted to main')) {
        Invoke-GhApi PUT "repos/$repository/environments/$Name" @{
            deployment_branch_policy = @{ protected_branches = $false; custom_branch_policies = $true }
        } | Out-Null
        $policies = Invoke-GhApi GET "repos/$repository/environments/$Name/deployment-branch-policies" @{}
        if ($policies.branch_policies | Where-Object { $_.name -eq 'main' -and $_.type -eq 'branch' }) {
            Write-Kept "environment $Name allows main"
        }
        else {
            Invoke-GhApi POST "repos/$repository/environments/$Name/deployment-branch-policies" @{ name = 'main'; type = 'branch' } | Out-Null
            Write-Done "environment $Name created, restricted to main"
        }
        if (-not (Test-GhEnvironment $Name)) { $script:ghEnvironments += $Name }
    }
}

# ----------------------------------------------------------------------------------------------------------------
# Azure helpers
# ----------------------------------------------------------------------------------------------------------------

function Set-ResourceGroup([string]$Name) {
    if (Invoke-Az group exists --name $Name) { Write-Kept "resource group $Name"; return }
    if ($PSCmdlet.ShouldProcess("resource group $Name", "Create in $location")) {
        Invoke-Az group create --name $Name --location $location | Out-Null
        Write-Done "resource group $Name created"
    }
}

# Returns the identity (clientId, principalId), creating it when it doesn't exist. Returns $null under -WhatIf.
function Set-ManagedIdentity([hashtable]$Identity) {
    $existing = Invoke-Az identity list --resource-group $Identity.ResourceGroup --query "[?name=='$($Identity.Name)'] | [0]"
    if ($existing) { Write-Kept "identity $($Identity.Name)"; return $existing }
    if ($PSCmdlet.ShouldProcess("identity $($Identity.Name)", "Create in $($Identity.ResourceGroup)")) {
        $created = Invoke-Az identity create --name $Identity.Name --resource-group $Identity.ResourceGroup --location $location
        Write-Done "identity $($Identity.Name) created"
        return $created
    }
    return $null
}

function Set-FederatedCredential([hashtable]$Identity, [string]$Name, [string]$Subject) {
    $existing = Invoke-Az identity federated-credential list --identity-name $Identity.Name --resource-group $Identity.ResourceGroup
    if ($existing | Where-Object { $_.subject -eq $Subject }) { Write-Kept "$($Identity.Name) trusts $Subject"; return }
    if ($PSCmdlet.ShouldProcess("identity $($Identity.Name)", "Trust GitHub subject $Subject")) {
        Invoke-WithRetry -What "federated credential $Name" {
            Invoke-Az identity federated-credential create --name $Name --identity-name $Identity.Name --resource-group $Identity.ResourceGroup `
                --issuer 'https://token.actions.githubusercontent.com' --subject $Subject --audiences 'api://AzureADTokenExchange' | Out-Null
        }
        Write-Done "$($Identity.Name) trusts $Subject"
    }
}

# The what-if identity only needs to read and to validate deployments. Microsoft.Resources/deployments/write is
# needed too, because a what-if is stored as a deployment.
function Set-WhatIfRole {
    $existing = Invoke-Az role definition list --custom-role-only true --name $whatIfRoleName
    if ($existing) { Write-Kept "role $whatIfRoleName"; return }
    if ($PSCmdlet.ShouldProcess("role $whatIfRoleName", "Create, assignable in $ResourceGroup")) {
        $file = [System.IO.Path]::GetTempFileName()
        try {
            $definition = @{
                Name             = $whatIfRoleName
                Description      = "Read everything in the $ResourceGroup resource group and run Bicep what-if deployments against it."
                Actions          = @(
                    '*/read'
                    'Microsoft.Resources/deployments/write'
                    'Microsoft.Resources/deployments/validate/action'
                    'Microsoft.Resources/deployments/whatIf/action'
                )
                NotActions       = @()
                AssignableScopes = @($productionScope)
            } | ConvertTo-Json
            [System.IO.File]::WriteAllText($file, $definition, [System.Text.UTF8Encoding]::new($false))
            Invoke-Az role definition create --role-definition "@$file" | Out-Null
        }
        finally {
            [System.IO.File]::Delete($file)
        }
        Write-Done "role $whatIfRoleName created"
    }
}

# Assigns by object ID and principal type, which doesn't need a directory lookup, so it works right after the
# identity is created. az role assignment create is idempotent, but the listing keeps the output honest.
function Grant-Role($Principal, [string]$PrincipalName, [string]$Role, [string]$Scope) {
    $scopeName = $Scope -replace '^.*/resourceGroups/', 'resource group ' -replace '^/subscriptions/[^/]+$', 'the subscription'
    if ($null -eq $Principal) { Write-Note "$PrincipalName would get $Role on $scopeName (identity not created yet)"; return }
    $existing = Invoke-Az role assignment list --assignee $Principal.principalId --scope $Scope --query "[?roleDefinitionName=='$Role']"
    if ($existing) { Write-Kept "$PrincipalName has $Role on $scopeName"; return }
    if ($PSCmdlet.ShouldProcess($PrincipalName, "Grant $Role on $scopeName")) {
        Invoke-WithRetry -What "role assignment $Role" {
            Invoke-Az role assignment create --assignee-object-id $Principal.principalId --assignee-principal-type ServicePrincipal `
                --role $Role --scope $Scope | Out-Null
        }
        Write-Done "$PrincipalName has $Role on $scopeName"
    }
}

# ----------------------------------------------------------------------------------------------------------------
# Stage 1: before the first deployment
# ----------------------------------------------------------------------------------------------------------------

function Invoke-InitialStage {
    Write-Step 'Resource groups'
    Set-ResourceGroup $ResourceGroup
    Set-ResourceGroup $PreviewResourceGroup

    Write-Step 'Managed identities'
    $principals = @{}
    foreach ($key in $identities.Keys) {
        $principals[$key] = Set-ManagedIdentity $identities[$key]
    }

    Write-Step 'Federated credentials (GitHub Actions OIDC)'
    Set-FederatedCredential $identities.deploy 'github-production' "${subjectPrefix}:environment:production"
    Set-FederatedCredential $identities.whatIf 'github-pull-request' "${subjectPrefix}:pull_request"
    Set-FederatedCredential $identities.alertInvestigator 'github-alert-investigation' "${subjectPrefix}:environment:alert-investigation"
    Set-FederatedCredential $identities.preview 'github-pull-request' "${subjectPrefix}:pull_request"

    Write-Step 'Role assignments'
    Set-WhatIfRole
    # Storage Blob Data Owner is granted on the resource group rather than the storage account, which doesn't
    # exist until the first deployment, and the deployment needs it right away to turn on the static website.
    Grant-Role $principals.deploy $identities.deploy.Name 'Contributor' $productionScope
    Grant-Role $principals.deploy $identities.deploy.Name 'Storage Blob Data Owner' $productionScope
    Grant-Role $principals.whatIf $identities.whatIf.Name $whatIfRoleName $productionScope
    foreach ($role in 'Reader', 'Monitoring Reader', 'Log Analytics Reader', 'Cost Management Reader') {
        Grant-Role $principals.alertInvestigator $identities.alertInvestigator.Name $role $productionScope
    }
    # Service Health events are subscription-wide.
    Grant-Role $principals.alertInvestigator $identities.alertInvestigator.Name 'Monitoring Reader' "/subscriptions/$SubscriptionId"
    Grant-Role $principals.preview $identities.preview.Name 'Contributor' $previewScope
    Grant-Role $principals.preview $identities.preview.Name 'Storage Blob Data Owner' $previewScope

    Write-Step 'Preview SQL server admin (infra/preview-shared.bicepparam)'
    if ($null -eq $principals.preview) {
        Write-Note "sqlEntraAdminObjectId would be set to the $($identities.preview.Name) identity's object ID"
    }
    else {
        $currentLogin = Read-BicepParam $previewParams 'sqlEntraAdminLogin'
        $currentObjectId = Read-BicepParam $previewParams 'sqlEntraAdminObjectId'
        if ($currentLogin -eq $identities.preview.Name -and $currentObjectId -eq $principals.preview.principalId) {
            Write-Kept 'preview-shared.bicepparam names the preview identity'
        }
        elseif ($PSCmdlet.ShouldProcess($previewParams, "Set sqlEntraAdminLogin/sqlEntraAdminObjectId to $($identities.preview.Name)")) {
            Set-BicepParam $previewParams 'sqlEntraAdminLogin' $identities.preview.Name
            Set-BicepParam $previewParams 'sqlEntraAdminObjectId' $principals.preview.principalId
            Write-Done 'preview-shared.bicepparam updated: commit it before opening a pull request'
        }
    }

    Write-Step 'GitHub environments'
    Set-GhEnvironment 'production'
    Set-GhEnvironment 'alert-investigation'

    Write-Step 'GitHub variables'
    # The PR jobs (what-if, preview deploy and cleanup) run without an environment, so they only see these.
    Set-GhValue 'variable' 'AZURE_TENANT_ID' $tenantId
    Set-GhValue 'variable' 'AZURE_SUBSCRIPTION_ID' $SubscriptionId
    Set-GhValue 'variable' 'AZURE_RESOURCE_GROUP' $ResourceGroup
    if ($principals.whatIf) { Set-GhValue 'variable' 'AZURE_WHATIF_CLIENT_ID' $principals.whatIf.clientId }
    if ($principals.preview) { Set-GhValue 'variable' 'AZURE_PREVIEW_CLIENT_ID' $principals.preview.clientId }
    if ($GoogleClientId) {
        Set-GhValue 'variable' 'GOOGLE_CLIENT_ID' $GoogleClientId
    }
    elseif ((Get-GhNames 'variable') -notcontains 'GOOGLE_CLIENT_ID') {
        Write-Note 'GOOGLE_CLIENT_ID is not set. Pass -GoogleClientId, or sign-in will not work.'
    }
    if ($principals.deploy) { Set-GhValue 'variable' 'AZURE_CLIENT_ID' $principals.deploy.clientId 'production' }
    Set-GhValue 'variable' 'AZURE_BACKEND_APP_NAME' $appName 'production'
    Set-GhValue 'variable' 'AZURE_STORAGE_ACCOUNT_NAME' $storageAccountName 'production'
    if ($principals.alertInvestigator) {
        Set-GhValue 'variable' 'AZURE_ALERT_INVESTIGATOR_CLIENT_ID' $principals.alertInvestigator.clientId 'alert-investigation'
    }
    Write-Note 'AZURE_BACKEND_URL is set by the PostDeploy stage, once the App Service exists.'

    Write-Step 'GitHub secrets'
    # Both the migrations (as the deploy identity) and the API (as the App Service identity) sign in to SQL as
    # whoever they're running as. The long timeout gives the serverless database time to resume.
    $connectionString = "Server=tcp:$sqlServerName.database.windows.net,1433;Initial Catalog=$sqlDatabaseName;" +
    'Authentication=Active Directory Default;Encrypt=True;TrustServerCertificate=False;Connection Timeout=120;'
    Set-GhValue 'secret' 'AZURE_SQL_CONNECTION_STRING' $connectionString 'production'
    if ($ServiceToken) {
        if ($ServiceToken.Length -lt 32) { throw 'The service token must be at least 32 characters.' }
        Set-GhValue 'secret' $serviceTokenSecretName $ServiceToken 'production'
    }
    elseif ((Get-GhNames 'secret' 'production') -contains $serviceTokenSecretName) {
        Write-Kept "environment production secret $serviceTokenSecretName"
    }
    else {
        Set-GhValue 'secret' $serviceTokenSecretName (New-RandomToken) 'production'
        Write-Note "A random $serviceTokenSecretName was generated. Pass -ServiceToken to use a value you also keep elsewhere."
    }
    Set-GhSecretIfGiven 'SLACK_WEBHOOK_URL' $SlackWebhookUrl
    Set-GhSecretIfGiven 'CLAUDE_CODE_OAUTH_TOKEN' $ClaudeCodeOAuthToken
    Set-GhSecretIfGiven 'ALERT_INVESTIGATION_TOKEN' $AlertInvestigationToken
    Set-GhSecretIfGiven 'TS_COMPAT_PR_TOKEN' $TsCompatPrToken
    if ($AutomergeToken) {
        # The Dependabot workflows run with Dependabot's secrets, the CI failure investigation with the repository's.
        Set-GhValue 'secret' 'AUTOMERGE_TOKEN' $AutomergeToken
        Set-GhValue 'secret' 'AUTOMERGE_TOKEN' $AutomergeToken -Dependabot
    }
    $missing = @('CLAUDE_CODE_OAUTH_TOKEN', 'SLACK_WEBHOOK_URL', 'ALERT_INVESTIGATION_TOKEN', 'AUTOMERGE_TOKEN', 'TS_COMPAT_PR_TOKEN') |
        Where-Object { $_ -notin (Get-GhNames 'secret') }
    if ($missing) { Write-Note "Optional secrets not set: $($missing -join ', '). Re-run with their parameters to add them." }

    Write-Step 'Branch ruleset for main'
    Set-MainRuleset

    Write-Step 'Next steps'
    Write-Host @"
   1. Commit infra/preview-shared.bicepparam if it changed.
   2. Push to main (or merge the scaffolding pull request). deploy-infrastructure creates the Azure resources;
      deploy-backend then fails at the migrations because the database users don't exist yet.
   3. Run .\infra\Setup-Environment.ps1 -Stage PostDeploy to create the database users, set AZURE_BACKEND_URL
      and re-run the failed deployment.
"@
}

# Matches CONTRIBUTING.md: pull requests only, with the build, test and CodeQL checks required to pass.
function Set-MainRuleset {
    $rulesetName = 'MainRuleset'
    $ruleset = @{
        name          = $rulesetName
        target        = 'branch'
        enforcement   = 'active'
        bypass_actors = @()
        conditions    = @{ ref_name = @{ include = @('~DEFAULT_BRANCH'); exclude = @() } }
        rules         = @(
            @{ type = 'deletion' }
            @{ type = 'non_fast_forward' }
            @{
                type       = 'pull_request'
                parameters = @{
                    required_approving_review_count   = 0
                    dismiss_stale_reviews_on_push     = $false
                    require_code_owner_review         = $false
                    require_last_push_approval        = $false
                    required_review_thread_resolution = $true
                    allowed_merge_methods             = @('merge', 'squash', 'rebase')
                }
            }
            @{
                type       = 'required_status_checks'
                parameters = @{
                    strict_required_status_checks_policy = $true
                    do_not_enforce_on_create             = $true
                    required_status_checks               = @(
                        @{ context = 'Backend Build & Test'; integration_id = 15368 }
                        @{ context = 'Frontend Build, Lint & Test'; integration_id = 15368 }
                        @{ context = 'e2e-tests'; integration_id = 15368 }
                        @{ context = 'CodeQL'; integration_id = 57789 }
                    )
                }
            }
            @{
                type       = 'code_scanning'
                parameters = @{
                    code_scanning_tools = @(@{ tool = 'CodeQL'; alerts_threshold = 'all'; security_alerts_threshold = 'all' })
                }
            }
        )
    }
    $existing = Invoke-GhApi GET "repos/$repository/rulesets" @{} | Where-Object { $_.name -eq $rulesetName } | Select-Object -First 1
    if ($existing) {
        if ($PSCmdlet.ShouldProcess("ruleset $rulesetName", 'Update')) {
            Invoke-GhApi PUT "repos/$repository/rulesets/$($existing.id)" $ruleset | Out-Null
            Write-Done "ruleset $rulesetName updated"
        }
    }
    elseif ($PSCmdlet.ShouldProcess("ruleset $rulesetName", 'Create')) {
        Invoke-GhApi POST "repos/$repository/rulesets" $ruleset | Out-Null
        Write-Done "ruleset $rulesetName created"
    }
}

# ----------------------------------------------------------------------------------------------------------------
# Stage 2: after the first deployment
# ----------------------------------------------------------------------------------------------------------------

# Creates or updates a database user for a managed identity with the given roles. The user is created from its
# SID rather than FROM EXTERNAL PROVIDER, which would need the SQL server to read Microsoft Entra ID. Azure SQL
# derives an application's SID from its client ID, the same way .github/scripts/preview-db-user.sql does.
function Set-DatabaseUser([System.Data.SqlClient.SqlConnection]$Connection, [string]$Name, [string]$ClientId, [string[]]$Roles) {
    $command = $Connection.CreateCommand()
    $command.Parameters.AddWithValue('@name', $Name) | Out-Null
    $command.Parameters.AddWithValue('@clientId', $ClientId) | Out-Null
    $command.Parameters.AddWithValue('@roles', ($Roles -join ',')) | Out-Null
    $command.CommandText = @'
DECLARE @sid varbinary(16) = CAST(CAST(@clientId AS uniqueidentifier) AS varbinary(16));
DECLARE @existing varbinary(85) = (SELECT sid FROM sys.database_principals WHERE name = @name);
DECLARE @sql nvarchar(max);

IF @existing IS NOT NULL AND @existing <> @sid
BEGIN
    SET @sql = N'DROP USER ' + QUOTENAME(@name) + N';';
    EXEC sys.sp_executesql @sql;
    SET @existing = NULL;
END;

IF @existing IS NULL
BEGIN
    -- CREATE USER takes a literal SID, not a variable.
    SET @sql = N'CREATE USER ' + QUOTENAME(@name) + N' WITH SID = ' + CONVERT(nvarchar(34), @sid, 1) + N', TYPE = E;';
    EXEC sys.sp_executesql @sql;
END;

DECLARE @role sysname;
DECLARE roles CURSOR LOCAL FAST_FORWARD FOR SELECT TRIM(value) FROM STRING_SPLIT(@roles, ',');
OPEN roles;
FETCH NEXT FROM roles INTO @role;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF IS_ROLEMEMBER(@role, @name) = 0
    BEGIN
        SET @sql = N'ALTER ROLE ' + QUOTENAME(@role) + N' ADD MEMBER ' + QUOTENAME(@name) + N';';
        EXEC sys.sp_executesql @sql;
    END;
    FETCH NEXT FROM roles INTO @role;
END;
CLOSE roles;
DEALLOCATE roles;
'@
    $command.ExecuteNonQuery() | Out-Null
    Write-Done "database user $Name has $($Roles -join ', ')"
}

# Opens a connection to the production database as the signed-in Azure CLI user. The server only lets Azure
# services in, so this machine's address is allowed through for the duration of the script.
function Open-DatabaseConnection([string]$ServerFqdn) {
    $token = (Invoke-Az account get-access-token --resource 'https://database.windows.net/' --query accessToken)
    $connection = [System.Data.SqlClient.SqlConnection]::new(
        "Server=tcp:$ServerFqdn,1433;Initial Catalog=$sqlDatabaseName;Encrypt=True;TrustServerCertificate=False;Connection Timeout=120;")
    $connection.AccessToken = $token
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        try {
            $connection.Open()
            return $connection
        }
        catch {
            $message = $_.Exception.Message
            if ($message -match "Client with IP address '([\d.]+)' is not allowed") {
                $ip = $Matches[1]
                Write-Note "Allowing $ip through the SQL server firewall while the script runs"
                Invoke-Az sql server firewall-rule create --resource-group $ResourceGroup --server $sqlServerName `
                    --name $script:firewallRuleName --start-ip-address $ip --end-ip-address $ip | Out-Null
                $script:firewallRuleAdded = $true
            }
            elseif ($attempt -ge 10) {
                throw
            }
            else {
                Write-Note "Connecting to $ServerFqdn failed (attempt $attempt of 10; the database may be resuming); retrying in 15 s"
            }
            Start-Sleep -Seconds 15
        }
    }
}

function Invoke-PostDeployStage {
    Write-Step 'App Service'
    $webApp = Invoke-Az webapp list --resource-group $ResourceGroup --query "[?name=='$appName'].{host:defaultHostName,id:id} | [0]"
    if (-not $webApp) { throw "App Service $appName doesn't exist in $ResourceGroup yet. Push to main so deploy-infrastructure creates it, then run this stage." }
    $backendUrl = "https://$($webApp.host)"
    Set-GhValue 'variable' 'AZURE_BACKEND_URL' $backendUrl 'production'

    Write-Step 'Database users'
    if ($signedInUser -ne $sqlEntraAdminLogin) {
        Write-Note "Signed in to Azure as $signedInUser, but the SQL Entra admin in main.bicepparam is $sqlEntraAdminLogin. Creating users may fail."
    }
    $deployIdentity = Invoke-Az identity show --name $identities.deploy.Name --resource-group $ResourceGroup
    # Resource Manager exposes the App Service identity's client ID without a Microsoft Entra ID lookup.
    $apiClientId = Invoke-Az rest --method get --query properties.clientId `
        --url "https://management.azure.com$($webApp.id)/providers/Microsoft.ManagedIdentity/identities/default?api-version=2023-01-31"
    $serverFqdn = Invoke-Az sql server show --name $sqlServerName --resource-group $ResourceGroup --query fullyQualifiedDomainName
    if ($PSCmdlet.ShouldProcess("database $sqlDatabaseName on $serverFqdn", "Create users $($identities.deploy.Name) (db_owner) and $appName (db_datareader, db_datawriter)")) {
        $script:firewallRuleName = 'Setup-Environment-temporary'
        $script:firewallRuleAdded = $false
        $connection = $null
        try {
            $connection = Open-DatabaseConnection $serverFqdn
            Set-DatabaseUser $connection $identities.deploy.Name $deployIdentity.clientId @('db_owner')
            Set-DatabaseUser $connection $appName $apiClientId @('db_datareader', 'db_datawriter')
        }
        finally {
            if ($connection) { $connection.Dispose() }
            if ($script:firewallRuleAdded) {
                Invoke-Az sql server firewall-rule delete --resource-group $ResourceGroup --server $sqlServerName --name $script:firewallRuleName | Out-Null
                Write-Done 'temporary firewall rule removed'
            }
        }
    }

    Write-Step 'Re-running the deployment'
    $run = Invoke-Gh run list --repo $repository --workflow ci.yml --branch main --limit 1 --json 'databaseId,conclusion,status' |
        ConvertFrom-Json | Select-Object -First 1
    if (-not $run) {
        Write-Note 'No CI run on main yet. Push to main to deploy.'
    }
    elseif ($run.conclusion -eq 'failure' -and $PSCmdlet.ShouldProcess("CI run $($run.databaseId)", 'Re-run failed jobs')) {
        Invoke-Gh run rerun $run.databaseId --repo $repository --failed | Out-Null
        Write-Done "re-running the failed jobs of run $($run.databaseId)"
    }
    else {
        Write-Kept "latest CI run on main is $($run.status) ($($run.conclusion))"
    }

    Write-Step 'Next steps'
    # The custom domain when main.bicepparam sets one (the deployment registers it), otherwise the web endpoint.
    $storage = Invoke-Az storage account show --name $storageAccountName --resource-group $ResourceGroup --query '{domain:customDomain.name,web:primaryEndpoints.web}'
    $frontendOrigin = if ($storage.domain) { "https://$($storage.domain)" } else { $storage.web -replace '/$', '' }
    Write-Host @"
   1. Add $frontendOrigin (or the custom domain) to the Google OAuth client's authorized
      JavaScript origins, so sign-in works on the deployed site.
   2. Optional: Slack alerts, Claude investigations, Dependabot auto-merge and a custom domain (see the README).
      Re-run the Initial stage with -SlackWebhookUrl, -ClaudeCodeOAuthToken, -AlertInvestigationToken,
      -AutomergeToken or -TsCompatPrToken to add those secrets.
"@
}

# ----------------------------------------------------------------------------------------------------------------

Write-Host "`nSetting up $appName ($repository) in subscription $SubscriptionId, stage $Stage" -ForegroundColor White
switch ($Stage) {
    'Initial' { Invoke-InitialStage }
    'PostDeploy' { Invoke-PostDeployStage }
}
Write-Host ''
