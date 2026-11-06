# 一键准备 AuditNote 的 Windows 打包环境
#
# 做什么：
#   1. 检查是否已装 Visual Studio Build Tools（提供 C++ 编译器 cl.exe）
#   2. 检查是否已装 Rust（cargo / rustc）
#   3. 缺什么装什么（会弹一次 UAC 授权，请点是）
#   4. 把 Rust 切到 MSVC 工具链，跑一次 cargo check 验证
#
# 用法（在项目根目录）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-build-env.ps1
#   只想看状态、不安装：  ... -CheckOnly
#
# 装完就可以：
#   npm run tauri:dev      开发调试
#   npm run tauri:build    产出 msi / exe 安装包

param(
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
function Say($msg, $color = "Gray") { Write-Host $msg -ForegroundColor $color }
function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Say "=== AuditNote 打包环境检查 ===" Cyan

# ---------- 1) C++ 编译器 ----------
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsPath = ""
if (Test-Path $vswhere) {
  $vsPath = (& $vswhere -products * -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath) 2>$null
}
$hasMsvc = [bool]$vsPath
if ($hasMsvc) {
  Say "[1/3] C++ 编译器：已就绪  ($vsPath)" Green
} else {
  Say "[1/3] C++ 编译器：未安装（Tauri 在 Windows 上需要它）" Yellow
}

# ---------- 2) Rust ----------
# 有些机器 cargo 已装在 ~/.cargo/bin 但 PATH 没刷新，先补上再探测
if (-not (Have cargo)) {
  $cargoBin = "$env:USERPROFILE\.cargo\bin"
  if (Test-Path "$cargoBin\cargo.exe") { $env:Path = "$cargoBin;$env:Path" }
}
$hasCargo = Have cargo
$cargoVersion = if ($hasCargo) { (cargo --version) } else { "" }
if ($hasCargo) {
  Say "[2/3] Rust：已就绪  ($cargoVersion)" Green
} else {
  Say "[2/3] Rust：未安装" Yellow
}

if ($CheckOnly) {
  Say "`n仅检查模式，未做任何安装。" Cyan
  if (-not $hasCargo -or -not $hasMsvc) { exit 1 } else { exit 0 }
}

# ---------- 3) 安装缺失项 ----------
if (-not (Have winget)) {
  Say "找不到 winget（应用安装程序）。请手动安装：" Red
  Say "  - Visual Studio Build Tools 2022（勾选「使用 C++ 的桌面开发」）" Red
  Say "  - Rust：https://rustup.rs" Red
  exit 1
}

if (-not $hasMsvc) {
  Say "`n正在安装 Visual Studio 2022 Build Tools（约 2-4 GB，会弹 UAC，请点「是」）..." Cyan
  winget install --id Microsoft.VisualStudio.2022.BuildTools -e `
    --accept-package-agreements --accept-source-agreements `
    --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  if ($LASTEXITCODE -ne 0) {
    Say "安装未成功（退出码 $LASTEXITCODE）。可改用图形界面安装：https://visualstudio.microsoft.com/downloads/ → Build Tools" Red
    exit 1
  }
}

if (-not (Have cargo)) {
  Say "`n正在安装 Rust（rustup，装到当前用户目录，无需管理员）..." Cyan
  winget install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements
  $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
}

# ---------- 4) 切到 MSVC 工具链并冒烟编译 ----------
Say "`n配置 Rust 的 MSVC 目标..." Cyan
rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal
rustup default stable-x86_64-pc-windows-msvc

if (-not (Test-Path "package.json")) {
  Say "请在项目根目录运行本脚本（当前目录没有 package.json）。" Red
  exit 1
}

Say "`n首次编译会下载依赖并编译 SQLite，大约需要 5-15 分钟，请耐心等待..." Cyan
Push-Location "src-tauri"
try {
  cargo check
  $ok = ($LASTEXITCODE -eq 0)
} finally {
  Pop-Location
}

if ($ok) {
  Say "`n环境已就绪。接下来可以执行：" Green
  Say "  npm run tauri:dev      # 开发调试" Green
  Say "  npm run tauri:build    # 产出安装包（bundle/nsis 与 bundle/msi）" Green
} else {
  Say "`ncargo check 失败，请把上面的报错发给我。" Red
  exit 1
}
