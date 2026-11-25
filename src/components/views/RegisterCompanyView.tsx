import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import gsignLogo from '../../assets/gsign_logo.png';

export const RegisterCompanyView: React.FC = () => {
  const { branding, setActiveView, addToast } = useApp();

  // Wizard Steps: 1: Form, 2: Verify Email, 3: Select Plan & Checkout, 4: Done
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Form Fields
  const [companyName, setCompanyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [country, setCountry] = useState('India');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');

  // Admin Fields
  const [adminFullName, setAdminFullName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Verification & Plan State
  const [registrationId, setRegistrationId] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [plans, setPlans] = useState<any[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [tenantId, setTenantId] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    // Fetch paid plans from backend
    api.getSubscriptionPlans()
      .then(res => {
        setPlans(res);
        if (res.length > 0) {
          setSelectedPlanId(res[0].id);
        }
      })
      .catch(() => {
        // Fallback default plans
        setPlans([
          { id: 'starter-id', name: 'Starter Plan', monthly_price: 1499, annual_price: 14990, max_agreements_per_month: 50, max_users: 3, features: ['50 agreements/mo', '3 team members', 'Standard templates'] },
          { id: 'growth-id', name: 'Growth Plan', monthly_price: 3999, annual_price: 39990, max_agreements_per_month: 250, max_users: 10, features: ['250 agreements/mo', '10 team members', 'Custom branding'] },
          { id: 'enterprise-id', name: 'Enterprise Plan', monthly_price: 9999, annual_price: 99990, max_agreements_per_month: -1, max_users: -1, features: ['Unlimited agreements', 'Unlimited team members', 'Dedicated manager'] },
        ]);
      });
  }, []);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    if (!termsAccepted) {
      setErrorMsg('You must accept the Terms of Service and Privacy Policy to register.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.registerCompany({
        company_name: companyName,
        display_name: displayName || companyName,
        business_email: businessEmail,
        business_phone: businessPhone,
        country,
        state,
        city,
        address,
        website: website || undefined,
        admin_full_name: adminFullName,
        admin_email: adminEmail,
        password,
        terms_accepted: termsAccepted,
      });

      setRegistrationId(res.registration_id);
      setVerificationToken(res.verification_token);
      setTokenInput(res.verification_token);
      setStep(2);
      addToast('Verification Sent', 'Please verify your work email address to proceed.', 'info');
    } catch (err: any) {
      setErrorMsg(err.message || 'Registration failed.');
      addToast('Error', err.message || 'Registration failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmail = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      await api.verifyEmail(tokenInput.trim());
      setStep(3);
      addToast('Email Verified', 'Email address verified! Please select your subscription plan.', 'success');
    } catch (err: any) {
      setErrorMsg(err.message || 'Verification token invalid or expired.');
      addToast('Verification Failed', err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteSetupAndCheckout = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      // 1. Provision company workspace (returns PAYMENT_PENDING state)
      const setupRes = await api.completeCompanySetup({
        registration_id: registrationId,
        plan_id: selectedPlanId,
        billing_cycle: billingCycle,
      });

      setTenantId(setupRes.tenant_id);

      // 2. Simulate Payment Verification
      await api.simulateCheckout({
        tenant_id: setupRes.tenant_id,
        plan_id: selectedPlanId,
        billing_cycle: billingCycle,
        payment_method: 'Corporate Net Banking',
      });

      setStep(4);
      addToast('Workspace Activated', 'Payment verified! Your company workspace is now active.', 'success');
    } catch (err: any) {
      setErrorMsg(err.message || 'Setup or checkout failed.');
      addToast('Checkout Error', err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 transition-colors duration-200">
      {/* Header */}
      <div className="max-w-4xl w-full mx-auto flex items-center justify-between py-3">
        <div className="flex items-center gap-3">
          <img
            src={branding.logoUrl || gsignLogo}
            alt="GSIGN"
            className="h-8 w-auto max-w-[160px] object-contain cursor-pointer"
            onClick={() => setActiveView('signin')}
          />
        </div>
        <div className="flex items-center gap-4 text-xs font-medium">
          <span className="text-slate-500">Already registered?</span>
          <button
            onClick={() => setActiveView('signin')}
            className="text-brand-600 dark:text-brand-400 hover:underline font-semibold"
          >
            Sign in
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl p-7 sm:p-9 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-modal space-y-6">
          
          {/* Progress Indicator */}
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                {step === 1 && 'Register Your Company'}
                {step === 2 && 'Verify Business Email'}
                {step === 3 && 'Select Subscription Plan'}
                {step === 4 && 'Registration Complete!'}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {step === 1 && 'Create your dedicated multi-tenant enterprise workspace'}
                {step === 2 && 'Confirm your email using the secure verification code'}
                {step === 3 && 'GSIGN is a paid SaaS platform (No free trials)'}
                {step === 4 && 'Your paid enterprise workspace has been provisioned'}
              </p>
            </div>
            <div className="text-xs font-semibold px-2.5 py-1 rounded-full bg-brand-50 dark:bg-brand-950/50 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800">
              Step {step} of 4
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          {/* STEP 1: Registration Form */}
          {step === 1 && (
            <form onSubmit={handleRegisterSubmit} className="space-y-5 text-xs">
              <div className="space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  1. Company Information
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Registered Company Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Acme Technologies Pvt Ltd"
                      value={companyName}
                      onChange={e => setCompanyName(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Company Display Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Acme Tech"
                      value={displayName}
                      onChange={e => setDisplayName(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Business Email *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="contact@company.com"
                      value={businessEmail}
                      onChange={e => setBusinessEmail(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Business Phone *
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="+91 98765 43210"
                      value={businessPhone}
                      onChange={e => setBusinessPhone(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Country *
                    </label>
                    <input
                      type="text"
                      required
                      value={country}
                      onChange={e => setCountry(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      State *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Karnataka"
                      value={state}
                      onChange={e => setState(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      City *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Bangalore"
                      value={city}
                      onChange={e => setCity(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Registered Business Address *
                  </label>
                  <textarea
                    required
                    rows={2}
                    placeholder="Full registered office address"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600 resize-none"
                  />
                </div>

                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Website (optional)
                  </label>
                  <input
                    type="url"
                    placeholder="https://company.com"
                    value={website}
                    onChange={e => setWebsite(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                  />
                </div>
              </div>

              <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  2. First Company Administrator
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Admin Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Rajesh Kumar"
                      value={adminFullName}
                      onChange={e => setAdminFullName(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Admin Work Email *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="rajesh@company.com"
                      value={adminEmail}
                      onChange={e => setAdminEmail(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Password (min 8 chars) *
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Confirm Password *
                    </label>
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={e => setTermsAccepted(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-slate-600 dark:text-slate-400 text-xs">
                    I agree to the <span className="text-brand-600 dark:text-brand-400 underline">Terms of Service</span> and{' '}
                    <span className="text-brand-600 dark:text-brand-400 underline">Privacy Policy</span>. I acknowledge that GSIGN is a paid enterprise subscription service without free trials.
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-subtle"
              >
                {loading ? 'Submitting Registration...' : 'Continue to Email Verification →'}
              </button>
            </form>
          )}

          {/* STEP 2: Email Verification */}
          {step === 2 && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 text-blue-900 dark:text-blue-300 space-y-1">
                <p className="font-semibold text-sm">Verification Link Sent!</p>
                <p className="text-xs opacity-90">
                  We have sent a secure, single-use verification token to <strong>{adminEmail}</strong>.
                </p>
              </div>

              <div className="space-y-2">
                <label className="font-medium text-slate-700 dark:text-slate-300 block">
                  Verification Token
                </label>
                <input
                  type="text"
                  value={tokenInput}
                  onChange={e => setTokenInput(e.target.value)}
                  placeholder="Paste 64-character verification token"
                  className="w-full px-3 py-2 font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                />
                <p className="text-[11px] text-slate-400">
                  In development/testing, the generated token is auto-filled above for immediate verification.
                </p>
              </div>

              <button
                onClick={handleVerifyEmail}
                disabled={loading || !tokenInput.trim()}
                className="w-full py-2.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-subtle"
              >
                {loading ? 'Verifying...' : 'Verify Email & Select Plan →'}
              </button>
            </div>
          )}

          {/* STEP 3: Plan Selection & Checkout */}
          {step === 3 && (
            <div className="space-y-5 text-xs">
              <div className="flex justify-center items-center gap-2 pb-2">
                <span className={`font-medium ${billingCycle === 'monthly' ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500'}`}>
                  Monthly Billing
                </span>
                <button
                  type="button"
                  onClick={() => setBillingCycle(c => c === 'monthly' ? 'annual' : 'monthly')}
                  className="w-11 h-6 bg-slate-200 dark:bg-slate-700 rounded-full relative p-0.5 transition-colors"
                >
                  <div className={`w-5 h-5 rounded-full bg-white dark:bg-brand-500 shadow-md transition-transform ${billingCycle === 'annual' ? 'translate-x-5' : ''}`} />
                </button>
                <span className={`font-medium ${billingCycle === 'annual' ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500'}`}>
                  Annual Billing (Save 2 months)
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {plans.map((p) => {
                  const price = billingCycle === 'annual' ? p.annual_price : p.monthly_price;
                  const isSelected = selectedPlanId === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPlanId(p.id)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between space-y-3 ${
                        isSelected
                          ? 'border-brand-600 ring-2 ring-brand-600/20 bg-brand-50/20 dark:bg-brand-950/20'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                      }`}
                    >
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold text-slate-900 dark:text-white text-sm">
                            {p.name}
                          </span>
                          {isSelected && (
                            <span className="text-[10px] bg-brand-600 text-white font-semibold px-2 py-0.5 rounded-full">
                              Selected
                            </span>
                          )}
                        </div>
                        <div className="text-xl font-bold text-slate-900 dark:text-white mt-2">
                          ₹{Number(price).toLocaleString('en-IN')}
                          <span className="text-xs font-normal text-slate-400">/{billingCycle === 'annual' ? 'year' : 'mo'}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                          {p.description}
                        </p>
                      </div>

                      <div className="border-t border-slate-100 dark:border-slate-800 pt-2 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                        <div>• {p.max_agreements_per_month === -1 ? 'Unlimited' : p.max_agreements_per_month} agreements/mo</div>
                        <div>• {p.max_users === -1 ? 'Unlimited' : p.max_users} team members</div>
                        <div>• Full SHA-256 audit logs</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200">
                <strong>No Free Trial:</strong> Workspace access activates immediately upon verified checkout payment.
              </div>

              <button
                onClick={handleCompleteSetupAndCheckout}
                disabled={loading || !selectedPlanId}
                className="w-full py-2.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-subtle"
              >
                {loading ? 'Processing Payment & Activating...' : 'Pay & Activate Workspace →'}
              </button>
            </div>
          )}

          {/* STEP 4: Success Confirmation */}
          {step === 4 && (
            <div className="text-center py-6 space-y-4 text-xs">
              <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto text-2xl font-bold">
                ✓
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Company Workspace Active!
              </h2>
              <p className="text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                Your enterprise tenant <strong>{companyName}</strong> has been provisioned. The administrator account (<strong>{adminEmail}</strong>) is ready.
              </p>

              <div className="pt-4">
                <button
                  onClick={() => setActiveView('signin')}
                  className="px-6 py-2.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
                >
                  Proceed to Login →
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-2 text-[11px] text-slate-400">
        Powered by Genemax IT Solution Private Limited • GSIGN Enterprise Platform
      </div>
    </div>
  );
};
