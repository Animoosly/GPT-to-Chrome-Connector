# Builds dist\ChatGPTChromeConnector-Setup-<version>.exe natively on Windows.
# Needs: Node.js (the SEA blob must match the downloaded node.exe exactly, so the host version is used),
#        Inno Setup 6 (ISCC.exe), and internet access for the first run (node.exe, cloudflared, rcedit).
# Optional: signtool.exe (Windows SDK) to strip node.exe's signature before injection.
# Usage (from the repo root or anywhere):  powershell -ExecutionPolicy Bypass -File build\build-windows.ps1
$ErrorActionPreference = 'Stop'
$Build = $PSScriptRoot
$Root = Split-Path $Build -Parent
$Server = Join-Path $Root 'server'
$Exe = 'ChatGPTChromeConnector.exe'
Set-Location $Build

$NodeVersion = (& node -p 'process.versions.node').Trim()
$Version = (& node -p "require(process.argv[1]).version" (Join-Path $Server 'package.json')).Trim()
Write-Host "==> ChatGPT Chrome Connector $Version (node $NodeVersion)"
New-Item -ItemType Directory -Force vendor, out, (Join-Path $Root 'dist') | Out-Null

function Get-Vendor([string]$File, [string]$Url) {
  $p = Join-Path $Build "vendor\$File"
  if (-not (Test-Path $p)) {
    Write-Host "    downloading $File"
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile "$p.part"
    Move-Item "$p.part" $p -Force
  }
  return $p
}
Write-Host '==> Fetching Windows binaries'
$NodeExe = Get-Vendor "node-$NodeVersion.exe" "https://nodejs.org/dist/v$NodeVersion/win-x64/node.exe"
$Cloudflared = Get-Vendor 'cloudflared.exe' 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
$Rcedit = Get-Vendor 'rcedit.exe' 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe'

Write-Host '==> Bundling server'
Push-Location $Server
if (-not (Test-Path 'node_modules\esbuild')) { & npm install --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm install failed' } }
& npx --no-install esbuild index.js --bundle --platform=node --target=node22 --format=cjs `
  --define:PACKAGED=true --external:bufferutil --external:utf-8-validate `
  --log-level=warning --log-override:empty-import-meta=silent "--outfile=$Build\out\bundle.cjs"
if ($LASTEXITCODE) { throw 'esbuild failed' }
Pop-Location

Write-Host '==> Creating single-executable blob'
Set-Content -Encoding ascii out\sea-config.json '{ "main": "out/bundle.cjs", "output": "out/sea-prep.blob", "disableExperimentalSEAWarning": true, "useCodeCache": false, "useSnapshot": false }'
& node --experimental-sea-config out\sea-config.json
if ($LASTEXITCODE) { throw 'SEA blob generation failed' }

Write-Host "==> Building $Exe"
$Out = Join-Path $Build "out\$Exe"
Copy-Item $NodeExe $Out -Force
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue | Sort-Object FullName | Select-Object -Last 1
if ($signtool) { & $signtool.FullName remove /s $Out | Out-Null } else { Write-Host '    (signtool not found; leaving the original signature, which injection invalidates)' }
& $Rcedit $Out --set-icon assets\icon.ico `
  --set-version-string ProductName 'ChatGPT Chrome Connector' `
  --set-version-string FileDescription 'ChatGPT Chrome Connector' `
  --set-version-string CompanyName '""' --set-version-string LegalCopyright '""' `
  --set-version-string OriginalFilename $Exe --set-version-string InternalName 'ChatGPTChromeConnector' `
  --set-file-version $Version --set-product-version $Version
if ($LASTEXITCODE) { throw 'rcedit failed' }
& npx --prefix $Server --no-install postject $Out NODE_SEA_BLOB out\sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 | Out-Null
if ($LASTEXITCODE) { throw 'postject failed' }

# Switch the PE subsystem from console (3) to GUI (2) so no black console window appears.
& node (Join-Path $Build 'patch-subsystem.cjs') $Out
if ($LASTEXITCODE) { throw 'PE patch failed' }

Write-Host '==> Building installer'
$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 (ISCC.exe) not found. Install it from jrsoftware.org.' }
& $iscc /Q "/DVersion=$Version" installer.iss
if ($LASTEXITCODE) { throw 'ISCC failed' }
Get-Item (Join-Path $Root "dist\ChatGPTChromeConnector-Setup-$Version.exe") | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}
