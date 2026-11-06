import { useState } from "react";
import { useUi } from "../stores/ui";

/** 通用确认对话框：支持"取消 / 第二个动作 / 主操作"三键 */
export function ConfirmDialog() {
  const config = useUi((s) => s.confirm);
  const close = useUi((s) => s.closeConfirm);
  const [busy, setBusy] = useState(false);

  if (!config) return null;

  const run = async (action: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await action();
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal modal-sm" role="alertdialog" aria-modal="true">
        <div className="modal-title">{config.title}</div>
        <div className="modal-body">
          <p className="confirm-message">{config.message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={close} type="button">
            取消
          </button>
          <span className="modal-footer-spacer" />
          {config.secondaryText && config.onSecondary && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => void run(config.onSecondary!)}
              type="button"
            >
              {config.secondaryText}
            </button>
          )}
          <button
            className={`btn ${config.danger ? "btn-danger" : "btn-primary"}`}
            disabled={busy}
            onClick={() => void run(config.onConfirm)}
            type="button"
          >
            {busy ? "处理中…" : (config.confirmText ?? "确定")}
          </button>
        </div>
      </div>
    </div>
  );
}
