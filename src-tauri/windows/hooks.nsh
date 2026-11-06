; AuditNote NSIS 安装钩子
; 作用：让资源管理器右键「新建」菜单里出现「Markdown 文档」，双击 .md 直接用本应用打开。
;
; Tauri 的文件关联（bundle.fileAssociations）只写「打开方式」，不会创建 ShellNew 项，
; 所以这里补一条注册表，并在安装/卸载后通知 Shell 刷新。

!macro NSIS_HOOK_POSTINSTALL
  ; 右键「新建 → Markdown 文档」（当前用户生效，无需管理员）
  WriteRegStr HKCU "Software\Classes\.md\ShellNew" "NullFile" ""
  WriteRegStr HKCU "Software\Classes\.markdown\ShellNew" "NullFile" ""
  ; 让关联与新建菜单立即生效（SHCNE_ASSOCCHANGED）
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\.md\ShellNew"
  DeleteRegKey HKCU "Software\Classes\.markdown\ShellNew"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
