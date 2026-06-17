param(
    [switch]$CleanOnly
)

$ErrorActionPreference = "Stop"

function Get-ProjectRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Assert-InProject {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot
    )

    $root = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $target = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')

    if ($target -ne $root -and -not $target.StartsWith("$root\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean outside project root: $target"
    }
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

if ($CleanOnly) {
    $distPath = Join-Path $projectRoot "dist"
    Assert-InProject -Path $distPath -ProjectRoot $projectRoot

    if (Test-Path $distPath) {
        Write-Host "Removing build output: $distPath"
        Remove-Item -LiteralPath $distPath -Recurse -Force
    }
    else {
        Write-Host "No dist directory to clean."
    }

    exit 0
}

$node = Get-ToolPath "node.exe"
$npm = Get-ToolPath "npm.cmd"

Write-Host "Running npm run check from $projectRoot ..."
& $npm run check
exit $LASTEXITCODE
