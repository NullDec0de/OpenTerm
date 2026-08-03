import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type Toast = {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title?: string;
  message: string;
};

type ToastContextType = {
  toasts: Toast[];
  showToast: (message: string, type?: Toast["type"], title?: string) => void;
  removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: Toast["type"] = "info", title?: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-4), { id, type, title, message }]);
    setTimeout(() => {
      removeToast(id);
    }, 4500);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <div className="toast-content">
              {toast.title && <strong className="toast-title">{toast.title}</strong>}
              <div className="toast-msg">{toast.message}</div>
            </div>
            <button className="toast-close" type="button" onClick={() => removeToast(toast.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
