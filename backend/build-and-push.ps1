# Local-only: build and push CueSport stream backend to Docker Hub as :latest
# Requires: Docker logged in (docker login) with push access to the image repo.

$ErrorActionPreference = "Stop"

$ImageName = "iainsmacleod/cuesport-stream-backend"
$Tag = "latest"
$FullImage = "${ImageName}:${Tag}"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "Building $FullImage ..." -ForegroundColor Cyan
docker build -t $FullImage .

if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker build failed."
    exit $LASTEXITCODE
}

Write-Host "Pushing $FullImage ..." -ForegroundColor Cyan
docker push $FullImage

if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker push failed. Are you logged in? (docker login)"
    exit $LASTEXITCODE
}

Write-Host "Done. Pushed $FullImage" -ForegroundColor Green
