import { useEffect, useRef, useState } from "react";
import { useUi } from "../stores/ui";

/** 通用文本输入对话框：新建文件/文件夹、重命名、索引号等复用 */
export function PromptDialog() {
  const config = useUi((s) => s.prompt);
  const close = useUi((s) => s.closePrompt);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(config?.value ?? "");
    setError(null);
    setBusy(false);
    if (config) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [config]);

  if (!config) return null;

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("请输入内容");
      return;
    }
    const invalid = config.validate?.(trimmed);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      await config.onSubmit(trimmed);
      close();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal modal-sm" role="dialog" aria-modal="true">
        <div className="modal-title">{config.title}</div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">{config.label}</span>
            <input
              ref={inputRef}
              className="input"
              value={value}
              placeholder={config.placeholder}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
                if (e.key === "Escape") close();
              }}
            />
          </label>
          {error && <div className="field-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={close} type="button">
            取消
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy} type="button">
            {busy ? "处理中…" : (config.confirmText ?? "确定")}
          </button>
        </div>
      </div>
    </div>
  );
}
