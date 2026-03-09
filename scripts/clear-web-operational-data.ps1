param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,

    [Parameter(Mandatory = $true)]
    [string]$Username,

    [Parameter(Mandatory = $true)]
    [string]$Password,

    [int]$Limit = 100,
    [int]$TimeoutSec = 25,
    [int]$MaxPasses = 200,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ($Limit -lt 1 -or $Limit -gt 500) {
    throw "Limit debe estar entre 1 y 500."
}

if ($TimeoutSec -lt 5) {
    throw "TimeoutSec debe ser >= 5."
}

$normalizedBase = $BaseUrl.Trim()
while ($normalizedBase.EndsWith("/")) {
    $normalizedBase = $normalizedBase.Substring(0, $normalizedBase.Length - 1)
}

Write-Host "Base URL: $normalizedBase"
Write-Host "Usuario: $Username"
Write-Host "DryRun: $DryRun"

$loginBody = @{
    username = $Username
    password = $Password
} | ConvertTo-Json

Write-Host "Iniciando sesión..."
$login = Invoke-RestMethod `
    -Method POST `
    -Uri "$normalizedBase/web/auth/login" `
    -ContentType "application/json" `
    -Body $loginBody `
    -TimeoutSec $TimeoutSec

$token = ""
if ($null -ne $login -and $null -ne $login.access_token) {
    $token = [string]$login.access_token
}
if ([string]::IsNullOrWhiteSpace($token)) {
    throw "Login sin access_token."
}

$headers = @{
    Authorization = "Bearer $token"
}

function Get-InstallationsPage {
    param(
        [string]$Url,
        [hashtable]$AuthHeaders,
        [int]$PageLimit,
        [int]$ReqTimeoutSec
    )

    $result = Invoke-RestMethod `
        -Method GET `
        -Uri "$Url/web/installations?limit=$PageLimit" `
        -Headers $AuthHeaders `
        -TimeoutSec $ReqTimeoutSec

    if ($null -eq $result) {
        return @()
    }
    return @($result)
}

function Test-InstallationStillExists {
    param(
        [string]$Url,
        [hashtable]$AuthHeaders,
        [int]$InstallationId,
        [int]$ReqTimeoutSec
    )

    try {
        Invoke-RestMethod `
            -Method GET `
            -Uri "$Url/web/installations/$InstallationId" `
            -Headers $AuthHeaders `
            -TimeoutSec $ReqTimeoutSec | Out-Null
        return $true
    } catch {
        return $false
    }
}

$totalDeleteOk = 0
$totalDeleteTimeoutButGone = 0
$totalDeleteFailedAndStillPresent = 0
$totalProcessed = 0
$pass = 0

while ($true) {
    $pass += 1
    if ($pass -gt $MaxPasses) {
        throw "Se alcanzó MaxPasses=$MaxPasses. Abortando para evitar bucle infinito."
    }

    $rows = Get-InstallationsPage -Url $normalizedBase -AuthHeaders $headers -PageLimit $Limit -ReqTimeoutSec $TimeoutSec
    $count = @($rows).Count
    Write-Host ""
    Write-Host "Pasada $pass - registros pendientes: $count"

    if ($count -eq 0) {
        break
    }

    foreach ($row in $rows) {
        if ($null -eq $row -or $null -eq $row.id) {
            continue
        }

        $id = [int]$row.id
        $totalProcessed += 1

        if ($DryRun) {
            Write-Host "DRY-RUN -> id=$id"
            continue
        }

        try {
            Invoke-RestMethod `
                -Method DELETE `
                -Uri "$normalizedBase/web/installations/$id" `
                -Headers $headers `
                -TimeoutSec $TimeoutSec | Out-Null
            $totalDeleteOk += 1
            Write-Host "OK delete id=$id"
        } catch {
            $errMsg = $_.Exception.Message
            Write-Host "WARN delete id=$id -> $errMsg" -ForegroundColor Yellow

            $stillExists = Test-InstallationStillExists `
                -Url $normalizedBase `
                -AuthHeaders $headers `
                -InstallationId $id `
                -ReqTimeoutSec ([Math]::Min($TimeoutSec, 10))

            if ($stillExists) {
                $totalDeleteFailedAndStillPresent += 1
                Write-Host "Sigue presente id=$id" -ForegroundColor Red
            } else {
                $totalDeleteTimeoutButGone += 1
                Write-Host "Borrado efectivo id=$id (aunque el DELETE devolvió timeout)" -ForegroundColor Green
            }
        }
    }
}

Write-Host ""
Write-Host "Resumen"
Write-Host "Procesados: $totalProcessed"
Write-Host "DELETE OK: $totalDeleteOk"
Write-Host "Timeout/Error pero borrado: $totalDeleteTimeoutButGone"
Write-Host "Fallidos y presentes: $totalDeleteFailedAndStillPresent"

Write-Host ""
Write-Host "Verificando estado final..."
$remaining = Get-InstallationsPage -Url $normalizedBase -AuthHeaders $headers -PageLimit $Limit -ReqTimeoutSec $TimeoutSec
Write-Host "Registros restantes (limit=$Limit): $(@($remaining).Count)"

$stats = Invoke-RestMethod `
    -Method GET `
    -Uri "$normalizedBase/web/statistics" `
    -Headers $headers `
    -TimeoutSec $TimeoutSec

Write-Host ""
Write-Host "Estadísticas actuales:"
$stats | ConvertTo-Json -Depth 6
