# Local-only: build and push CueSport stream backend to Docker Hub as :latest
# Requires: Docker logged in (docker login) with push access to the image repo.

$ErrorActionPreference = "Stop"

$ImageName = "iainsmacleod/cuesport-stream-backend"
$Tag = "latest"
$FullImage = "${ImageName}:${Tag}"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$Dockerfile = Join-Path $ScriptDir "Dockerfile"

Write-Host "Building $FullImage (context: $RepoRoot) ..." -ForegroundColor Cyan
docker build -f $Dockerfile -t $FullImage $RepoRoot

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
