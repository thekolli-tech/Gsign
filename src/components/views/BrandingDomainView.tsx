import React, { useState, useRef, useEffect } from 'react';
import { 
  CheckCircle2, 
  Clock, 
  Save, 
  RefreshCw,
  Upload,
  Trash2
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';

export const BrandingDomainView: React.FC = () => {
  const { branding, setBranding, addToast } = useApp();

  const [logoText, setLogoText] = useState(branding.logoText);
  const [logoUrl, setLogoUrl] = useState<string | undefined>(branding.logoUrl);
  const [brandColor, setBrandColor] = useState(branding.brandColor);
  const [emailDisplayName, setEmailDisplayName] = useState(branding.emailDisplayName);
  const [customDomain, setCustomDomain] = useState(branding.customDomain);
  const [dnsStatus, setDnsStatus] = useState<'pending' | 'checking' | 'verified'>(branding.dnsVerified ? 'verified' : 'pending');
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setLogoText(branding.logoText);
    setLogoUrl(branding.logoUrl);
    setBrandColor(branding.brandColor);
    setEmailDisplayName(branding.emailDisplayName);
    setCustomDomain(branding.customDomain);
    setDnsStatus(branding.dnsVerified ? 'verified' : 'pending');
  }, [branding]);

  // Clean up object URL on unmount if any blob URL was created
  useEffect(() => {
    return () => {
      if (logoUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(logoUrl);
      }
    };
  }, [logoUrl]);

  const colorPresets = [
    { name: 'GSign Violet (Logo)', hex: '#5b13ec' },
    { name: 'Deep Indigo', hex: '#3b04ba' },
    { name: 'Teal Emerald', hex: '#0d9488' },
    { name: 'Midnight Navy', hex: '#0f172a' },
  ];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input value so selecting the same file again fires onChange
    e.target.value = '';

    const validTypes = ['image/svg+xml', 'image/png', 'image/webp'];
    const validExtensions = ['.svg', '.png', '.webp'];
    const hasValidExt = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

    if (!validTypes.includes(file.type) && !hasValidExt) {
      addToast('Unsupported File Format', 'Please upload an SVG, PNG, or WebP logo file.', 'error');
      return;
    }

    const maxBytes = 2 * 1024 * 1024; // 2MB
    if (file.size > maxBytes) {
      addToast('File Too Large', `Logo file exceeds the 2MB limit (${(file.size / (1024 * 1024)).toFixed(2)} MB).`, 'error');
      return;
    }

    // Convert to base64 Data URL so it is persistent across tab/view navigation
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setLogoUrl(result);
        addToast('Logo Ready', `Selected "${file.name}". Click "Save changes" to apply.`, 'success');
      }
    };
    reader.onerror = () => {
      addToast('File Read Error', 'Could not process the selected image.', 'error');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    if (logoUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(logoUrl);
    }
    setLogoUrl(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    addToast('Logo Removed', 'Reverted to default brand placeholder. Click "Save changes" to apply.', 'info');
  };

  const handleDnsCheck = async () => {
    const cleanDomain = customDomain.trim().toLowerCase();
    if (!cleanDomain) {
      addToast('Domain Required', 'Enter a custom domain hostname before verifying DNS.', 'error');
      return;
    }
    setDnsStatus('checking');
    try {
      const result = await api.verifyTenantDomain(cleanDomain);
      setDnsStatus(result.verified ? 'verified' : 'pending');
      setBranding(prev => ({
        ...prev,
        customDomain: result.domain,
        dnsVerified: result.verified,
      }));
      addToast(
        result.verified ? 'DNS Verified' : 'DNS Verification Failed',
        result.message,
        result.verified ? 'success' : 'error',
      );
    } catch (err: any) {
      setDnsStatus('pending');
      addToast('DNS Check Failed', err.message || 'Could not verify domain DNS.', 'error');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await api.updateTenantBranding({
        logoText,
        logoUrl: logoUrl ?? null,
        brandColor,
        emailDisplayName,
        customDomain: customDomain.trim().toLowerCase(),
        dnsVerified: dnsStatus === 'verified',
      });
      setBranding(prev => ({
        ...prev,
        logoText: saved.logoText ?? logoText,
        logoUrl: saved.logoUrl,
        brandColor: saved.brandColor ?? brandColor,
        emailDisplayName: saved.emailDisplayName ?? emailDisplayName,
        customDomain: saved.customDomain ?? customDomain,
        dnsVerified: Boolean(saved.dnsVerified),
      }));
      addToast('Branding Saved', 'Whitelabel assets and custom domain saved permanently to your workspace.', 'success');
    } catch (err: any) {
      addToast('Save Failed', err.message || 'Could not save branding settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Bar matching pages 9 & 23 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Branding & Domain
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Your customers see your brand, not ours
          </p>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
        >
          <Save size={13} />
          <span>Save changes</span>
        </button>
      </div>

      {/* Main 2-Column Grid matching screenshots 9 & 23 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Configuration Form ~ 7 cols */}
        <div className="lg:col-span-7">
          <form onSubmit={handleSave} className="p-6 sm:p-7 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-5">
            {/* Logo Section */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                Brand Logo
              </label>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
                id="brand-logo-upload-input"
                aria-label="Upload brand logo file"
              />

              <div className="flex flex-wrap items-center gap-4">
                {/* Clickable Logo Preview Area */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  title={logoUrl ? 'Click to replace logo' : 'Click to upload logo'}
                  className="w-24 h-14 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-brand-500 dark:hover:border-brand-500 flex items-center justify-center bg-slate-50 dark:bg-slate-900 transition-colors cursor-pointer overflow-hidden p-1.5 group select-none"
                >
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={logoText || 'Brand Logo'}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate text-center group-hover:text-brand-600 dark:group-hover:text-brand-400">
                      {logoText}
                    </span>
                  )}
                </div>

                {/* Upload, Replace, Remove & Name Actions */}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-400 border border-brand-200 dark:border-brand-800/60 hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors shadow-subtle cursor-pointer"
                    >
                      <Upload size={13} />
                      <span>{logoUrl ? 'Replace Logo' : 'Upload Logo'}</span>
                    </button>

                    {logoUrl && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:border-rose-200 dark:border-rose-800 transition-colors cursor-pointer"
                      >
                        <Trash2 size={13} />
                        <span>Remove Logo</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        const next = prompt('Enter your company brand name / logo text:', logoText);
                        if (next && next.trim()) setLogoText(next.trim());
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-subtle cursor-pointer"
                    >
                      Change brand name
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    SVG, PNG or WebP up to 2MB
                  </p>
                </div>
              </div>
            </div>

            {/* Brand Colour presets matching screenshot */}
            <div className="space-y-2 pt-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                Brand colour
              </label>
              <div className="flex items-center gap-2.5">
                {colorPresets.map(preset => (
                  <button
                    key={preset.hex}
                    type="button"
                    onClick={() => setBrandColor(preset.hex)}
                    style={{ backgroundColor: preset.hex }}
                    className={`w-7 h-7 rounded-md transition-all border border-slate-300 dark:border-slate-700 ${
                      brandColor === preset.hex 
                        ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white scale-105' 
                        : 'opacity-85 hover:opacity-100'
                    }`}
                    title={preset.name}
                  />
                ))}
                {/* Custom Hex Color Picker */}
                <div className="relative flex items-center">
                  <input
                    type="color"
                    value={brandColor}
                    onChange={e => setBrandColor(e.target.value)}
                    className="w-7 h-7 rounded-md cursor-pointer opacity-0 absolute inset-0"
                    title="Choose custom HEX color"
                  />
                  <div 
                    className="w-7 h-7 rounded-md border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-400 hover:text-slate-600"
                    style={{ borderColor: brandColor }}
                  >
                    +
                  </div>
                </div>
              </div>
              <span className="text-[11px] text-slate-400 font-mono block">
                Selected HEX: {brandColor}
              </span>
            </div>

            {/* Email display name */}
            <div className="space-y-1 pt-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                Email display name
              </label>
              <input
                type="text"
                value={emailDisplayName}
                onChange={e => setEmailDisplayName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:border-brand-600 text-slate-800 dark:text-slate-100"
              />
            </div>

            {/* Custom domain */}
            <div className="space-y-1 pt-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                Custom domain
              </label>
              <input
                type="text"
                value={customDomain}
                onChange={e => {
                  const next = e.target.value;
                  setCustomDomain(next);
                  if (next.trim().toLowerCase() !== branding.customDomain.trim().toLowerCase() || !branding.dnsVerified) {
                    setDnsStatus('pending');
                  } else {
                    setDnsStatus('verified');
                  }
                }}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:border-brand-600 text-slate-800 dark:text-slate-100 font-mono"
              />
            </div>

            {/* DNS Check Card matching screenshot */}
            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
                <span className="text-slate-600 dark:text-slate-300">
                  DNS check: add CNAME <strong>{customDomain.split('.')[0] || 'sign'}</strong> → <code>cname.vercel-dns.com</code>. SSL is issued after verification.
                </span>
                {dnsStatus === 'verified' ? (
                  <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 flex items-center gap-1">
                    <CheckCircle2 size={11} />
                    Verified
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 flex items-center gap-1">
                    <Clock size={11} />
                    Pending verification
                  </span>
                )}
              </div>

              {dnsStatus !== 'verified' && (
                <button
                  type="button"
                  onClick={handleDnsCheck}
                  disabled={dnsStatus === 'checking'}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-900/40 border border-brand-200 dark:border-brand-800/50 flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw size={11} className={dnsStatus === 'checking' ? 'animate-spin' : ''} />
                  <span>{dnsStatus === 'checking' ? 'Checking DNS...' : 'Verify DNS'}</span>
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Right Column: Live preview · recipient email matching screenshots 9 & 23 ~ 5 cols */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-6 sm:p-7 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Live preview · recipient email
              </h3>
              <span className="text-[10px] uppercase font-medium text-slate-400">
                Email
              </span>
            </div>

            {/* Email Canvas Preview */}
            <div className="p-5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
              {/* Dynamic Branded Header Banner */}
              <div 
                style={{ backgroundColor: brandColor }}
                className="p-3.5 rounded-lg text-white font-semibold text-xs tracking-wide flex items-center justify-between"
              >
                {logoUrl ? (
                  <div className="bg-white rounded px-2.5 py-1 flex items-center justify-center shadow-xs">
                    <img src={logoUrl} alt={logoText} className="h-6 max-h-7 max-w-[120px] object-contain" />
                  </div>
                ) : (
                  <span>{logoText}</span>
                )}
              </div>

              {/* Email Content Body */}
              <div className="space-y-3 text-xs text-slate-700 dark:text-slate-200">
                <p className="leading-relaxed">
                  Hi Ravi, please review and sign your offer letter.
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                  You have been invited by <strong className="text-slate-700 dark:text-slate-300 font-medium">{emailDisplayName}</strong> to execute an agreement online.
                </p>
              </div>

              {/* Action Button styled with brand color */}
              <div>
                <button
                  type="button"
                  style={{ backgroundColor: brandColor }}
                  className="w-full py-2.5 rounded-lg font-medium text-xs text-white transition-opacity hover:opacity-90"
                >
                  Review and sign
                </button>
              </div>

              {/* Footer */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-center text-[10px] text-slate-400">
                Powered by Genemax Sign
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
