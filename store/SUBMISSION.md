# 提交到 Microsoft Store 的完整步骤

> 目标：把 AuditNote 作为 **MSIX 打包应用**提交到 Microsoft Store。
> Tauri CLI 只出 `msi` / `nsis`，商店只收 MSIX，所以仓库里自带 `scripts/make-msix.ps1`。

---

## 0. 先决条件

| 项 | 说明 |
| --- | --- |
| 开发者账号 | [Partner Center](https://partner.microsoft.com/dashboard) 注册「Windows 应用」开发者，个人账号约 19 美元（一次性） |
| Windows SDK | 需要 `makeappx.exe` / `signtool.exe`（装了 VS 生成工具 + Windows SDK 就有） |
| 构建产物 | 先跑一次 `npm run build:app`，拿到 `src-tauri/target/release/auditnote.exe` |

## 1. 在 Partner Center 建立应用

1. 「新建产品 → 应用」→ 填写应用名 `AuditNote`（若被占用，加后缀如 `AuditNote Markdown`）；
2. 进入「产品管理 → 应用标识」，记下三个值：

```
包/标识名称   → 形如 12345Hejunlong27.AuditNote
发布者         → 形如 CN=1A2B3C4D-5E6F-...
发布者显示名称 → 你的发布者名
```

这三个值必须和 MSIX 清单里的 `Identity Name`、`Publisher`、`PublisherDisplayName` **完全一致**，否则上传会被拒。

## 2. 用真实身份重新打 MSIX

```powershell
npm run msix -- `
  -IdentityName "12345Hejunlong27.AuditNote" `
  -Publisher "CN=1A2B3C4D-5E6F-..." `
  -PublisherDisplayName "Hejunlong27" `
  -Version "1.0.0.0"
```

产物：`dist-release/AuditNote-1.0.0-x64.msix`

> 不上参数时用的是占位身份（`Hejunlong27.AuditNote` / `CN=00000000-...`），只适合本地验证包结构，**不能提交**。

## 3. 本机先自测一遍（强烈建议）

```powershell
npm run msix -- -Sign
```

会生成自签名证书 `dist-release/auditnote-selfsigned.pfx`（密码 `auditnote`）并签名。
在**安装前**需要把证书导入「受信任人」存储（管理员 PowerShell）：

```powershell
# 先导出 .cer
$pwd = ConvertTo-SecureString "auditnote" -Force -AsPlainText
$c = Get-PfxCertificate -FilePath .\dist-release\auditnote-selfsigned.pfx   # 会提示输入密码
Export-Certificate -Cert $c -FilePath .\dist-release\auditnote-selfsigned.cer
# 导入受信任人
Import-Certificate -FilePath .\dist-release\auditnote-selfsigned.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

然后双击 `.msix` 安装，验证：能否启动、文件关联是否出现在「打开方式」里、卸载后是否干净。

## 4. 上传提交

1. Partner Center → 该应用 → 「程序包」→ 上传 `.msix`；
2. 按 `store/listing.md` 逐字段填写：描述、功能列表、类别、系统要求、截图、年龄分级；
3. 「属性」里确认：**不使用管理员权限**、支持 x64、Windows 10 1809 起；
4. 「定价与可用性」选免费、全部市场；
5. 提交认证（通常 1～3 个工作日）。

## 5. 认证可能被打回的地方

| 风险点 | 规避方式 |
| --- | --- |
| 清单身份与 Partner Center 不一致 | 第 2 步务必用真实值重新打包 |
| 应用需要联网才能用 | 本应用完全离线，无此问题；但 Windows 10 首次运行需要 WebView2（商店包会自动带上依赖） |
| 文件关联与清单不符 | 只声明 `.md` / `.markdown` / `.txt`，与实际能力一致 |
| 卸载残留 | MSIX 由系统卸载；本应用的数据目录随包删除，无 HKLM 写入 |
| 崩溃 | 提审前建议按 `docs/` 里的自测清单跑一遍长文档与流程图 |

## 6. 商店版与安装版、免安装版的关系

| 分发渠道 | 文件 | 文件关联 | 自动更新 |
| --- | --- | --- | --- |
| Microsoft Store | `AuditNote-1.0.0-x64.msix` | 清单声明，安装即有 | 由商店托管 |
| 官网 / GitHub 安装版 | `AuditNote_1.0.0_x64-setup.exe`（3.7 MB） | NSIS 写注册表 + 右键新建 | 手动 |
| 免安装版 | `AuditNote-1.0.0-portable-win64.zip`（4 MB） | 无 | 手动 |

同一台机器**不要同时装商店版和安装版**：两者都会注册 `.md` 关联，后装的会覆盖前者。
