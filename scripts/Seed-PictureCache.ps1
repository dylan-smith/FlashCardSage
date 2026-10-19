#Requires -Version 7.2
<#
.SYNOPSIS
    Adds the pictures already on cards to the cache of generated pictures (GeneratedImages), once.

.DESCRIPTION
    The cache only fills as pictures are generated, so the pictures cards had before it came are added by this
    script, run once after the cache and cards sharing its pictures have deployed. Every picture is taken to be a
    generated one: any user who asks for a picture of the same words can be shown it.

    Each card's picture is cached under the prompt the API would make from its words today (its English words
    joined by " / ", as the card form sends them, or its Spanish ones when it has no English), and the cache row
    points at the card's own file, which the card then shares, so nothing is copied. Deleting the card later leaves
    the file alone, since card code never removes a cached picture.

    The same picture is only cached once for the same words, by its content: users who added a built-in deck each
    have a copy of its pictures. The built-in cards' pictures go first, so they're the first anyone is shown. Pictures
    already cached, and files that are gone, are passed over, so the script can be run again.

    Needs the Azure CLI, signed in as someone who can write to the database (the SQL Entra admin). The server only
    lets Azure services in, so this machine's address is allowed through while the script runs.

.EXAMPLE
    ./scripts/Seed-PictureCache.ps1 -WhatIf

.EXAMPLE
    ./scripts/Seed-PictureCache.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ResourceGroup = 'FlashCardSage',
    [string]$SqlServerName = 'flashcardsage-sql',
    [string]$DatabaseName = 'FlashCardSage',
    # Another database to run against, such as a local one, signed in to by the connection string itself.
    [string]$ConnectionString
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) { Write-Host "`n== $Message" -ForegroundColor Cyan }
function Write-Done([string]$Message) { Write-Host "   $Message" -ForegroundColor Green }
function Write-Note([string]$Message) { Write-Host "   $Message" -ForegroundColor Yellow }

# Runs az and returns its parsed JSON output. A non-zero exit code throws.
function Invoke-Az {
    param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
    $output = & az @Arguments --output json --only-show-errors
    if ($LASTEXITCODE -ne 0) { throw "az $($Arguments -join ' ') failed (exit code $LASTEXITCODE)" }
    if ([string]::IsNullOrWhiteSpace(($output -join ''))) { return $null }
    return ($output -join "`n") | ConvertFrom-Json
}

# What the pictures are cached by, as CachedImageGenerator.PromptHash works it out from FoundryImageGenerator.Prompt.
function Get-PromptHash([string]$Spanish, [string]$English) {
    $subject = if ($English.Length -gt 0) { $English } else { "the Spanish word $Spanish" }
    $prompt = 'A simple, friendly, flat illustration for a language-learning flash card, showing the idea of: ' +
        "$subject. The picture contains no writing at all: no text, letters, words, labels, captions or " +
        'watermarks.'
    $bytes = [Text.Encoding]::UTF8.GetBytes($prompt.ToLowerInvariant())
    return [Convert]::ToHexStringLower([Security.Cryptography.SHA256]::HashData($bytes))
}

# A picture's content, as CardImage.ContentName names a cached one, so a copy of a picture is known by it.
function Get-ContentKey([byte[]]$Data) {
    return [Convert]::ToHexStringLower([Security.Cryptography.SHA256]::HashData($Data)).Substring(0, 32)
}

# A picture from its public URL (the storage container is public), or null when it's gone.
function Read-Picture([string]$Url) {
    $response = $http.GetAsync($Url).GetAwaiter().GetResult()
    try {
        if ($response.StatusCode -eq [Net.HttpStatusCode]::NotFound) { return $null }
        [void]$response.EnsureSuccessStatusCode()
        return , $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    }
    finally {
        $response.Dispose()
    }
}

# CachedImageGeneratorTests pins the same hash, so the script and the API agree.
if ((Get-PromptHash 'el gato' 'The Cat') -ne '06dcb8eb380d7c5d28cf9059d811a2113472cf74c38972efe6ee8212c3234839') {
    throw "The prompt hash doesn't match the API's. Update Get-PromptHash from FoundryImageGenerator.Prompt."
}

$firewallRuleName = 'Seed-PictureCache-temporary'
$firewallRuleAdded = $false
$connection = $null
$http = [Net.Http.HttpClient]::new()
try {
    if ($ConnectionString) {
        Write-Step 'Connecting to the given database'
        $connection = [Data.SqlClient.SqlConnection]::new($ConnectionString)
    }
    else {
        Write-Step "Connecting to $DatabaseName on $SqlServerName"
        $token = (Invoke-Az account get-access-token --resource 'https://database.windows.net/' --query accessToken)
        $connection = [Data.SqlClient.SqlConnection]::new(
            "Server=tcp:$SqlServerName.database.windows.net,1433;Initial Catalog=$DatabaseName;Encrypt=True;" +
            'TrustServerCertificate=False;Connection Timeout=120;')
        $connection.AccessToken = $token
    }
    for ($attempt = 1; ; $attempt++) {
        try {
            $connection.Open()
            break
        }
        catch {
            $message = $_.Exception.Message
            if (-not $firewallRuleAdded -and $message -match "Client with IP address '([\d.]+)' is not allowed") {
                $ip = $Matches[1]
                Write-Note "Allowing $ip through the SQL server firewall while the script runs"
                Invoke-Az sql server firewall-rule create --resource-group $ResourceGroup --server $SqlServerName `
                    --name $firewallRuleName --start-ip-address $ip --end-ip-address $ip | Out-Null
                $firewallRuleAdded = $true
            }
            elseif ($message -match 'Login failed') {
                # Not something waiting fixes: the signed-in account isn't one the database knows.
                $signedIn = if ($ConnectionString) { 'the connection string' }
                else { "the Azure CLI's $((Invoke-Az account show).user.name)" }
                throw "The database refused $signedIn. Sign in as the SQL server's Entra admin " +
                    "(az sql server ad-admin list -g $ResourceGroup -s $SqlServerName) with az login, then run the " +
                    "script again."
            }
            elseif ($attempt -ge 10) {
                throw
            }
            else {
                # A new firewall rule takes a moment to apply, and a paused database a minute to resume.
                Write-Note "Connecting failed (attempt $attempt of 10): $message; retrying in 15 s"
            }
            Start-Sleep -Seconds 15
        }
    }
    Write-Done 'Connected'

    Write-Step 'Reading the cache and the cards with pictures'
    # What's cached already, by its URL, and by prompt and content. A picture this script cached is named like any
    # card's, not after its content, so the content is read from each file.
    $cachedRows = [Collections.Generic.List[object]]::new()
    $command = $connection.CreateCommand()
    $command.CommandText = 'SELECT [PromptHash], [ImageUrl] FROM [dbo].[GeneratedImages]'
    $reader = $command.ExecuteReader()
    while ($reader.Read()) {
        $cachedRows.Add([pscustomobject]@{ PromptHash = $reader.GetString(0); ImageUrl = $reader.GetString(1) })
    }
    $reader.Close()
    $cachedUrls = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $cached = [Collections.Generic.HashSet[string]]::new()
    foreach ($row in $cachedRows) {
        [void]$cachedUrls.Add($row.ImageUrl)
        if ($null -ne ($data = Read-Picture $row.ImageUrl)) {
            [void]$cached.Add("$($row.PromptHash)/$(Get-ContentKey $data)")
        }
    }

    # Each card with a picture, built-in ones first, with its words in order.
    $cards = [Collections.Generic.List[object]]::new()
    $cardsById = [Collections.Generic.Dictionary[int, object]]::new()
    $card = $null
    $command = $connection.CreateCommand()
    $command.CommandText = @'
SELECT c.[Id], c.[ImageUrl], w.[Language], w.[Text]
FROM [dbo].[FlashCards] c
JOIN [dbo].[Users] u ON u.[Id] = c.[UserId]
JOIN [dbo].[FlashCardWords] w ON w.[FlashCardId] = c.[Id]
WHERE c.[ImageUrl] IS NOT NULL
ORDER BY CASE WHEN u.[Subject] = 'system' THEN 0 ELSE 1 END, c.[Id], w.[Language], w.[Position]
'@
    $reader = $command.ExecuteReader()
    while ($reader.Read()) {
        $id = $reader.GetInt32(0)
        if (-not $cardsById.TryGetValue($id, [ref]$card)) {
            $card = [pscustomobject]@{
                Id = $id; ImageUrl = $reader.GetString(1)
                Spanish = [Collections.Generic.List[string]]::new(); English = [Collections.Generic.List[string]]::new()
            }
            $cardsById[$id] = $card
            $cards.Add($card)
        }
        $card.($reader.GetString(2)).Add($reader.GetString(3))
    }
    $reader.Close()
    Write-Done "$($cachedUrls.Count) pictures cached already, $($cards.Count) cards with pictures"

    Write-Step 'Working out what to add'
    $added = [Collections.Generic.List[object]]::new()
    $copies = 0
    $gone = 0
    foreach ($card in $cards) {
        if ($cachedUrls.Contains($card.ImageUrl)) {
            continue
        }

        $data = Read-Picture $card.ImageUrl
        if ($null -eq $data) {
            $gone++
            continue
        }

        $hash = Get-PromptHash ($card.Spanish -join ' / ') ($card.English -join ' / ')
        if (-not $cached.Add("$hash/$(Get-ContentKey $data)")) {
            $copies++
            continue
        }
        $added.Add([pscustomobject]@{ Card = $card; PromptHash = $hash })
    }
    Write-Done "$($added.Count) pictures to add; $copies copies of pictures already cached and $gone missing files passed over"

    if ($added.Count -gt 0 -and $PSCmdlet.ShouldProcess($connection.Database,"Add $($added.Count) pictures to the cache")) {
        Write-Step 'Adding them'
        $transaction = $connection.BeginTransaction()
        $command = $connection.CreateCommand()
        $command.Transaction = $transaction
        $command.CommandText = 'INSERT INTO [dbo].[GeneratedImages] ([PromptHash], [ImageUrl], [CreatedAt]) ' +
            'VALUES (@promptHash, @imageUrl, SYSDATETIMEOFFSET())'
        $promptHash = $command.Parameters.Add('@promptHash', [Data.SqlDbType]::Char, 64)
        $imageUrl = $command.Parameters.Add('@imageUrl', [Data.SqlDbType]::NVarChar, 400)
        foreach ($item in $added) {
            $promptHash.Value = $item.PromptHash
            $imageUrl.Value = $item.Card.ImageUrl
            [void]$command.ExecuteNonQuery()
        }
        $transaction.Commit()
        Write-Done "Added $($added.Count) pictures"
    }
}
finally {
    $http.Dispose()
    if ($connection) { $connection.Dispose() }
    if ($firewallRuleAdded) {
        Invoke-Az sql server firewall-rule delete --resource-group $ResourceGroup --server $SqlServerName `
            --name $firewallRuleName | Out-Null
        Write-Note 'Removed the temporary firewall rule'
    }
}
