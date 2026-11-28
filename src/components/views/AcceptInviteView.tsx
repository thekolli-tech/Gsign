import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, CheckCircle2, AlertTriangle, Building2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import gsignLogo from '../../assets/gsign_logo.png';

export const AcceptInviteView: React.FC = () => {
  const { setActiveView, loadLiveWorkspaceData, addToast } = useApp();

  const [token, setToken] = useState('');
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [inviteInfo, setInviteInfo] = useState<{
    email: string;
    workspace_name: string;
    role_name: string;
    department: string;
    expires_at: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawToken = params.get('invite_token')?.trim() || '';
    setToken(rawToken);
    if (!rawToken) {
      setLoadError('Missing invitation token.');
      setLoadingInfo(false);
      return;
    }

    let active = true;
    setLoadingInfo(true);
    api
      .getInviteInfo(rawToken)
      .then((info) => {
        if (!active) return;
        setInviteInfo(info);
        setLoadError(null);
      })
      .catch((err: any) => {
        if (!active) return;
        setLoadError(err.message || 'Invalid, expired, or already-used invitation.');
      })
      .finally(() => {
        if (active) setLoadingInfo(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');

    if (!fullName.trim() || fullName.trim().length < 2) {
      setSubmitError('Please enter your full name.');
      return;
    }
    if (password.length < 8) {
      setSubmitError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setSubmitError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.acceptInvite({
        token,
        full_name: fullName.trim(),
        password,
      });

      // Remove invite_token from URL cleanly
      const url = new URL(window.location.href);
      url.searchParams.delete('invite_token');
      window.history.replaceState({}, '', url.pathname + url.search);

      if (res.session) {
        await loadLiveWorkspaceData(res.session);
        addToast('Welcome to GSIGN', `Joined ${inviteInfo?.workspace_name || 'workspace'} successfully.`, 'success');
        setActiveView(res.session.role === 'Company Admin' ? 'dashboard' : 'agreements');
      } else if (res.mfa_required) {
        addToast('MFA Required', res.message || 'Please sign in and complete MFA verification.', 'info');
        setActiveView('signin');
      } else {
        addToast('Invitation Accepted', res.message || 'Please sign in with your credentials.', 'info');
        setActiveView('signin');
      }
    } catch (err: any) {
      setSubmitError(err.message || 'Could not accept invitation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card p-6 sm:p-8 space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="rounded-md dark:bg-white dark:px-3 dark:py-1">
            <img src={gsignLogo} alt="GSIGN" className="h-9 w-auto object-contain" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Accept Workspace Invitation
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Set up your GSIGN account to join your company workspace
          </p>
        </div>

        {loadingInfo ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Validating invitation link...
          </div>
        ) : loadError ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Invitation Unavailable</div>
                <p className="mt-1">{loadError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.delete('invite_token');
                window.history.replaceState({}, '', url.pathname + url.search);
                setActiveView('signin');
              }}
              className="w-full py-2.5 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors"
            >
              Go to Sign In
            </button>
          </div>
        ) : inviteInfo ? (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center gap-1.5 text-slate-900 dark:text-white font-semibold">
                <Building2 size={14} className="text-brand-600" />
                <span>{inviteInfo.workspace_name}</span>
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                Email: <span className="font-mono font-medium">{inviteInfo.email}</span>
              </div>
              <div className="text-slate-500 dark:text-slate-400">
                Role: <span className="font-medium text-slate-700 dark:text-slate-200">{inviteInfo.role_name}</span> · Department: <span className="font-medium text-slate-700 dark:text-slate-200">{inviteInfo.department}</span>
              </div>
            </div>

            {submitError && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300">
                {submitError}
              </div>
            )}

            <div>
              <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Full Name
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 outline-none focus:border-brand-600"
              />
            </div>

            <div>
              <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Create Password (min 8 characters)
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 pr-9 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 outline-none focus:border-brand-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div>
              <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Confirm Password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 outline-none focus:border-brand-600"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 font-semibold flex items-center justify-center gap-1.5 shadow-subtle"
            >
              <CheckCircle2 size={15} />
              <span>{submitting ? 'Creating Account...' : 'Accept & Join Workspace'}</span>
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
};
