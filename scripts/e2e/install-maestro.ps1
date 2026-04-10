$ErrorActionPreference = "Stop"

function Write-Info($message) {
  Write-Host "[install-maestro] $message"
}

try {
  $existing = Get-Command maestro -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Info "Maestro ya esta disponible en PATH."
    & maestro --version
    exit 0
  }

  $bash = Get-Command bash -ErrorAction SilentlyContinue
  if (-not $bash) {
    throw "No se encontro 'bash' en PATH. Instala Git Bash o usa la instalacion manual desde https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli"
  }

  Write-Info "Instalando Maestro CLI con el script oficial..."
  & bash -lc 'curl -fsSL "https://get.maestro.mobile.dev" | bash'

  $maestroBin = Join-Path $HOME ".maestro\bin"
  if (Test-Path (Join-Path $maestroBin "maestro.exe")) {
    $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($null -eq $currentUserPath) {
      $currentUserPath = ""
    }
    if (-not ($currentUserPath -split ";" | Where-Object { $_ -eq $maestroBin })) {
      [Environment]::SetEnvironmentVariable(
        "Path",
        ($currentUserPath.TrimEnd(";") + ";" + $maestroBin).TrimStart(";"),
        "User"
      )
      Write-Info "Se agrego $maestroBin al PATH de usuario."
    }

    $env:Path += ";$maestroBin"
  }

  $installed = Get-Command maestro -ErrorAction SilentlyContinue
  if (-not $installed) {
    throw "La instalacion termino pero 'maestro' todavia no esta disponible. Reinicia la terminal e intenta de nuevo."
  }

  Write-Info "Maestro instalado correctamente."
  & maestro --version
}
catch {
  Write-Error $_
  exit 1
}
