import type { TemplateField } from '../types';

export interface RecipientProgressItem {
  id?: string;
  name: string;
  email: string;
  signing_order: number;
  is_required?: boolean;
  status: string;
  signed_at?: string | null;
}

export interface RecipientFieldValue {
  value?: string;
  checked?: boolean;
}

export interface SigningFieldResponsePayload {
  field_id: string;
  type: string;
  assigned_role: string;
  required: boolean;
  value?: string;
  checked?: boolean;
}

export const DEFAULT_RECIPIENT_FIELDS: TemplateField[] = [
  {
    id: 'rec-initials',
    type: 'Initials',
    label: 'Recipient Initials',
    required: false,
    assignedRole: 'Recipient',
  },
  {
    id: 'rec-date',
    type: 'Date',
    label: 'Signing Date',
    required: true,
    assignedRole: 'Recipient',
  },
  {
    id: 'rec-ack',
    type: 'Checkbox',
    label: 'I confirm my identity and authority to execute this agreement',
    required: true,
    assignedRole: 'Recipient',
  },
];

export function clampZoomLevel(zoom: number): number {
  if (!Number.isFinite(zoom)) return 100;
  return Math.min(150, Math.max(75, Math.round(zoom / 25) * 25));
}

export function paginateDocumentContent(content: string, charsPerPage = 1100): string[] {
  const clean = (content || '').trim();
  if (!clean) return ['No document content provided.'];
  if (clean.length <= charsPerPage) return [clean];

  const words = clean.split(/\s+/);
  const pages: string[] = [];
  let current = '';

  for (const word of words) {
    if ((current + ' ' + word).trim().length > charsPerPage && current.length > 0) {
      pages.push(current.trim());
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current.trim()) {
    pages.push(current.trim());
  }
  return pages.length > 0 ? pages : [clean];
}

export function computeSigningProgress(recipients: RecipientProgressItem[] | undefined | null) {
  const list = Array.isArray(recipients) ? recipients : [];
  const requiredList = list.filter((r) => r.is_required !== false);
  const target = requiredList.length > 0 ? requiredList : list;
  const totalSigners = target.length;
  const signedCount = target.filter((r) => r.status === 'SIGNED').length;
  const pendingSigners = target.filter((r) => r.status !== 'SIGNED');
  const pendingCount = pendingSigners.length;
  const nextSigner =
    [...pendingSigners].sort((a, b) => (a.signing_order || 0) - (b.signing_order || 0))[0] || null;
  const percentComplete = totalSigners > 0 ? Math.round((signedCount / totalSigners) * 100) : 0;

  return {
    totalSigners,
    signedCount,
    pendingCount,
    percentComplete,
    nextSigner,
    isFullyCompleted: totalSigners > 0 && pendingCount === 0,
    isPartiallySigned: signedCount > 0 && pendingCount > 0,
  };
}

export function validateRecipientFieldResponses(
  fields: TemplateField[],
  responses: Record<string, RecipientFieldValue>,
): { valid: boolean; errors: string[]; payloads: SigningFieldResponsePayload[] } {
  const errors: string[] = [];
  const payloads: SigningFieldResponsePayload[] = [];

  for (const field of fields) {
    const role = field.assignedRole || (field.type === 'Witness' ? 'Witness' : 'Recipient');
    if (role !== 'Recipient') {
      continue;
    }
    const resp = responses[field.id] || {};
    const typeLower = field.type.toLowerCase();

    if (field.required) {
      if (typeLower === 'checkbox' && resp.checked !== true) {
        errors.push(`"${field.label}" must be checked.`);
      } else if (
        ['initials', 'date', 'text'].includes(typeLower) &&
        !String(resp.value || '').trim()
      ) {
        errors.push(`"${field.label}" is required.`);
      }
    }

    payloads.push({
      field_id: field.id,
      type: field.type,
      assigned_role: role,
      required: Boolean(field.required),
      value: resp.value !== undefined ? String(resp.value).trim() : undefined,
      checked: resp.checked !== undefined ? Boolean(resp.checked) : undefined,
    });
  }

  return { valid: errors.length === 0, errors, payloads };
}

export function getCompletionBannerState(params: {
  submitResult?: {
    agreement_completed?: boolean;
    agreement_status?: string;
    next_signer?: { name: string; email: string; signing_order: number } | null;
  } | null;
  portalData?: {
    agreement?: { status?: string };
    recipients_progress?: RecipientProgressItem[];
  } | null;
}) {
  const progress = computeSigningProgress(params.portalData?.recipients_progress);
  const status =
    params.submitResult?.agreement_status ||
    params.portalData?.agreement?.status ||
    (progress.isFullyCompleted ? 'Completed' : 'Partially signed');

  const isCompleted =
    Boolean(params.submitResult?.agreement_completed) ||
    status === 'Completed' ||
    (progress.totalSigners > 0 && progress.isFullyCompleted);

  const nextSigner = params.submitResult?.next_signer || progress.nextSigner;

  return {
    isCompleted,
    status,
    headline: isCompleted
      ? 'Agreement completed & executed'
      : 'Your signature has been recorded',
    subtext: isCompleted
      ? 'All required signatures have been verified and recorded.'
      : nextSigner
        ? `Awaiting remaining signer #${nextSigner.signing_order}: ${nextSigner.name} (${nextSigner.email}).`
        : 'Awaiting remaining required signers before final execution.',
    nextSigner,
    progress,
  };
}
