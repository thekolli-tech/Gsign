import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import gsignLogo from '../../assets/gsign_logo.png';

export const SignInView: React.FC = () => {
  const { branding, setActiveView, setCurrentRole, addToast } = useApp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setLoading(true);

    try {
      if (!mfaStep) {
        const res = await api.login(email, password);
        if (res.mfa_required && res.mfa_token) {
          setMfaStep(true);
          setMfaToken(res.mfa_token);
          addToast('MFA Required', 'Enter your 6-digit authenticator code to proceed.', 'info');
        } else if (res.session) {
          routeUserByRole(res.session);
        }
      } else {
        const session = await api.verifyMfa(mfaToken, mfaCode);
        if (session) {
          routeUserByRole(session);
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Authentication failed. Please check your credentials.');
      addToast('Sign In Error', err.message || 'Invalid credentials', 'error');
    } finally {
      setLoading(false);
    }
  };

  const routeUserByRole = (session: any) => {
    if (session.isPlatformOwner || session.role === 'PLATFORM_OWNER') {
      setCurrentRole('platform_owner');
      setActiveView('superadmin_tenants');
      addToast(
        'Platform Owner Session',
        `Welcome, ${session.fullName}. Platform Administration unrestricted access active.`,
        'success'
      );
    } else if (session.isSuperAdmin || session.role === 'Super Admin') {
      setCurrentRole('super_admin');
      setActiveView('superadmin_tenants');
      addToast('Super Admin Session', `Welcome back, ${session.fullName}`, 'success');
    } else if (session.role === 'Company Admin') {
      setCurrentRole('company_admin');
      setActiveView('dashboard');
      addToast('Signed In', `Welcome back, ${session.fullName} (${session.role})`, 'success');
    } else {
      setCurrentRole('company_staff');
      setActiveView('agreements');
      addToast('Signed In', `Welcome, ${session.fullName} (${session.role})`, 'success');
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 transition-colors duration-200">
      {/* Top Header Navigation */}
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between py-3">
        <div className="flex items-center gap-3">
          <img
            src={branding.logoUrl || gsignLogo}
            alt="GSIGN"
            className="h-8 w-auto max-w-[160px] object-contain"
          />
        </div>
        <div className="flex items-center gap-4 text-xs font-medium">
          <button
            onClick={() => setActiveView('pricing')}
            className="text-slate-600 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            Pricing
          </button>
          <button
            onClick={() => setActiveView('contact_sales')}
            className="text-slate-600 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            Contact Sales
          </button>
          <button
            onClick={() => setActiveView('register_company')}
            className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors shadow-subtle"
          >
            Register Company
          </button>
        </div>
      </div>

      {/* Main Login Card */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm p-7 sm:p-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-modal space-y-6">
          <div className="space-y-1.5 text-center">
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              {mfaStep ? 'Two-Factor Authentication' : 'Sign in to GSIGN'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {mfaStep
                ? 'Enter the 6-digit code from your authenticator app'
                : 'Enter your credentials to access your workspace'}
            </p>
          </div>

          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300">
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleSignIn} className="space-y-4 text-xs">
            {!mfaStep ? (
              <>
                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Work Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600 transition-colors"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="font-medium text-slate-700 dark:text-slate-300">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => addToast('Password Reset', 'Please contact platform administration or your company administrator.', 'info')}
                      className="text-[11px] text-brand-600 dark:text-brand-400 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
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
                  Security Code
                </label>
                <input
                  type="text"
                  autoFocus
                  maxLength={6}
                  placeholder="000000"
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value)}
                  className="w-full px-3 py-2 text-center text-lg font-mono font-bold tracking-widest bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-subtle flex items-center justify-center gap-2"
            >
              {loading ? 'Authenticating...' : mfaStep ? 'Verify & Continue' : 'Sign In'}
            </button>
          </form>

          {/* Quick presets for testing convenience */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider text-center font-semibold">
              Quick Test Credentials
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setEmail('genemaxitsolution@gmail.com');
                  setPassword('gsign#2k26');
                }}
                className="py-1.5 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-center truncate"
                title="Platform Owner (Genemax)"
              >
                Platform Owner
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmail('priya@gsign.in');
                  setPassword('Password123!');
                }}
                className="py-1.5 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-center truncate"
                title="Company Admin (GSIGN)"
              >
                Company Admin
              </button>
            </div>
          </div>

          {/* Bottom link to Register Company */}
          <div className="text-center pt-2 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              New business?{' '}
              <button
                onClick={() => setActiveView('register_company')}
                className="font-medium text-brand-600 dark:text-brand-400 hover:underline"
              >
                Register Company
              </button>
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-2 text-[11px] text-slate-400">
        Powered by Genemax IT Solution Private Limited • GSIGN Enterprise Platform
      </div>
    </div>
  );
};
