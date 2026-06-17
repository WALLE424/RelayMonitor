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

$projectRoot = Get-ProjectRoot
Set-Location $projectRoot

$node = Get-ToolPath "node.exe"
$npm = Get-ToolPath "npm.cmd"

if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
    Write-Host "node_modules was not found. Run 'npm install' in $projectRoot first."
    exit 1
}

Write-Host "Starting Relay Monitor from $projectRoot ..."
& $npm start
exit $LASTEXITCODE
