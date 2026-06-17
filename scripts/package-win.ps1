param()

$ErrorActionPreference = "Stop"

function Get-ProjectRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Get-ToolPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Missing required command: $Name. Please install Node.js 18.17 or newer."
    }

    return $command.Source
}

function Set-DefaultEnv {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    if (-not [Environment]::GetEnvironmentVariable($Name, "Process")) {
        [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
    }
}

$projectRoot = Get-ProjectRoot
Set-Location $projectRoot

$node = Get-ToolPath "node.exe"
$npm = Get-ToolPath "npm.cmd"
$npx = Get-ToolPath "npx.cmd"

Set-DefaultEnv -Name "ELECTRON_MIRROR" -Value "https://npmmirror.com/mirrors/electron/"
Set-DefaultEnv -Name "ELECTRON_BUILDER_BINARIES_MIRROR" -Value "https://npmmirror.com/mirrors/electron-builder-binaries/"

Write-Host "Running npm run check from $projectRoot ..."
& $npm run check
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Running npm test ..."
& $npm test
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Ensuring Electron runtime is available ..."
& $npx install-electron --no
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Running Electron smoke check ..."
& $npm run smoke
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Building Windows package ..."
& $npm run dist:win
exit $LASTEXITCODE
