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
  Archive
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { AgreementTemplate, TemplateField } from '../../types';

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

const DEFAULT_CONTENT =
  'This offer is made to {{recipient_name}} for a monthly fee of {{fee_amount}} for the period of {{period}}.\n1. The recipient agrees to the terms and clauses set out in Schedule A.';

export const TemplateBuilderView: React.FC = () => {
  const { templates, setTemplates, addToast } = useApp();

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
    setActiveTemplateId(null);
    setName('Untitled Agreement Template');
    setCategory('Offer Letter');
    setDepartment('HR');
    setContent(DEFAULT_CONTENT);
    setPlacedFields(DEFAULT_FIELDS);
    setSelectedFieldId('field-sig');
  };

  const availableFieldTypes: Array<{ type: TemplateField['type']; label: string; icon: React.ReactNode }> = [
    { type: 'Text', label: 'Text', icon: <Type size={13} /> },
    { type: 'Date', label: 'Date', icon: <Calendar size={13} /> },
    { type: 'Dropdown', label: 'Dropdown', icon: <ChevronDown size={13} /> },
    { type: 'Checkbox', label: 'Checkbox', icon: <CheckSquare size={13} /> },
    { type: 'File upload', label: 'File upload', icon: <Upload size={13} /> },
    { type: 'Signature', label: 'Signature', icon: <PenTool size={13} /> },
    { type: 'Initials', label: 'Initials', icon: <FileSignature size={13} /> },
    { type: 'Witness', label: 'Witness', icon: <Users size={13} /> },
    { type: 'Payment details', label: 'Payment details', icon: <CreditCard size={13} /> },
  ];

  const selectedField = placedFields.find(f => f.id === selectedFieldId) || placedFields[0];

  const handleAddField = (type: TemplateField['type'], label: string) => {
    const newField: TemplateField = {
      id: `field-${Date.now()}`,
      type,
      label,
      required: true,
      signingMethod: type === 'Signature' || type === 'Witness' ? 'Basic electronic (drawn)' : undefined,
    };
    setPlacedFields(prev => [...prev, newField]);
    setSelectedFieldId(newField.id);
    addToast('Field Added', `Placed "${label}" on document canvas`, 'info');
  };

  const handleUpdateSelectedProperty = (key: keyof TemplateField, val: any) => {
    setPlacedFields(prev =>
      prev.map(f => (f.id === selectedFieldId ? { ...f, [key]: val } : f))
    );
  };

  const handleSaveDraft = async (): Promise<AgreementTemplate | null> => {
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="text-xl font-bold text-slate-900 dark:text-white bg-transparent border-b border-transparent hover:border-slate-300 focus:border-brand-600 outline-none"
            />
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
              {versionLabel}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Dynamic template builder with immutable version history
          </p>
        </div>

        {/* Template Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {templates.length > 0 && (
            <select
              value={activeTemplateId || ''}
              onChange={e => {
                const found = templates.find(t => t.id === e.target.value);
                if (found) loadTemplateIntoEditor(found);
              }}
              className="px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 outline-none"
            >
              {templates.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} (v{t.currentVersion} · {t.status})
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={handleNewBlankTemplate}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            + New
          </button>

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
        </div>
      </div>

      {/* 3-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: FIELDS (Palette) */}
        <div className="lg:col-span-3 space-y-4">
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card">
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
              FIELDS
            </h4>
            <div className="space-y-1.5">
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

        {/* Center Column: Document Canvas */}
        <div className="lg:col-span-6">
          <div className="p-8 sm:p-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card min-h-[500px] flex flex-col justify-between space-y-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400 pb-2.5 border-b border-slate-100 dark:border-slate-800">
                <span className="font-mono">
                  {category} · {department}
                </span>
                <span className="text-[10px] uppercase font-medium text-slate-400">
                  {isPreviewMode ? 'Preview Mode' : 'Canvas'}
                </span>
              </div>

              {isPreviewMode ? (
                <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                  {content
                    .replace(/\{\{recipient_name\}\}/g, 'Meera Iyer')
                    .replace(/\{\{fee_amount\}\}/g, '₹45,000')
                    .replace(/\{\{period\}\}/g, '12 months')}
                </div>
              ) : (
                <textarea
                  rows={8}
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  className="w-full text-sm text-slate-700 dark:text-slate-300 bg-slate-50/50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-lg p-3 leading-relaxed outline-none focus:border-brand-600"
                />
              )}

              {placedFields.filter(f => f.type !== 'Signature' && f.type !== 'Witness').length > 0 && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <h5 className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                    Additional Fields
                  </h5>
                  <div className="grid grid-cols-2 gap-2">
                    {placedFields
                      .filter(f => f.type !== 'Signature' && f.type !== 'Witness')
                      .map(field => (
                        <div
                          key={field.id}
                          onClick={() => setSelectedFieldId(field.id)}
                          className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                            selectedFieldId === field.id
                              ? 'border-brand-600 bg-brand-50/50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300'
                              : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <div className="font-medium">{field.label}</div>
                          <div className="text-[10px] text-slate-400">{field.type} {field.required ? '· Required' : ''}</div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 pt-6">
              <div
                onClick={() => setSelectedFieldId('field-sig')}
                className={`p-5 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
                  selectedFieldId === 'field-sig'
                    ? 'border-brand-600 bg-brand-50/30 dark:bg-brand-950/20'
                    : 'border-brand-500/70 dark:border-brand-500/50'
                }`}
              >
                <span className="text-xs font-semibold text-brand-600 dark:text-brand-400">
                  Signature · Recipient
                </span>
              </div>

              <div
                onClick={() => setSelectedFieldId('field-wit')}
                className={`p-5 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
                  selectedFieldId === 'field-wit'
                    ? 'border-brand-600 bg-brand-50/30 dark:bg-brand-950/20'
                    : 'border-slate-300 dark:border-slate-700'
                }`}
              >
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Witness
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: FIELD PROPERTIES */}
        <div className="lg:col-span-3 space-y-4">
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
                    <option value="Aadhaar eSign">Aadhaar eSign</option>
                    <option value="DSC">DSC</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 pt-0.5">
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

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 dark:text-slate-500 leading-normal">
                  Edits to published templates create a new Draft version. Published versions remain locked.
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Select any field on canvas to inspect properties.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
