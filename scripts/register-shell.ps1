# 注册 / 注销 AuditNote 的文件关联（当前用户，无需管理员）
#
# 安装包（NSIS）会自动完成这些事；本脚本用于：
#   1) MSI 安装或绿色版，需要手动建立关联时；
#   2) 开发时想让"双击 .md 用 AuditNote 打开"生效；
#   3) 排查关联问题时先注销再重新注册。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\register-shell.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\register-shell.ps1 -Exe "D:\path\AuditNote.exe"
#   powershell -ExecutionPolicy Bypass -File scripts\register-shell.ps1 -Unregister

param(
  [string]$Exe = "",
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$ProgId = "AuditNote.md"

function Get-DefaultExe {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\AuditNote\AuditNote.exe"),
    (Join-Path ${env:ProgramFiles} "AuditNote\AuditNote.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "AuditNote\AuditNote.exe"),
    (Join-Path $PSScriptRoot "..\src-tauri\target\release\AuditNote.exe"),
    (Join-Path $PSScriptRoot "..\src-tauri\target\debug\AuditNote.exe")
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return (Resolve-Path $c).Path }
  }
  return ""
}

function Remove-KeyIfExists([string]$Path) {
  if (Test-Path $Path) { Remove-Item -Path $Path -Recurse -Force }
}

if ($Unregister) {
  Remove-KeyIfExists "HKCU:\Software\Classes\$ProgId"
  Remove-KeyIfExists "HKCU:\Software\Classes\.md\ShellNew"
  Remove-KeyIfExists "HKCU:\Software\Classes\.markdown\ShellNew"
  # 只有当 .md 指向本应用时才清空默认值，避免误伤其它编辑器
  $current = (Get-ItemProperty -Path "HKCU:\Software\Classes\.md" -Name "(default)" -ErrorAction SilentlyContinue)."(default)"
  if ($current -eq $ProgId) {
    Set-ItemProperty -Path "HKCU:\Software\Classes\.md" -Name "(default)" -Value ""
  }
  Write-Host "已注销 AuditNote 文件关联。" -ForegroundColor Yellow
  exit 0
}

if (-not $Exe) { $Exe = Get-DefaultExe }
if (-not $Exe -or -not (Test-Path $Exe)) {
  Write-Error "找不到 AuditNote.exe。请用 -Exe 指定完整路径。"
}
$Exe = (Resolve-Path $Exe).Path

# 1) ProgId：打开命令与图标
New-Item -Path "HKCU:\Software\Classes\$ProgId\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\$ProgId" -Name "(default)" -Value "Markdown 文档"
New-Item -Path "HKCU:\Software\Classes\$ProgId\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\$ProgId\DefaultIcon" -Name "(default)" -Value "$Exe,0"
Set-ItemProperty -Path "HKCU:\Software\Classes\$ProgId\shell\open\command" -Name "(default)" -Value "`"$Exe`" `"%1`""

# 2) 扩展名指向 ProgId
foreach ($ext in @(".md", ".markdown")) {
  New-Item -Path "HKCU:\Software\Classes\$ext" -Force | Out-Null
  Set-ItemProperty -Path "HKCU:\Software\Classes\$ext" -Name "(default)" -Value $ProgId
  New-Item -Path "HKCU:\Software\Classes\$ext\OpenWithProgids" -Force | Out-Null
  Set-ItemProperty -Path "HKCU:\Software\Classes\$ext\OpenWithProgids" -Name $ProgId -Value ([byte[]]@()) -Type Binary
  # 3) 右键「新建」菜单
  New-Item -Path "HKCU:\Software\Classes\$ext\ShellNew" -Force | Out-Null
  Set-ItemProperty -Path "HKCU:\Software\Classes\$ext\ShellNew" -Name "NullFile" -Value ""
}

# 4) 通知资源管理器刷新（SHCNE_ASSOCCHANGED）
if (-not ("Shell32.Native" -as [type])) {
  Add-Type -Namespace Shell32 -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("shell32.dll")]
public static extern void SHChangeNotify(int eventId, int flags, System.IntPtr item1, System.IntPtr item2);
'@
}
[Shell32.Native]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

Write-Host "已注册：双击 .md / .markdown 使用 AuditNote 打开，右键「新建」出现 Markdown 文档。" -ForegroundColor Green
Write-Host "可执行文件：$Exe"
