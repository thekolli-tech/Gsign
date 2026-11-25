import React from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map(toast => {
        let icon = <CheckCircle2 className="text-emerald-500" size={15} />;
        let borderColor = 'border-slate-200 dark:border-slate-800';

        if (toast.type === 'error') {
          icon = <XCircle className="text-rose-500" size={15} />;
        } else if (toast.type === 'warning') {
          icon = <AlertTriangle className="text-amber-500" size={15} />;
        } else if (toast.type === 'info') {
          icon = <Info className="text-brand-500" size={15} />;
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2.5 p-3 rounded-lg bg-white dark:bg-slate-900 border ${borderColor} shadow-card transition-all`}
          >
            <div className="flex-shrink-0 mt-0.5">{icon}</div>
            <div className="flex-1 min-w-0">
              <h5 className="text-xs font-semibold text-slate-900 dark:text-white leading-tight">
                {toast.title}
              </h5>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-normal">
                {toast.message}
              </p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
