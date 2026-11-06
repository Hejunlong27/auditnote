# 打 Microsoft Store 用的 MSIX 包
#
# Tauri CLI 只出 msi / nsis，商店要的是 MSIX，所以用 Windows SDK 的 makeappx 自己封。
# 依赖：Windows 10/11 SDK（makeappx.exe、signtool.exe），以及已构建好的 release exe。
#
# 用法（项目根目录）：
#   npm run msix                     用默认的占位身份打一个本地自测包
#   npm run msix -- -Sign            再加自签名证书（本机可安装验证）
#   npm run msix -- -IdentityName "12345Hejunlong27.AuditNote" -Publisher "CN=1A2B..." -PublisherDisplayName "某某公司"
#                                    ↑ 提交商店前，换成 Partner Center「产品标识」页给的真实值
param(
  [string]$Version = "1.0.0.0",
  [string]$IdentityName = "Hejunlong27.AuditNote",
  [string]$Publisher = "CN=00000000-0000-0000-0000-000000000000",
  [string]$PublisherDisplayName = "Hejunlong27",
  [switch]$Sign,
  [string]$CertPath = "",
  [string]$CertPassword = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "src-tauri\target\release\auditnote.exe"
if (-not (Test-Path $exe)) { throw "找不到 $exe，请先执行 npm run build:app" }

$sdk = "C:\Program Files (x86)\Windows Kits\10\bin"
$makeappx = Get-ChildItem -Path $sdk -Recurse -Filter makeappx.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -like "*\x64\*" } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw "找不到 makeappx.exe，请安装 Windows 10/11 SDK。" }

$out = Join-Path $root "dist-release"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$stage = Join-Path $out ("msix-stage-" + (Get-Date -Format "HHmmss"))
$assets = Join-Path $stage "Assets"
New-Item -ItemType Directory -Force -Path $assets | Out-Null

# 1) 放可执行文件与图标
Copy-Item $exe (Join-Path $stage "AuditNote.exe") -Force
$iconDir = Join-Path $root "src-tauri\icons"
foreach ($name in @("StoreLogo.png", "Square44x44Logo.png", "Square150x150Logo.png")) {
  Copy-Item (Join-Path $iconDir $name) (Join-Path $assets $name) -Force
}

# 2) 生成清单
$template = Get-Content -Raw -Encoding UTF8 (Join-Path $root "src-tauri\msix\AppxManifest.xml")
$manifest = $template.Replace("{{IDENTITY_NAME}}", $IdentityName)
$manifest = $manifest.Replace("{{PUBLISHER}}", $Publisher)
$manifest = $manifest.Replace("{{PUBLISHER_DISPLAY_NAME}}", $PublisherDisplayName)
$manifest = $manifest.Replace("{{VERSION}}", $Version)
$manifestPath = Join-Path $stage "AppxManifest.xml"
[IO.File]::WriteAllText($manifestPath, $manifest, (New-Object Text.UTF8Encoding($false)))

Write-Host "[msix] 身份: $IdentityName"
Write-Host "[msix] 发布者: $Publisher"
Write-Host "[msix] 版本: $Version"

# 3) 打包
$msix = Join-Path $out ("AuditNote-" + ($Version -replace "\.0$", "") + "-x64.msix")
if (Test-Path $msix) { Remove-Item -Force $msix }
& $makeappx.FullName pack /d $stage /p $msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx 打包失败（exit $LASTEXITCODE）" }

# 4) 可选签名（本机安装验证用；提交商店时由微软重签，不需要自己签）
if ($Sign) {
  if (-not $CertPath) {
    $CertPath = Join-Path $out "auditnote-selfsigned.pfx"
    if (-not (Test-Path $CertPath)) {
      Write-Host "[msix] 生成自签名证书（仅本机测试）"
      $cert = New-SelfSignedCertificate -Type Custom -Subject "CN=AuditNote Local Test" `
        -KeyUsage DigitalSignature -FriendlyName "AuditNote MSIX 自测" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
      $pwd = ConvertTo-SecureString -String "auditnote" -Force -AsPlainText
      Export-PfxCertificate -Cert $cert -FilePath $CertPath -Password $pwd | Out-Null
      Write-Host "[msix] 已导出证书: $CertPath（密码 auditnote）"
      Write-Host "[msix] 本机安装前需信任它：Import-Certificate -FilePath <cer> -CertStoreLocation Cert:\LocalMachine\TrustedPeople"
    }
    $CertPassword = "auditnote"
  }
  $signtool = Get-ChildItem -Path $sdk -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*\x64\*" } | Sort-Object FullName -Descending | Select-Object -First 1
  & $signtool.FullName sign /fd SHA256 /a /f $CertPath /p $CertPassword $msix
  if ($LASTEXITCODE -ne 0) { throw "签名失败（exit $LASTEXITCODE）" }
  Write-Host "[msix] 已签名"
}

$size = [math]::Round((Get-Item $msix).Length / 1MB, 1)
Write-Host "[msix] 产物: $msix（$size MB）"
