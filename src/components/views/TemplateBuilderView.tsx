import React, { useState, useEffect } from 'react';
import {
  Type,
  Calendar,
  ChevronDown,
  CheckSquare,
  Upload,
  PenTool,
  FileSignature,
  Users,
  CreditCard,
  Eye,
  CheckCircle,
  Plus,
  Save,
  Copy,
  Archive,
  Trash2
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { AgreementTemplate, TemplateField } from '../../types';
import {
  normalizeFieldCoordinates,
  renderTemplateContent,
} from '../../utils/documentPreparation';

const DEFAULT_FIELDS: TemplateField[] = [
  {
    id: 'field-sig',
    type: 'Signature',
    label: 'Recipient signature',
    required: true,
    signingMethod: 'Basic electronic (drawn)',
  },
  {
    id: 'field-wit',
    type: 'Witness',
    label: 'Witness',
    required: false,
    signingMethod: 'Basic electronic (drawn)',
  },
];

const DOCUMENT_TYPE_PRESETS: Record<string, { name: string; department: string; content: string }> = {
  'Offer Letter': {
    name: 'Employment Offer Letter',
    department: 'HR',
    content:
      'This offer is made to {{recipient_name}} for a monthly salary of {{fee_amount}} for the period of {{period}}.\n1. The recipient agrees to the terms and clauses set out in Schedule A.',
  },
  NDA: {
    name: 'Mutual Non-Disclosure Agreement (NDA)',
    department: 'Legal',
    content:
      'This Non-Disclosure Agreement is entered into with {{recipient_name}} effective for a term of {{period}}.\n1. The recipient agrees to keep all proprietary and confidential information strictly confidential.',
  },
  'Service Agreement': {
    name: 'Master Service Agreement',
    department: 'Operations',
    content:
      'This Service Agreement is made with {{recipient_name}} for a monthly retainer fee of {{fee_amount}} for the period of {{period}}.\n1. Service scope, SLAs, and deliverables are detailed in Schedule A.',
  },
  'Employment Contract': {
    name: 'Full-Time Employment Contract',
    department: 'HR',
    content:
      'This Employment Contract is executed with {{recipient_name}} with a monthly salary of {{fee_amount}} for the period of {{period}}.\n1. The employee agrees to the code of conduct, confidentiality, and IP assignment terms in Schedule A.',
  },
  'Vendor Agreement': {
    name: 'Vendor & Supplier Agreement',
    department: 'Procurement',
    content:
      'This Vendor Agreement is entered into with {{recipient_name}} for a contract fee of {{fee_amount}} over {{period}}.\n1. Vendor deliverables, invoicing milestones, and compliance obligations are set out in Schedule A.',
  },
  'Consultancy Agreement': {
    name: 'Independent Consultancy Agreement',
    department: 'Operations',
    content:
      'This Consultancy Agreement is made with {{recipient_name}} for a monthly consultancy fee of {{fee_amount}} for the period of {{period}}.\n1. The consultant shall deliver advisory services as an independent contractor per Schedule A.',
  },
};

const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_PRESETS);

const DEFAULT_CONTENT = DOCUMENT_TYPE_PRESETS['Offer Letter'].content;

export const TemplateBuilderView: React.FC = () => {
  const { templates, setTemplates, addToast, currentRole, setNewAgreementModalOpen } = useApp();
  const isSuperAdmin = currentRole === 'super_admin' || currentRole === 'platform_owner';

  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [name, setName] = useState('Employment Offer Letter');
  const [category, setCategory] = useState('Offer Letter');
  const [department, setDepartment] = useState('HR');
  const [content, setContent] = useState(DEFAULT_CONTENT);
  const [placedFields, setPlacedFields] = useState<TemplateField[]>(DEFAULT_FIELDS);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('field-sig');
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeTemplate = templates.find(t => t.id === activeTemplateId) || null;

  useEffect(() => {
    if (!activeTemplateId && templates.length > 0) {
      const first = templates[0];
      setActiveTemplateId(first.id);
      setName(first.name);
      setCategory(first.category);
      setDepartment(first.department);
      setContent(first.content || DEFAULT_CONTENT);
      setPlacedFields(first.fields.length > 0 ? first.fields : DEFAULT_FIELDS);
      setSelectedFieldId(first.fields[0]?.id || 'field-sig');
    }
  }, [templates, activeTemplateId]);

  const loadTemplateIntoEditor = (tpl: AgreementTemplate) => {
    setActiveTemplateId(tpl.id);
    setName(tpl.name);
    setCategory(tpl.category);
    setDepartment(tpl.department);
    setContent(tpl.content || DEFAULT_CONTENT);
    setPlacedFields(tpl.fields.length > 0 ? tpl.fields : DEFAULT_FIELDS);
    setSelectedFieldId(tpl.fields[0]?.id || 'field-sig');
  };

  const handleNewBlankTemplate = () => {
    const preset = DOCUMENT_TYPE_PRESETS[category] || DOCUMENT_TYPE_PRESETS['Offer Letter'];
    setActiveTemplateId(null);
    setName(preset.name);
    setDepartment(preset.department);
    setContent(preset.content);
    setPlacedFields(DEFAULT_FIELDS);
    setSelectedFieldId('field-sig');
  };

  const handleDocumentTypeChange = (nextCategory: string) => {
    setCategory(nextCategory);
    const matching = templates.filter(t => t.category === nextCategory);
    if (matching.length > 0) {
      loadTemplateIntoEditor(matching[0]);
      return;
    }
    const preset = DOCUMENT_TYPE_PRESETS[nextCategory] || DOCUMENT_TYPE_PRESETS['Offer Letter'];
    setActiveTemplateId(null);
    setName(preset.name);
    setDepartment(preset.department);
    setContent(preset.content);
    setPlacedFields(DEFAULT_FIELDS);
    setSelectedFieldId('field-sig');
  };

  const templatesForType = templates.filter(t => t.category === category);

  const availableFieldTypes: Array<{ type: TemplateField['type']; label: string; icon: React.ReactNode }> = [
    { type: 'Text', label: 'Text', icon: <Type size={13} /> },
    { type: 'Date', label: 'Date', icon: <Calendar size={13} /> },
    { type: 'Dropdown', label: 'Dropdown', icon: <ChevronDown size={13} /> },
    { type: 'Checkbox', label: 'Checkbox', icon: <CheckSquare size={13} /> },
    { type: 'File upload', label: 'File upload', icon: <Upload size={13} /> },
    { type: 'Signature', label: 'Signature', icon: <PenTool size={13} /> },
    { type: 'Thumb Impression', label: 'Thumb Impression', icon: <FileSignature size={13} /> },
    { type: 'Initials', label: 'Initials', icon: <FileSignature size={13} /> },
    { type: 'Witness', label: 'Witness', icon: <Users size={13} /> },
    { type: 'Payment details', label: 'Payment details', icon: <CreditCard size={13} /> },
  ];

  const selectedField = placedFields.find(f => f.id === selectedFieldId) || placedFields[0];

  const handleAddField = (type: TemplateField['type'], label: string) => {
    const newField = normalizeFieldCoordinates(
      {
        id: `field-${Date.now()}`,
        type,
        label,
        required: true,
        signingMethod: type === 'Signature' || type === 'Witness' ? 'Basic electronic (drawn)' : undefined,
        assignedRole: type === 'Witness' ? 'Witness' : 'Recipient',
      },
      placedFields.length,
    );
    setPlacedFields(prev => [...prev, newField]);
    setSelectedFieldId(newField.id);
    addToast('Field Added', `Placed "${label}" at (${newField.x}%, ${newField.y}%)`, 'info');
  };

  const handleRemoveField = (id: string) => {
    setPlacedFields(prev => prev.filter(f => f.id !== id));
    if (selectedFieldId === id) {
      const next = placedFields.find(f => f.id !== id);
      setSelectedFieldId(next?.id || '');
    }
  };

  const handleInsertPlaceholder = (token: string) => {
    setContent(prev => (prev.endsWith(' ') || prev.endsWith('\n') || !prev ? `${prev}${token}` : `${prev} ${token}`));
  };

  const handleUpdateSelectedProperty = (key: keyof TemplateField, val: any) => {
    setPlacedFields(prev =>
      prev.map(f => (f.id === selectedFieldId ? { ...f, [key]: val } : f))
    );
  };

  const handleSaveDraft = async (): Promise<AgreementTemplate | null> => {
    if (!name.trim()) {
      addToast('Validation Error', 'Template name is required.', 'warning');
      return null;
    }
    if (!content.trim() || content.trim().length < 10) {
      addToast('Validation Error', 'Template content must be at least 10 characters.', 'warning');
      return null;
    }
    setSaving(true);
    try {
      let saved: AgreementTemplate;
      if (!activeTemplateId) {
        saved = await api.createTemplate({
          name,
          category,
          department,
          content,
          fields: placedFields,
        });
        setTemplates(prev => [saved, ...prev]);
        setActiveTemplateId(saved.id);
        addToast('Template Created', `Saved '${saved.name}' (Draft v${saved.currentVersion}).`, 'success');
      } else {
        saved = await api.updateTemplate(activeTemplateId, {
          name,
          category,
          department,
          content,
          fields: placedFields,
        });
        setTemplates(prev => prev.map(t => (t.id === saved.id ? saved : t)));
        addToast('Draft Saved', `Saved '${saved.name}' (v${saved.currentVersion}).`, 'success');
      }
      return saved;
    } catch (err: any) {
      addToast('Save Failed', err.message || 'Could not save template.', 'error');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!name.trim() || !content.trim() || content.trim().length < 10) {
      addToast('Validation Error', 'Template name and content (min 10 chars) are required before publishing.', 'warning');
      return;
    }
    setSaving(true);
    try {
      let targetId = activeTemplateId;
      if (!targetId) {
        const created = await api.createTemplate({
          name,
          category,
          department,
          content,
          fields: placedFields,
        });
        setTemplates(prev => [created, ...prev]);
        setActiveTemplateId(created.id);
        targetId = created.id;
      } else {
        await api.updateTemplate(targetId, {
          name,
          category,
          department,
          content,
          fields: placedFields,
        });
      }
      const published = await api.publishTemplate(targetId!);
      setTemplates(prev => prev.map(t => (t.id === published.id ? published : t)));
      addToast('Version Published', `Template '${published.name}' v${published.currentVersion} is now published.`, 'success');
    } catch (err: any) {
      addToast('Publish Failed', err.message || 'Could not publish template.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!activeTemplateId) return;
    setSaving(true);
    try {
      const dup = await api.duplicateTemplate(activeTemplateId);
      setTemplates(prev => [dup, ...prev]);
      loadTemplateIntoEditor(dup);
      addToast('Template Duplicated', `Created '${dup.name}' (Draft v1).`, 'success');
    } catch (err: any) {
      addToast('Duplicate Failed', err.message || 'Could not duplicate template.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!activeTemplateId) return;
    setSaving(true);
    try {
      await api.archiveTemplate(activeTemplateId);
      const remaining = templates.filter(t => t.id !== activeTemplateId);
      setTemplates(remaining);
      if (remaining.length > 0) {
        loadTemplateIntoEditor(remaining[0]);
      } else {
        handleNewBlankTemplate();
      }
      addToast('Template Archived', 'Template has been archived.', 'info');
    } catch (err: any) {
      addToast('Archive Failed', err.message || 'Could not archive template.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const versionLabel = activeTemplate
    ? `${activeTemplate.versionStatus} · v${activeTemplate.currentVersion}`
    : 'Unsaved Draft · v1';

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            {isSuperAdmin ? (
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full sm:w-auto sm:min-w-[320px] max-w-full text-xl font-bold text-slate-900 dark:text-white bg-transparent border-b border-transparent hover:border-slate-300 focus:border-brand-600 outline-none"
              />
            ) : (
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">{name}</h2>
            )}
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 shrink-0">
              {versionLabel}
            </span>
            {!isSuperAdmin && (
              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0">
                Read-only · Super Admin Managed
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isSuperAdmin
              ? 'Global template builder · Published templates reflect across all GSIGN workspaces'
              : 'Official GSIGN templates published by Super Admin · Select a document type and use it in an agreement'}
          </p>
        </div>

        {/* Template Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Document Type"
            value={category}
            onChange={e => handleDocumentTypeChange(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 outline-none focus:border-brand-600"
          >
            {DOCUMENT_TYPES.map(docType => (
              <option key={docType} value={docType}>
                {docType}
              </option>
            ))}
          </select>

          <select
            aria-label="Available Templates"
            value={activeTemplateId || ''}
            onChange={e => {
              if (!e.target.value) {
                handleNewBlankTemplate();
                return;
              }
              const found = templatesForType.find(t => t.id === e.target.value);
              if (found) loadTemplateIntoEditor(found);
            }}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 outline-none"
          >
            {templatesForType.length === 0 ? (
              <option value="">Default {category} Preset</option>
            ) : (
              <>
                {templatesForType.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} (v{t.currentVersion} · {t.status})
                  </option>
                ))}
                {isSuperAdmin && <option value="">+ New {category} Draft</option>}
              </>
            )}
          </select>

          {isSuperAdmin && (
            <button
              type="button"
              onClick={handleNewBlankTemplate}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              + New
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsPreviewMode(!isPreviewMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors shadow-subtle ${
              isPreviewMode
                ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400 border-brand-200 dark:border-brand-800'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Eye size={13} />
            <span>{isPreviewMode ? 'Exit Preview' : 'Preview'}</span>
          </button>

          {!isSuperAdmin && (
            <button
              type="button"
              onClick={() => setNewAgreementModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
            >
              <CheckCircle size={13} />
              <span>Use Template</span>
            </button>
          )}

          {isSuperAdmin && (
            <>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveDraft}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                <Save size={13} />
                <span>Save Draft</span>
              </button>

              {activeTemplateId && (
                <>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleDuplicate}
                    title="Duplicate template"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleArchive}
                    title="Archive template"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800/60 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50"
                  >
                    <Archive size={13} />
                  </button>
                </>
              )}

              <button
                type="button"
                disabled={saving}
                onClick={handlePublish}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-subtle"
              >
                <CheckCircle size={13} />
                <span>Publish version</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* 3-Column Layout (Super Admin) or Centered A4 Read-Only Viewer (Users) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left Column: FIELDS (Palette - Super Admin only) */}
        {isSuperAdmin && (
        <div className="xl:col-span-3 order-2 xl:order-1 space-y-4">
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card">
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
              FIELDS
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-1 gap-1.5">
              {availableFieldTypes.map(f => (
                <button
                  key={f.type}
                  onClick={() => handleAddField(f.type, f.label)}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-normal text-slate-700 dark:text-slate-200 hover:border-brand-600 hover:text-brand-600 dark:hover:text-brand-400 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 group-hover:text-brand-600 dark:group-hover:text-brand-400">
                      {f.icon}
                    </span>
                    <span>{f.label}</span>
                  </div>
                  <Plus size={13} className="text-slate-400 group-hover:text-brand-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        </div>
        )}

        {/* Center Column: Professional A4 Document Canvas */}
        <div className={isSuperAdmin ? 'xl:col-span-6 order-1 xl:order-2' : 'xl:col-span-10 xl:col-start-2'}>
          <div className="bg-slate-100/70 dark:bg-slate-950/60 p-3 sm:p-5 rounded-xl border border-slate-200/80 dark:border-slate-800">
            <div className="w-full max-w-[794px] mx-auto aspect-[210/297] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-sm shadow-[0_12px_36px_-12px_rgba(15,23,42,0.16)] p-7 sm:p-10 flex flex-col justify-between">
              <div className="space-y-5">
                {/* Formal Document Letterhead */}
                <div className="flex items-start justify-between gap-4 pb-4 border-b-2 border-slate-900/10 dark:border-slate-700">
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-400">
                      {category} · {department}
                    </div>
                    <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                      {name || 'Untitled Document'}
                    </h3>
                  </div>
                  <div className="text-right space-y-0.5 shrink-0">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      A4 · {isPreviewMode ? 'Preview' : 'Template'}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      v{activeTemplate?.currentVersion || 1} · {activeTemplate?.status || 'Draft'}
                    </div>
                  </div>
                </div>

                {/* Metadata Summary Strip */}
                <div className="grid grid-cols-3 gap-3 p-3 rounded-md bg-slate-50 dark:bg-slate-950/50 border border-slate-200/70 dark:border-slate-800 text-[11px]">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">Recipient</div>
                    <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      {isPreviewMode ? 'Meera Iyer' : '{{recipient_name}}'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      {category.toLowerCase().includes('offer') || category.toLowerCase().includes('employment')
                        ? 'Monthly Salary'
                        : 'Fee / Retainer'}
                    </div>
                    <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      {isPreviewMode ? '₹45,000' : '{{fee_amount}}'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">Term / Period</div>
                    <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      {isPreviewMode ? '12 months' : '{{period}}'}
                    </div>
                  </div>
                </div>

                {/* Document Body */}
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Terms & Clauses
                  </div>
                  {isPreviewMode || !isSuperAdmin ? (
                    <div className="text-[13px] text-slate-700 dark:text-slate-300 leading-7 whitespace-pre-wrap font-serif">
                      {isPreviewMode
                        ? renderTemplateContent(content, {
                            recipientName: 'Meera Iyer',
                            feeAmount: 45000,
                            period: '12 months',
                          })
                        : content}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider mr-1">Insert variable:</span>
                        {['{{recipient_name}}', '{{fee_amount}}', '{{period}}'].map(tok => (
                          <button
                            key={tok}
                            type="button"
                            onClick={() => handleInsertPlaceholder(tok)}
                            className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-950/40 border border-slate-200 dark:border-slate-700"
                          >
                            {tok}
                          </button>
                        ))}
                      </div>
                      <textarea
                        rows={8}
                        aria-label="Template content"
                        value={content}
                        onChange={e => setContent(e.target.value)}
                        className="w-full text-[13px] text-slate-700 dark:text-slate-300 bg-slate-50/50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-md p-3.5 leading-7 outline-none focus:border-brand-600"
                      />
                    </div>
                  )}
                </div>

                {/* Schedule / Additional Fields */}
                {placedFields.filter(f => f.type !== 'Signature' && f.type !== 'Witness').length > 0 && (
                  <div className="pt-4 border-t border-slate-200/80 dark:border-slate-800 space-y-2.5">
                    <h5 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      Schedule A · Additional Fields
                    </h5>
                    <div className="grid grid-cols-2 gap-2.5">
                      {placedFields
                        .filter(f => f.type !== 'Signature' && f.type !== 'Witness')
                        .map(field => (
                          <div
                            key={field.id}
                            onClick={() => setSelectedFieldId(field.id)}
                            className={`p-2.5 rounded-md border text-xs cursor-pointer transition-colors ${
                              selectedFieldId === field.id
                                ? 'border-brand-600 bg-brand-50/50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            <div className="font-medium">{field.label}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {field.type}{field.required ? ' · Required' : ''}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Formal Execution & Signature Block */}
              <div className="pt-6 border-t border-slate-200 dark:border-slate-800 space-y-4">
                <p className="text-[11px] italic text-slate-500 dark:text-slate-400">
                  IN WITNESS WHEREOF, the parties hereto have executed this {category.toLowerCase()} electronically.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div
                    onClick={() => setSelectedFieldId('field-sig')}
                    className={`p-4 rounded-md border border-dashed flex flex-col justify-between min-h-[76px] cursor-pointer transition-colors ${
                      selectedFieldId === 'field-sig'
                        ? 'border-brand-600 bg-brand-50/30 dark:bg-brand-950/20'
                        : 'border-brand-500/60 dark:border-brand-500/40'
                    }`}
                  >
                    <span className="text-[11px] font-semibold text-brand-600 dark:text-brand-400">
                      Signature · Recipient
                    </span>
                    <div className="pt-4 border-b border-slate-300 dark:border-slate-700 text-[10px] text-slate-400">
                      Authorized Signatory & Date
                    </div>
                  </div>

                  <div
                    onClick={() => setSelectedFieldId('field-wit')}
                    className={`p-4 rounded-md border border-dashed flex flex-col justify-between min-h-[76px] cursor-pointer transition-colors ${
                      selectedFieldId === 'field-wit'
                        ? 'border-brand-600 bg-brand-50/30 dark:bg-brand-950/20'
                        : 'border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      Witness
                    </span>
                    <div className="pt-4 border-b border-slate-300 dark:border-slate-700 text-[10px] text-slate-400">
                      Witness Name & Date
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1">
                  <span>GSIGN · A4 Standard (210 × 297 mm)</span>
                  <span>Page 1 of 1</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: FIELD PROPERTIES (Super Admin only) */}
        {isSuperAdmin && (
        <div className="xl:col-span-3 order-3 space-y-4">
          <div className="p-4 sm:p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-4">
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              FIELD PROPERTIES
            </h4>

            {selectedField ? (
              <div className="space-y-3.5">
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Label
                  </label>
                  <input
                    type="text"
                    value={selectedField.label}
                    onChange={e => handleUpdateSelectedProperty('label', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:border-brand-600 text-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Signing method
                  </label>
                  <select
                    value={selectedField.signingMethod || 'Basic electronic (drawn)'}
                    onChange={e => handleUpdateSelectedProperty('signingMethod', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:border-brand-600 text-slate-800 dark:text-slate-100 cursor-pointer"
                  >
                    <option value="Basic electronic (drawn)">Basic electronic (drawn)</option>
                    <option value="OTP verified">OTP verified</option>
                    <option value="Aadhaar eSign" disabled>Aadhaar eSign (Unavailable — Not Integrated)</option>
                    <option value="DSC" disabled>DSC (Unavailable — Not Integrated)</option>
                  </select>
                </div>

                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="req-checkbox"
                      checked={selectedField.required}
                      onChange={e => handleUpdateSelectedProperty('required', e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                    />
                    <label htmlFor="req-checkbox" className="text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer">
                      Required
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveField(selectedField.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:underline"
                  >
                    <Trash2 size={11} />
                    Remove
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block mb-1">
                      X (%)
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={90}
                      value={selectedField.x ?? 8}
                      onChange={e => handleUpdateSelectedProperty('x', Number(e.target.value))}
                      className="w-full px-2 py-1 text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block mb-1">
                      Y (%)
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={90}
                      value={selectedField.y ?? 72}
                      onChange={e => handleUpdateSelectedProperty('y', Number(e.target.value))}
                      className="w-full px-2 py-1 text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Assigned Role
                  </label>
                  <select
                    value={selectedField.assignedRole || 'Recipient'}
                    onChange={e => handleUpdateSelectedProperty('assignedRole', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:border-brand-600 text-slate-800 dark:text-slate-100"
                  >
                    <option value="Recipient">Recipient</option>
                    <option value="Witness">Witness</option>
                    <option value="Sender">Sender</option>
                  </select>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 dark:text-slate-500 leading-normal">
                  Edits to published templates create a new Draft version. Published versions remain locked.
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Select any field on canvas to inspect properties.</p>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
};
