import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, RefreshCw, Plug } from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

interface IntegrationItem {
  id: string;
  name: string;
  category: string;
  connected: boolean;
  status: string;
  details: string;
}

export const SuperAdminIntegrationsView: React.FC = () => {
  const { addToast } = useApp();
  const [items, setItems] = useState<IntegrationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadIntegrations = async () => {
    setLoading(true);
    try {
      const data = await api.getPlatformIntegrations();
      setItems(data);
    } catch (err: any) {
      addToast('Load Failed', err.message || 'Could not load integration status.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIntegrations();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Platform Integrations
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Live status of core infrastructure and external eSign / identity gateways
          </p>
        </div>
        <button
          type="button"
          onClick={loadIntegrations}
          disabled={loading}
          className="px-3.5 py-2 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          <span>Refresh Status</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card flex flex-col justify-between gap-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                  <Plug size={15} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {item.name}
                  </h3>
                  <p className="text-[11px] text-slate-400">{item.category}</p>
                </div>
              </div>
              {item.connected ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                  <CheckCircle2 size={11} />
                  {item.status}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                  <AlertCircle size={11} />
                  {item.status}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {item.details}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
