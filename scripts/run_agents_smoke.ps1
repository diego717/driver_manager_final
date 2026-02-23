param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [switch]$KeepOldOutputs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    throw "No se encontro 'codex' en PATH."
}

$outputDir = Join-Path $RepoRoot ".codex"
if (-not (Test-Path $outputDir)) {
    New-Item -Path $outputDir -ItemType Directory | Out-Null
}

if (-not $KeepOldOutputs) {
    Get-ChildItem -Path $outputDir -Filter "out_*.txt" -ErrorAction SilentlyContinue | Remove-Item -Force
}

$runs = @(
    @{
        Name = "code-reviewer"
        Prompt = "Usa el agente code-reviewer. Revisa solo .codex/config.toml y reporta 1 mejora concreta en maximo 5 lineas."
        Output = "out_code_reviewer.txt"
    },
    @{
        Name = "desktop-python"
        Prompt = "Usa el agente desktop-python. Revisa solo tests/test_history_manager.py y reporta 1 mejora concreta en maximo 5 lineas."
        Output = "out_desktop_python.txt"
    },
    @{
        Name = "worker-api"
        Prompt = "Usa el agente worker-api. Revisa solo worker.js y reporta 1 riesgo de compatibilidad en maximo 5 lineas."
        Output = "out_worker_api.txt"
    },
    @{
        Name = "mobile-rn"
        Prompt = "Usa el agente mobile-rn. Revisa solo mobile-app/app/(tabs)/index.tsx y reporta 1 mejora de accesibilidad en maximo 5 lineas."
        Output = "out_mobile_rn.txt"
    }
)

foreach ($run in $runs) {
    $outputPath = Join-Path $outputDir $run.Output
    Write-Host ""
    Write-Host "==> Ejecutando $($run.Name) ..."
    codex exec -C $RepoRoot $run.Prompt --output-last-message $outputPath

    if ($LASTEXITCODE -ne 0) {
        throw "La corrida '$($run.Name)' fallo con exit code $LASTEXITCODE."
    }
}

Write-Host ""
Write-Host "Corridas completadas. Resultados:"
Get-ChildItem -Path $outputDir -Filter "out_*.txt" | Select-Object Name, Length
