import type { TemplateField } from '../types';

export interface DocumentVariableValues {
  recipientName?: string;
  feeAmount?: number | string;
  period?: string;
}

export interface AgreementWizardValidationInput {
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string;
  templateType: string;
  content: string;
  fields: TemplateField[];
}

export const SUPPORTED_SIGNING_METHODS = ['basic_drawn', 'otp_verified'] as const;

export function isSigningMethodSupported(method: string): boolean {
  return (SUPPORTED_SIGNING_METHODS as readonly string[]).includes(method);
}

export function clampPercentage(value: number, min = 2, max = 92): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value * 10) / 10));
}

export function normalizeFieldCoordinates(
  field: TemplateField,
  index = 0,
): TemplateField & { page: number; x: number; y: number; width: number; height: number; assignedRole: 'Recipient' | 'Witness' | 'Sender' } {
  const defaultX = index % 2 === 0 ? 8 : 54;
  const defaultY = clampPercentage(72 + Math.floor(index / 2) * 12, 8, 86);
  const width = clampPercentage(field.width ?? (field.type === 'Signature' || field.type === 'Witness' ? 38 : 26), 12, 80);
  const height = clampPercentage(field.height ?? (field.type === 'Signature' || field.type === 'Witness' ? 11 : 7), 5, 30);

  return {
    ...field,
    page: field.page && field.page >= 1 ? Math.floor(field.page) : 1,
    x: clampPercentage(field.x ?? defaultX, 2, 100 - width),
    y: clampPercentage(field.y ?? defaultY, 2, 100 - height),
    width,
    height,
    assignedRole: field.assignedRole ?? (field.type === 'Witness' ? 'Witness' : 'Recipient'),
  };
}

export function computeClickCoordinates(params: {
  clientX: number;
  clientY: number;
  rectLeft: number;
  rectTop: number;
  rectWidth: number;
  rectHeight: number;
  fieldWidthPct?: number;
  fieldHeightPct?: number;
}): { x: number; y: number } {
  if (params.rectWidth <= 0 || params.rectHeight <= 0) {
    return { x: 8, y: 72 };
  }
  const rawX = ((params.clientX - params.rectLeft) / params.rectWidth) * 100;
  const rawY = ((params.clientY - params.rectTop) / params.rectHeight) * 100;
  const w = params.fieldWidthPct ?? 26;
  const h = params.fieldHeightPct ?? 8;
  return {
    x: clampPercentage(rawX, 2, Math.max(2, 100 - w)),
    y: clampPercentage(rawY, 2, Math.max(2, 100 - h)),
  };
}

export function renderTemplateContent(
  templateContent: string,
  vars: DocumentVariableValues,
): string {
  const formattedFee =
    vars.feeAmount !== undefined && vars.feeAmount !== ''
      ? `₹${Number(vars.feeAmount).toLocaleString('en-IN')}`
      : '₹0';
  return (templateContent || '')
    .replace(/\{\{\s*recipient_name\s*\}\}/gi, vars.recipientName?.trim() || '[Recipient Name]')
    .replace(/\{\{\s*fee_amount\s*\}\}/gi, formattedFee)
    .replace(/\{\{\s*period\s*\}\}/gi, vars.period?.trim() || '[Period]');
}

export function validateAgreementPreparation(
  input: AgreementWizardValidationInput,
): string[] {
  const errors: string[] = [];
  if (!input.recipientName.trim()) {
    errors.push('Recipient name is required.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipientEmail.trim())) {
    errors.push('A valid recipient email address is required.');
  }
  if (!input.recipientPhone.trim() || input.recipientPhone.trim().length < 6) {
    errors.push('Recipient phone number is required.');
  }
  if (!input.templateType.trim()) {
    errors.push('Template type is required.');
  }
  if (!input.content.trim() || input.content.trim().length < 10) {
    errors.push('Agreement content must be at least 10 characters.');
  }
  const hasRequiredSignature = input.fields.some(
    (f) => (f.type === 'Signature' || f.type === 'Initials') && f.required,
  );
  if (!hasRequiredSignature) {
    errors.push('At least one required Signature or Initials field must be placed.');
  }
  return errors;
}

export function buildAgreementPreviewModel(params: {
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string;
  templateType: string;
  department: string;
  feeAmount: number;
  period: string;
  signMethod: string;
  rawContent: string;
  fields: TemplateField[];
}) {
  const renderedContent = renderTemplateContent(params.rawContent, {
    recipientName: params.recipientName,
    feeAmount: params.feeAmount,
    period: params.period,
  });
  const normalizedFields = params.fields.map((f, idx) => normalizeFieldCoordinates(f, idx));
  const requiredFieldsCount = normalizedFields.filter((f) => f.required).length;

  return {
    previewStatus: 'PRE_SEND_DRAFT' as const,
    previewBanner: 'PRE-SEND DRAFT PREVIEW — Not yet sent or signed',
    renderedContent,
    normalizedFields,
    requiredFieldsCount,
    recipientSummary: {
      name: params.recipientName.trim(),
      email: params.recipientEmail.trim(),
      phone: params.recipientPhone.trim(),
      signMethod: params.signMethod,
    },
    metadata: {
      templateType: params.templateType,
      department: params.department,
      feeAmount: params.feeAmount,
      period: params.period,
    },
  };
}
