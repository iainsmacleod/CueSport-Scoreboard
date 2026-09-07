# Run all CueSport test suites (API + smoke + cloud relay).
# Usage (repo root or tests/):
#   .\tests\run-all.ps1
#   .\tests\run-all.ps1 --cloud http://localhost:4003
#   .\tests\run-all.ps1 --skip-smoke
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$PassThru
)

$ErrorActionPreference = 'Stop'
$testsDir = $PSScriptRoot
Set-Location $testsDir

if (-not (Test-Path (Join-Path $testsDir 'node_modules\playwright'))) {
  Write-Host 'Installing Playwright (tests/npm install)…'
  npm install
}

node .\run-all.mjs @PassThru
exit $LASTEXITCODE
