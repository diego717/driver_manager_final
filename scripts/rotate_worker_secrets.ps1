param(
    [switch]$ApplyWeb,
    [switch]$ApplyApi,
    [string]$OutFile = "secrets-rotation-plan.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function New-RandomBase64Url {
    param([int]$Bytes = 48)
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    } finally {
        $rng.Dispose()
    }
    $b64 = [Convert]::ToBase64String($buffer)
    return $b64.TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-StrongPassword {
    # 24 chars, includes upper/lower/digit/special for bootstrap password policy
    $upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    $lower = "abcdefghijkmnopqrstuvwxyz"
    $digits = "23456789"
    $special = "!@#$%^&*()-_=+[]{}:,.?"
    $all = ($upper + $lower + $digits + $special).ToCharArray()

    $chars = @(
        $upper[(Get-Random -Minimum 0 -Maximum $upper.Length)]
        $lower[(Get-Random -Minimum 0 -Maximum $lower.Length)]
        $digits[(Get-Random -Minimum 0 -Maximum $digits.Length)]
        $special[(Get-Random -Minimum 0 -Maximum $special.Length)]
    )

    for ($i = $chars.Count; $i -lt 24; $i++) {
        $chars += $all[(Get-Random -Minimum 0 -Maximum $all.Length)]
    }

    # Shuffle
    $chars = $chars | Sort-Object { Get-Random }
    return -join $chars
}

function Set-WranglerSecret {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )
    # Wrangler reads the secret value from STDIN.
    $Value | npx wrangler secret put $Name | Out-Host
}

$rotation = [ordered]@{
    generated_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    notes = @(
        "WEB_SESSION_SECRET rotation logs out current web sessions (expected).",
        "WEB_LOGIN_PASSWORD is only for bootstrap/initialization; keep it strong even if not actively used.",
        "API_TOKEN/API_SECRET rotation WILL break existing desktop or private HMAC clients until they are updated."
    )
    web = [ordered]@{
        WEB_SESSION_SECRET = New-RandomBase64Url -Bytes 48
        WEB_LOGIN_PASSWORD = New-StrongPassword
    }
    api = [ordered]@{
        API_TOKEN = New-RandomBase64Url -Bytes 32
        API_SECRET = New-RandomBase64Url -Bytes 48
    }
}

$rotationJson = $rotation | ConvertTo-Json -Depth 6
Set-Content -Path $OutFile -Value $rotationJson -Encoding UTF8

Write-Host "Rotation plan generated:" -ForegroundColor Cyan
Write-Host "  File: $OutFile"
Write-Host ""
Write-Host "Safe now (web only, logs out sessions):" -ForegroundColor Yellow
Write-Host "  .\\scripts\\rotate_worker_secrets.ps1 -ApplyWeb"
Write-Host ""
Write-Host "Requires coordinated client rollout (legacy API/HMAC):" -ForegroundColor Yellow
Write-Host "  .\\scripts\\rotate_worker_secrets.ps1 -ApplyApi"
Write-Host ""

if ($ApplyWeb) {
    Write-Host "Applying WEB_* secrets..." -ForegroundColor Green
    Set-WranglerSecret -Name "WEB_SESSION_SECRET" -Value $rotation.web.WEB_SESSION_SECRET
    Set-WranglerSecret -Name "WEB_LOGIN_PASSWORD" -Value $rotation.web.WEB_LOGIN_PASSWORD
}

if ($ApplyApi) {
    Write-Host "Applying API_* secrets..." -ForegroundColor Red
    Write-Host "WARNING: This will invalidate current legacy/private HMAC clients until they are reconfigured." -ForegroundColor Red
    Set-WranglerSecret -Name "API_TOKEN" -Value $rotation.api.API_TOKEN
    Set-WranglerSecret -Name "API_SECRET" -Value $rotation.api.API_SECRET
}

if (-not $ApplyWeb -and -not $ApplyApi) {
    Write-Host "Dry run only. No secrets were changed." -ForegroundColor Green
}
