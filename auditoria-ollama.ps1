param(
    [string]$Model = "llama3",
    [string]$OutputFile = "$PSScriptRoot\reporte_sistema.txt",
    [string]$PromptFile = "$PSScriptRoot\prompt_auditoria.txt"
)

$ErrorActionPreference = "SilentlyContinue"

function Section($title) {
    return "`n==================== $title ====================`n"
}

# Prompt base para la IA
$prompt = @"
Actúa como un ingeniero DevOps senior trabajando en una terminal local de Windows.

Tu tarea es analizar el estado actual del sistema y de las aplicaciones en ejecución usando EXCLUSIVAMENTE la información proporcionada.

Objetivos:
- Identificar procesos importantes y aplicaciones activas
- Detectar servicios web, APIs, bases de datos y herramientas de desarrollo
- Revisar puertos abiertos y relacionarlos con procesos
- Evaluar uso de CPU, memoria y disco
- Detectar problemas, cuellos de botella o configuraciones sospechosas
- Dar recomendaciones claras y accionables

Reglas:
- No inventes datos
- Si falta información, dilo explícitamente
- Prioriza hallazgos prácticos
- Responde en español

Formato de salida:
1. Resumen general
2. Aplicaciones y servicios detectados
3. Puertos y red
4. Consumo de recursos
5. Problemas detectados
6. Recomendaciones
7. Riesgos o advertencias
"@

$prompt | Set-Content -Path $PromptFile -Encoding UTF8

# Recolección de datos
$report = New-Object System.Text.StringBuilder

[void]$report.AppendLine("REPORTE DE ESTADO DEL SISTEMA")
[void]$report.AppendLine("Fecha: $(Get-Date)")
[void]$report.AppendLine("Equipo: $env:COMPUTERNAME")
[void]$report.AppendLine("Usuario: $env:USERNAME")

# Sistema operativo
[void]$report.AppendLine((Section "SISTEMA OPERATIVO"))
Get-ComputerInfo |
    Select-Object WindowsProductName, WindowsVersion, OsArchitecture, CsName, CsTotalPhysicalMemory |
    Out-String | ForEach-Object { [void]$report.AppendLine($_) }

# Uptime
[void]$report.AppendLine((Section "UPTIME"))
Get-CimInstance Win32_OperatingSystem |
    Select-Object LastBootUpTime |
    Out-String | ForEach-Object { [void]$report.AppendLine($_) }

# CPU
[void]$report.AppendLine((Section "CPU"))
Get-CimInstance Win32_Processor |
    Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, LoadPercentage |
    Out-String | ForEach-Object { [void]$report.AppendLine($_) }

# Memoria
[void]$report.AppendLine((Section "MEMORIA"))
Get-CimInstance Win32_OperatingSystem |
    Select-Object @{
        Name="TotalRAM_GB";Expression={[math]::Round($_.TotalVisibleMemorySize / 1MB, 2)}
    }, @{
        Name="FreeRAM_GB";Expression={[math]::Round($_.FreePhysicalMemory / 1MB, 2)}
    } |
    Out-String | ForEach-Object { [void]$report.AppendLine($_) }

# Discos
[void]$report.AppendLine((Section "DISCOS"))
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
    Select-Object DeviceID,
        @{Name="Size_GB";Expression={[math]::Round($_.Size / 1GB, 2)}},
        @{Name="Free_GB";Expression={[math]::Round($_.FreeSpace / 1GB, 2)}} |
    Out-String | ForEach-Object { [void]$report.AppendLine($_) }

# Procesos con más CPU
[void]$report.AppendLine((Section "TOP PROCESOS POR CPU"))
Get-Process |
    Sort-Object CPU -Descending |
    Select-Object -First 15 Name, Id, CPU, WS, PM, Path |
    Out-String | ForEach-Object { [void]$report.AppendLine($_) }

# Procesos con más memoria
[void]$report.AppendLine((Section "TOP PROCESOS POR MEMORIA"))
Get-Process |
    Sort-Object WS -Descending |
    Select-Object -First 15 Name, Id,
        @{Name="RAM_MB";Expression={[math]::Round($_.WS / 1MB, 2)}},
        CPU, Path |
    Out-String | ForEach-Object { [void]$report.AppendLine($_) }

# Servicios corriendo
[void]$report.AppendLine((Section "SERVICIOS ACTIVOS"))
Get-Service |
    Where-Object { $_.Status -eq "Running" } |
    Sort-Object DisplayName |
    Select-Object -First 80 Name, DisplayName, Status |
    Out-String | ForEach-Object { [void]$report.AppendLine($_) }

# Puertos abiertos
[void]$report.AppendLine((Section "PUERTOS TCP ESCUCHANDO"))
Get-NetTCPConnection -State Listen |
    Sort-Object LocalPort |
    Select-Object LocalAddress, LocalPort, OwningProcess |
    Out-String | ForEach-Object { [void]$report.AppendLine($_) }

# Relación puerto -> proceso
[void]$report.AppendLine((Section "RELACION PUERTO A PROCESO"))
$tcp = Get-NetTCPConnection -State Listen | Sort-Object LocalPort
$portMap = foreach ($c in $tcp) {
    $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    [PSCustomObject]@{
        LocalAddress = $c.LocalAddress
        LocalPort    = $c.LocalPort
        PID          = $c.OwningProcess
        ProcessName  = if ($p) { $p.ProcessName } else { "Desconocido" }
        Path         = if ($p) { $p.Path } else { "" }
    }
}
$portMap | Format-Table -AutoSize | Out-String | ForEach-Object { [void]$report.AppendLine($_) }

# Conexiones establecidas
[void]$report.AppendLine((Section "CONEXIONES TCP ESTABLECIDAS"))
Get-NetTCPConnection -State Established |
    Select-Object -First 60 LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess |
    Out-String | ForEach-Object { [void]$report.AppendLine($_) }

# Apps comunes de desarrollo
[void]$report.AppendLine((Section "POSIBLES HERRAMIENTAS DE DESARROLLO DETECTADAS"))
$devNames = "node","php","python","pythonw","java","docker","mysqld","postgres","nginx","httpd","apache","code","git","ollama"
Get-Process |
    Where-Object { $devNames -contains $_.ProcessName.ToLower() } |
    Select-Object Name, Id, Path |
    Out-String | ForEach-Object { [void]$report.AppendLine($_) }

# Variables PATH interesantes
[void]$report.AppendLine((Section "RUTAS DE ENTORNO"))
$env:Path -split ";" | Out-String | ForEach-Object { [void]$report.AppendLine($_) }

# Guardar reporte
$report.ToString() | Set-Content -Path $OutputFile -Encoding UTF8

Write-Host "Reporte guardado en: $OutputFile"
Write-Host "Prompt guardado en:  $PromptFile"

# Construir entrada final para Ollama
$fullInput = @"
$prompt

A continuación tienes los datos del sistema:

$($report.ToString())
"@

Write-Host "`nEjecutando análisis con Ollama usando el modelo: $Model`n"

$fullInput | ollama run $Model