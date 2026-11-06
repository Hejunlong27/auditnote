import { useEffect, useState } from "react";
import { useSettings, DEFAULT_SETTINGS } from "../stores/settings";
import { useUi } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";
import { api } from "../services/api";
import type { AppInfo, ThemeMode, ViewMode } from "../types";
import { toast } from "../stores/toast";

const FONT_PRESETS = [
  { label: "微软雅黑（推荐）", value: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { label: "宋体 / SimSun", value: '"SimSun", "Songti SC", serif' },
  { label: "思源黑体", value: '"Source Han Sans SC", "Noto Sans SC", sans-serif' },
  { label: "楷体 / KaiTi", value: '"KaiTi", "Kaiti SC", serif' },
  { label: "等距字体（Consolas）", value: 'Consolas, "Courier New", monospace' },
];

const THEMES: { key: ThemeMode; label: string }[] = [
  { key: "light", label: "浅色" },
  { key: "dark", label: "深色" },
  { key: "sepia", label: "护眼" },
];

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: "source", label: "源码" },
  { key: "split", label: "分栏" },
  { key: "preview", label: "预览" },
];

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const setOpen = useUi((s) => s.setSettingsOpen);
  const settings = useSettings();
  const update = useSettings((s) => s.update);
  const reset = useSettings((s) => s.reset);
  const root = useWorkspace((s) => s.root);
  const rebuildIndex = useWorkspace((s) => s.rebuildIndex);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (open) {
      api.appInfo().then(setInfo).catch(() => undefined);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal modal-md" role="dialog" aria-modal="true">
        <div className="modal-title">设置</div>
        <div className="modal-body settings-body">
          <section className="settings-section">
            <h4>外观</h4>
            <div className="field field-inline">
              <span className="field-label">主题</span>
              <div className="segmented">
                {THEMES.map((t) => (
                  <button
                    key={t.key}
                    className={settings.theme === t.key ? "active" : ""}
                    onClick={() => update({ theme: t.key })}
                    type="button"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field field-inline">
              <span className="field-label">字体</span>
              <select
                className="select"
                value={settings.fontFamily}
                onChange={(e) => update({ fontFamily: e.target.value })}
              >
                {FONT_PRESETS.map((p) => (
                  <option key={p.label} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field field-inline">
              <span className="field-label">字号</span>
              <input
                type="range"
                min={12}
                max={22}
                step={1}
                value={settings.fontSize}
                onChange={(e) => update({ fontSize: Number(e.target.value) })}
              />
              <span className="field-value">{settings.fontSize}px</span>
            </div>
            <div className="field field-inline">
              <span className="field-label">行高</span>
              <input
                type="range"
                min={1.4}
                max={2.4}
                step={0.05}
                value={settings.lineHeight}
                onChange={(e) => update({ lineHeight: Number(e.target.value) })}
              />
              <span className="field-value">{settings.lineHeight.toFixed(2)}</span>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.showLineNumbers}
                onChange={(e) => update({ showLineNumbers: e.target.checked })}
              />
              显示行号
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.previewSyncScroll}
                onChange={(e) => update({ previewSyncScroll: e.target.checked })}
              />
              分栏模式下预览跟随滚动
            </label>
          </section>

          <section className="settings-section">
            <h4>打开与保存</h4>
            <div className="field field-inline">
              <span className="field-label">默认视图</span>
              <select
                className="select"
                value={settings.defaultView}
                onChange={(e) => update({ defaultView: e.target.value as ViewMode })}
              >
                {VIEWS.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field field-inline">
              <span className="field-label">自动保存</span>
              <input
                className="input input-sm"
                type="number"
                min={0}
                max={600}
                value={settings.autoSaveInterval}
                onChange={(e) =>
                  update({ autoSaveInterval: Math.max(0, Number(e.target.value) || 0) })
                }
              />
              <span className="field-value">秒（0 = 关闭）</span>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.autoSaveToFile}
                onChange={(e) => update({ autoSaveToFile: e.target.checked })}
              />
              自动保存时直接写入文件（关闭则只保存草稿，需手动 Ctrl+S）
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.confirmOnClose}
                onChange={(e) => update({ confirmOnClose: e.target.checked })}
              />
              关闭文档时，若有未保存改动则先确认
            </label>
          </section>

          <section className="settings-section">
            <h4>数据与索引</h4>
            <div className="kv-row">
              <span>数据目录</span>
              <code title={info?.dataDir}>{info?.dataDir ?? "读取中…"}</code>
            </div>
            <div className="kv-row">
              <span>索引</span>
              <span>{info?.ftsEnabled ? "全文索引已启用" : "全文索引降级为模糊匹配"}</span>
            </div>
            <div className="kv-row">
              <span>版本</span>
              <span>AuditNote {info?.version ?? "0.1.0"}（完全离线）</span>
            </div>
            <div className="settings-actions">
              <button className="btn btn-sm" disabled={!root} onClick={() => void rebuildIndex()} type="button">
                重建当前文件夹索引
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  reset();
                  toast.info("已恢复默认设置");
                }}
                type="button"
              >
                恢复默认设置
              </button>
            </div>
            <p className="hint-text">
              正文就是普通的 Markdown 文件，保存在你自己的文件夹里。索引、草稿与最近打开记录存放在上面的数据目录，
              删除数据库不影响正文（索引会自动重建）。
            </p>
          </section>
        </div>
        <div className="modal-footer">
          <span className="hint-text">
            默认：{DEFAULT_SETTINGS.fontSize}px / 自动保存 {DEFAULT_SETTINGS.autoSaveInterval}s
          </span>
          <span className="modal-footer-spacer" />
          <button className="btn btn-primary" onClick={() => setOpen(false)} type="button">
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
