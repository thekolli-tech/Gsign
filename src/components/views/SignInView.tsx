import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import gsignLogo from '../../assets/gsign_logo.png';

export const SignInView: React.FC = () => {
  const { branding, setActiveView, setCurrentRole, addToast } = useApp();

  const [email, setEmail] = useState('hr@gsign.in');
  const [password, setPassword] = useState('••••••••');
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState('');

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaStep) {
      setMfaStep(true);
      addToast('MFA Prompt', 'Enter Authenticator code to continue', 'info');
    } else {
      setActiveView('dashboard');
      setCurrentRole('company_admin');
      addToast('Signed In', 'Welcome back, Priya N (HR Admin)', 'success');
    }
  };

  const handleQuickSuperAdmin = () => {
    setCurrentRole('super_admin');
    setActiveView('superadmin_tenants');
    addToast('Super Admin Session', 'Authenticated as Sunil G (Founder & CEO)', 'success');
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="w-full max-w-sm p-7 sm:p-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-modal space-y-6">
        <div className="space-y-2">
          <div className="flex items-center">
            <img 
              src={branding.logoUrl || gsignLogo} 
              alt="GSign" 
              className="h-8 w-auto max-w-[160px] object-contain" 
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Sign in to manage your agreements
          </p>
        </div>

        <form onSubmit={handleSignIn} className="space-y-4 text-xs">
          {!mfaStep ? (
            <>
              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Work email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600 transition-colors"
                />
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600 transition-colors"
                />
              </div>
            </>
          ) : (
            <div className="space-y-2.5">
              <label className="font-medium text-slate-700 dark:text-slate-300 block">
                Enter 6-digit MFA Code
              </label>
              <input
                type="text"
                autoFocus
                maxLength={6}
                placeholder="6-digit code (e.g. 892011)"
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value)}
                className="w-full px-3 py-2 text-center text-base font-mono font-bold tracking-widest bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
              />
              <button
                type="button"
                onClick={() => setMfaCode('892011')}
                className="text-[11px] text-brand-600 dark:text-brand-400 hover:underline"
              >
                Auto-fill sample code 892011
              </button>
            </div>
          )}

          {/* Sign in Button matching screenshot pages 4 & 18 */}
          <button
            type="submit"
            className="w-full py-2.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
          >
            {mfaStep ? 'Verify MFA & Enter' : 'Sign in'}
          </button>

          {/* Subtitle note matching screenshot pages 4 & 18 */}
          <div className="text-center text-[11px] text-slate-400">
            Admins are asked for an MFA code next.
          </div>
        </form>

        {/* Quick Demo Switchers */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider text-center font-semibold">
            Demo Context
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setActiveView('dashboard');
                setCurrentRole('company_admin');
              }}
              className="flex-1 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              Company Admin
            </button>
            <button
              onClick={handleQuickSuperAdmin}
              className="flex-1 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              Super Admin
            </button>
          </div>
        </div>

        {/* Powered by Genemax Sign */}
        <div className="text-center pt-1">
          <span className="text-[10px] text-slate-400">
            Powered by Genemax Sign
          </span>
        </div>
      </div>
    </div>
  );
};
