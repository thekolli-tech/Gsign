import React, { useState } from 'react';
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
  Plus
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TemplateField } from '../../types';

export const TemplateBuilderView: React.FC = () => {
  const { addToast } = useApp();

  const [version, setVersion] = useState('v3');
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('field-sig');

  // Fields palette available on left sidebar (exact match to screenshot)
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

  // Active fields placed on the document
  const [placedFields, setPlacedFields] = useState<TemplateField[]>([
    {
      id: 'field-sig',
      type: 'Signature',
      label: 'Recipient signature',
      required: true,
      signingMethod: 'Basic electronic (drawn)'
    },
    {
      id: 'field-wit',
      type: 'Witness',
      label: 'Witness',
      required: false,
      signingMethod: 'Basic electronic (drawn)'
    }
  ]);

  const selectedField = placedFields.find(f => f.id === selectedFieldId) || placedFields[0];

  const handleAddField = (type: TemplateField['type'], label: string) => {
    const newField: TemplateField = {
      id: `field-${Date.now()}`,
      type,
      label,
      required: true,
      signingMethod: type === 'Signature' || type === 'Witness' ? 'Basic electronic (drawn)' : undefined
    };
    setPlacedFields(prev => [...prev, newField]);
    setSelectedFieldId(newField.id);
    addToast('Field Added', `Placed "${label}" on document canvas`, 'info');
  };

  const handleUpdateSelectedProperty = (key: keyof TemplateField, val: any) => {
    setPlacedFields(prev => prev.map(f => {
      if (f.id === selectedFieldId) {
        return { ...f, [key]: val };
      }
      return f;
    }));
  };

  const handlePublish = () => {
    setVersion('v4');
    addToast('Version Published', 'Template v4 is now live and locked for new agreements.', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Header bar matching pages 2 & 16 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Employment Offer Letter
            </h2>
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
              Draft · {version}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Dynamic template builder with placeholder fields
          </p>
        </div>

        {/* Buttons: Preview with test data & Publish version */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsPreviewMode(!isPreviewMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors shadow-subtle ${
              isPreviewMode
                ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400 border-brand-200 dark:border-brand-800'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Eye size={13} />
            <span>{isPreviewMode ? 'Exit Test Preview' : 'Preview with test data'}</span>
          </button>

          <button
            onClick={handlePublish}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
          >
            <CheckCircle size={13} />
            <span>Publish version</span>
          </button>
        </div>
      </div>

      {/* 3-Column Layout Matching Pages 2 & 16 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: FIELDS (Palette) ~ 3 cols */}
        <div className="lg:col-span-3 space-y-4">
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card">
            <h4 className="text-[11px] font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-2.5">
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

        {/* Center Column: Document Canvas ~ 6 cols */}
        <div className="lg:col-span-6">
          <div className="p-8 sm:p-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card min-h-[500px] flex flex-col justify-between space-y-8">
            {/* Agreement Number & Heading */}
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400 pb-2.5 border-b border-slate-100 dark:border-slate-800">
                <span className="font-mono">
                  Agreement No. · {isPreviewMode ? 'AGR-2026-0412' : ''}
                </span>
                <span className="text-[10px] uppercase font-medium text-slate-400">
                  {isPreviewMode ? 'Preview Mode' : 'Canvas'}
                </span>
              </div>

              {/* Dynamic Body matching screenshot pages 2 & 16 */}
              <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed space-y-4">
                <p>
                  This offer is made to{' '}
                  <span className={`px-1 py-0.5 rounded ${isPreviewMode ? 'font-semibold text-brand-600 dark:text-brand-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono text-xs'}`}>
                    {isPreviewMode ? 'Meera Iyer' : '            '}
                  </span>{' '}
                  for a monthly fee of{' '}
                  <span className={`px-1 py-0.5 rounded ${isPreviewMode ? 'font-semibold text-brand-600 dark:text-brand-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono text-xs'}`}>
                    {isPreviewMode ? '₹45,000' : '        '}
                  </span>{' '}
                  for the period of{' '}
                  <span className={`px-1 py-0.5 rounded ${isPreviewMode ? 'font-semibold text-brand-600 dark:text-brand-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono text-xs'}`}>
                    {isPreviewMode ? '12 months' : '        '}
                  </span>.
                </p>

                <p className="text-xs text-slate-600 dark:text-slate-400">
                  1. The recipient agrees to the terms and clauses set out in Schedule A.
                </p>
              </div>

              {/* Placed Extra Fields */}
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

            {/* Signature & Witness Boxes matching pages 2 & 16 */}
            <div className="grid grid-cols-2 gap-4 pt-6">
              {/* Recipient Signature Box (blue dashed) */}
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

              {/* Witness Box (gray dashed) */}
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

        {/* Right Column: FIELD PROPERTIES ~ 3 cols */}
        <div className="lg:col-span-3 space-y-4">
          <div className="p-4 sm:p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-4">
            <h4 className="text-[11px] font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wider">
              FIELD PROPERTIES
            </h4>

            {selectedField ? (
              <div className="space-y-3.5">
                {/* Label input */}
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

                {/* Signing method */}
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

                {/* Required Checkbox */}
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

                {/* Explanatory Note matching Screenshot */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 dark:text-slate-500 leading-normal">
                  Edits create a new version. Agreements already sent keep their frozen version.
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
