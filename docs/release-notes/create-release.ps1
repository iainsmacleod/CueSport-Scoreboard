# Create a draft GitHub release for the given version (requires GitHub CLI: gh auth login)
param(
    [Parameter(Mandatory = $true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$NotesDir = Join-Path $PSScriptRoot $Version
$DraftFile = Join-Path $NotesDir "GITHUB_RELEASE_DRAFT.md"
$ImagesDir = Join-Path $NotesDir "images"
$Tag = if ($Version -match '^v') { $Version } else { "v$Version" }

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error "GitHub CLI (gh) is not installed. See https://cli.github.com/"
}

if (-not (Test-Path $DraftFile)) {
    Write-Error "Missing $DraftFile"
}

Push-Location $Root
try {
    Write-Host "Capturing screenshots..."
    Push-Location $PSScriptRoot
    if (-not (Test-Path "node_modules")) { npm install --silent }
    node capture-screenshots.mjs --version $Version
    Pop-Location

    Write-Host "Creating draft release $Tag..."
    gh release create $Tag `
        --draft `
        --title "CueSport Scoreboard $Version" `
        --notes-file $DraftFile

    if (Test-Path $ImagesDir) {
        $images = Get-ChildItem $ImagesDir -Filter "*.png"
        if ($images.Count -gt 0) {
            Write-Host "Uploading $($images.Count) screenshot(s)..."
            gh release upload $Tag $images.FullName
        }
    }

    Write-Host "Draft release created: $Tag"
    gh release view $Tag --web
}
finally {
    Pop-Location
}
