import { useToast } from "../stores/toast";

export function Toasts() {
  const items = useToast((s) => s.items);
  const remove = useToast((s) => s.remove);
  if (items.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => remove(t.id)}>
          <span className="toast-dot" />
          <span className="toast-text">{t.text}</span>
        </div>
      ))}
    </div>
  );
}
