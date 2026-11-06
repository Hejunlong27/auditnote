# 本地打包 AuditNote（Windows / MSVC）
#
# 做三件事：找 MSVC 与 Windows SDK、配好环境变量、调用 tauri build。
# 不调用 vcvars64.bat —— 它会去跑 reg.exe，部分受管机器把 reg.exe 拉黑了。
#
# 用法（在项目根目录）：
#   npm run build:app            只出 exe，最快，双击 src-tauri\target\release\auditnote.exe 即可运行
#   npm run build:app -- -Bundle nsis   额外打 NSIS 安装包（含文件关联）
#   npm run build:app -- -Bundle msi    额外打 MSI 安装包
param(
  [ValidateSet("", "nsis", "msi")]
  [string]$Bundle = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Find-Newest($parent, $filter) {
  if (-not (Test-Path $parent)) { return $null }
  Get-ChildItem -Path $parent -Directory -Filter $filter -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Select-Object -First 1 -ExpandProperty Name
}

# ---- MSVC 工具集 ----
$vcRoots = @(
  "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC",
  "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC",
  "C:\Program Files\Microsoft Visual Studio\2022\Community\VC",
  "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC"
) | Where-Object { Test-Path $_ }

if (-not $vcRoots) {
  throw "没有找到 Visual Studio 2022 生成工具。请安装「Visual Studio 生成工具」并勾选 C++ 生成工具工作负载。"
}
$vcRoot = $vcRoots[0]
$msvcVer = Find-Newest "$vcRoot\Tools\MSVC" "*"
if (-not $msvcVer) { throw "在 $vcRoot\Tools\MSVC 下没有找到 MSVC 工具集。" }

# ---- Windows SDK ----
$sdkInc = "C:\Program Files (x86)\Windows Kits\10\Include"
$sdkVer = Find-Newest $sdkInc "*"
if (-not $sdkVer) { throw "没有找到 Windows SDK（$sdkInc 为空）。" }

$msvcBin = "$vcRoot\Tools\MSVC\$msvcVer\bin\Hostx64\x64"
$sdkBin = "C:\Program Files (x86)\Windows Kits\10\bin\$sdkVer\x64"
$sdkLib = "C:\Program Files (x86)\Windows Kits\10\Lib\$sdkVer"

$env:PATH = "$env:USERPROFILE\.cargo\bin;$msvcBin;$sdkBin;$env:PATH"
$env:INCLUDE = "$vcRoot\Tools\MSVC\$msvcVer\include;$sdkInc\$sdkVer\ucrt;$sdkInc\$sdkVer\um;$sdkInc\$sdkVer\shared"
$env:LIB = "$vcRoot\Tools\MSVC\$msvcVer\lib\x64;$sdkLib\ucrt\x64;$sdkLib\um\x64"

# 交付配置仍是 Cargo.toml 里的 release profile，这里只把 LTO 放宽到 thin 并放开并行代码生成：
# 首次构建从十几分钟降到几分钟，运行性能没有可测差异。
$env:CARGO_PROFILE_RELEASE_LTO = "thin"
$env:CARGO_PROFILE_RELEASE_CODEGEN_UNITS = "4"

Write-Host "[env] MSVC $msvcVer | Windows SDK $sdkVer"

# ---- 构建 ----
Set-Location $root
$cliArgs = @("tauri", "build")
if ($Bundle) { $cliArgs += @("--bundles", $Bundle) } else { $cliArgs += "--no-bundle" }

Write-Host "[build] npx $($cliArgs -join ' ')"
& npx @cliArgs
if ($LASTEXITCODE -ne 0) { throw "构建失败（exit $LASTEXITCODE），请查看上面的输出。" }

Write-Host ""
Write-Host "[done] 可执行文件： src-tauri\target\release\auditnote.exe"
if ($Bundle) { Write-Host "[done] 安装包目录： src-tauri\target\release\bundle" }
