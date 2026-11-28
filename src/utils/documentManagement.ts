import type { Agreement, AgreementStatus, AuditEvent } from '../types';

export interface DocumentVersionRecord {
  id: string;
  version_number: number;
  file_name: string;
  mime_type?: string;
  size_bytes?: number;
  sha256_hash: string;
  created_at: string;
}

export interface StoredDocumentItem {
  id: string;
  agreement_id?: string | null;
  title: string;
  doc_kind: string;
  current_version: number;
  created_at?: string;
  updated_at?: string;
  versions?: DocumentVersionRecord[];
}

export interface ManagedDocumentRow {
  doc: StoredDocumentItem;
  agreement?: Agreement;
  isSigned: boolean;
  signedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  category: string;
  statusLabel: string;
  recipientLabel: string;
  referenceNumber: string;
  versionCount: number;
  activityCount: number;
}

export type DocumentSortBy =
  | 'created_desc'
  | 'created_asc'
  | 'updated_desc'
  | 'updated_asc'
  | 'signed_desc'
  | 'signed_asc';

export interface DocumentFilterOptions {
  search?: string;
  status?: string;
  category?: string;
  recipient?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: DocumentSortBy;
  page?: number;
  pageSize?: number;
}

export interface PaginatedDocumentsResult {
  items: ManagedDocumentRow[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

export interface SanitizedAuditEvent extends AuditEvent {
  category: 'recorded' | 'unsupported';
  parsedTimestampMs: number | null;
}

export interface RecipientProgressSummary {
  name: string;
  email: string;
  status: string;
  signing_order?: number;
  signed_at?: string | null;
  signing_method?: string | null;
}

export interface CompletionCertificateSummary {
  status: 'Fully Signed' | 'Partially Signed' | 'Rejected' | 'In Progress';
  signedCount: number;
  totalCount: number;
  rejectedCount: number;
  summaryText: string;
  disclaimer: string;
}

const KNOWN_AUDIT_TYPES = new Set<string>([
  'created',
  'sent',
  'viewed',
  'otp',
  'consent',
  'signed',
  'pdf',
  'payment',
]);

const SENSITIVE_PATTERNS: RegExp[] = [
  /(otp|passcode|pin)\s*[:=]\s*['"]?\d{4,8}['"]?/gi,
  /(verification_token|signing_token|access_token|refresh_token|secret|password|biometric_template|credential_public_key)\s*[:=]\s*['"]?[^\s,;'"}\]]+['"]?/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
];

function redactSensitiveText(value?: string): string {
  if (!value) return '';
  let sanitized = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      const prefix = match.split(/[:=\s]/)[0] || 'credential';
      return `${prefix}: [REDACTED]`;
    });
  }
  return sanitized;
}

function parseDateMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Enrich raw stored documents with linked agreement metadata for unified filtering and display.
 */
export function buildManagedDocumentRows(
  documents: StoredDocumentItem[],
  agreements: Agreement[],
): ManagedDocumentRow[] {
  const byUuidOrId = new Map<string, Agreement>();
  for (const agr of agreements) {
    byUuidOrId.set(agr.id, agr);
    const maybeUuid = (agr as Agreement & { uuid?: string }).uuid;
    if (maybeUuid) {
      byUuidOrId.set(maybeUuid, agr);
    }
  }

  return documents.map((doc) => {
    const agreement = doc.agreement_id ? byUuidOrId.get(doc.agreement_id) : undefined;
    const latestVersion = doc.versions?.[0];
    const isSigned =
      doc.doc_kind === 'signed_pdf' ||
      doc.doc_kind === 'certificate' ||
      agreement?.status === 'Completed';

    const signedEvent = agreement?.auditTrail?.find((e) => e.type === 'signed');
    const signedAt = isSigned
      ? signedEvent?.timestamp || latestVersion?.created_at || doc.updated_at || null
      : null;

    const createdAt = doc.created_at || agreement?.createdAt || latestVersion?.created_at || '';
    const updatedAt = doc.updated_at || agreement?.updatedAt || latestVersion?.created_at || createdAt;
    const category = agreement?.templateType || doc.doc_kind || 'document';
    const statusLabel = agreement?.status || (isSigned ? 'Signed' : 'Unsigned');
    const recipientLabel = agreement
      ? `${agreement.recipientName} (${agreement.recipientEmail})`
      : 'Unlinked';
    const referenceNumber = agreement?.id || doc.id;
    const versionCount = doc.versions?.length || doc.current_version || 1;
    const activityCount = (agreement?.auditTrail?.length || 0) + versionCount;

    return {
      doc,
      agreement,
      isSigned,
      signedAt,
      createdAt,
      updatedAt,
      category,
      statusLabel,
      recipientLabel,
      referenceNumber,
      versionCount,
      activityCount,
    };
  });
}

/**
 * Filter, sort, and paginate managed document rows.
 */
export function filterAndSortDocuments(
  rows: ManagedDocumentRow[],
  options: DocumentFilterOptions = {},
): PaginatedDocumentsResult {
  const search = (options.search || '').trim().toLowerCase();
  const status = (options.status || 'all').trim();
  const category = (options.category || 'all').trim();
  const recipient = (options.recipient || 'all').trim().toLowerCase();
  const dateFromMs = options.dateFrom ? parseDateMs(`${options.dateFrom}T00:00:00.000Z`) : null;
  const dateToMs = options.dateTo ? parseDateMs(`${options.dateTo}T23:59:59.999Z`) : null;
  const sortBy: DocumentSortBy = options.sortBy || 'updated_desc';

  const filtered = rows.filter((row) => {
    if (search) {
      const haystack = [
        row.doc.title,
        row.doc.doc_kind,
        row.referenceNumber,
        row.agreement?.templateType,
        row.agreement?.recipientName,
        row.agreement?.recipientEmail,
        row.doc.id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    if (status !== 'all') {
      if (status === 'Signed' && !row.isSigned) return false;
      if (status === 'Unsigned' && row.isSigned) return false;
      if (status !== 'Signed' && status !== 'Unsigned' && row.statusLabel !== status) {
        return false;
      }
    }

    if (category !== 'all' && row.category !== category && row.doc.doc_kind !== category) {
      return false;
    }

    if (recipient !== 'all') {
      const recTarget = `${row.agreement?.recipientName || ''} ${row.agreement?.recipientEmail || ''}`.toLowerCase();
      if (!recTarget.includes(recipient)) return false;
    }

    if (dateFromMs !== null || dateToMs !== null) {
      const targetMs = parseDateMs(row.createdAt) ?? parseDateMs(row.updatedAt);
      if (targetMs === null) return false;
      if (dateFromMs !== null && targetMs < dateFromMs) return false;
      if (dateToMs !== null && targetMs > dateToMs) return false;
    }

    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const pickTime = (row: ManagedDocumentRow): number => {
      if (sortBy.startsWith('created')) return parseDateMs(row.createdAt) ?? 0;
      if (sortBy.startsWith('signed')) return parseDateMs(row.signedAt) ?? 0;
      return parseDateMs(row.updatedAt) ?? 0;
    };
    const diff = pickTime(a) - pickTime(b);
    return sortBy.endsWith('_asc') ? diff : -diff;
  });

  const pageSize = Math.max(1, options.pageSize || 10);
  const totalItems = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, options.page || 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  const items = sorted.slice(start, start + pageSize);

  return {
    items,
    totalItems,
    totalPages,
    currentPage,
  };
}

/**
 * Chronologically order and redact sensitive credentials from audit trail events.
 * Never fabricates missing events.
 */
export function buildSanitizedAuditTimeline(
  events: AuditEvent[],
  order: 'asc' | 'desc' = 'asc',
): SanitizedAuditEvent[] {
  const mapped = events.map((event, index) => ({
    ...event,
    title: redactSensitiveText(event.title),
    description: redactSensitiveText(event.description),
    ip: event.ip ? redactSensitiveText(event.ip) : undefined,
    device: event.device ? redactSensitiveText(event.device) : undefined,
    category: KNOWN_AUDIT_TYPES.has(event.type) ? ('recorded' as const) : ('unsupported' as const),
    parsedTimestampMs: parseDateMs(event.timestamp),
    _index: index,
  }));

  mapped.sort((a, b) => {
    if (a.parsedTimestampMs !== null && b.parsedTimestampMs !== null && a.parsedTimestampMs !== b.parsedTimestampMs) {
      return order === 'asc'
        ? a.parsedTimestampMs - b.parsedTimestampMs
        : b.parsedTimestampMs - a.parsedTimestampMs;
    }
    return order === 'asc' ? a._index - b._index : b._index - a._index;
  });

  return mapped.map(({ _index, ...rest }) => rest);
}

/**
 * Derive completion certificate summary distinguishing Fully Signed, Partially Signed, and Rejected states.
 */
export function buildCompletionCertificateSummary(
  agreementStatus: AgreementStatus | string,
  recipients: RecipientProgressSummary[],
): CompletionCertificateSummary {
  const totalCount = recipients.length;
  const signedCount = recipients.filter((r) => r.status === 'signed').length;
  const rejectedCount = recipients.filter((r) => r.status === 'rejected').length;

  let status: CompletionCertificateSummary['status'] = 'In Progress';
  if (agreementStatus === 'Rejected' || rejectedCount > 0) {
    status = 'Rejected';
  } else if (agreementStatus === 'Completed' || (totalCount > 0 && signedCount === totalCount)) {
    status = 'Fully Signed';
  } else if (agreementStatus === 'Partially signed' || signedCount > 0) {
    status = 'Partially Signed';
  }

  let summaryText = `0 of ${totalCount} recipient(s) signed.`;
  if (status === 'Rejected') {
    summaryText = `Agreement rejected (${rejectedCount} rejection(s), ${signedCount} of ${totalCount} signed).`;
  } else if (status === 'Fully Signed') {
    summaryText = `All ${totalCount || 1} required recipient(s) completed signing.`;
  } else if (status === 'Partially Signed') {
    summaryText = `Partially signed: ${signedCount} of ${totalCount} recipient(s) signed.`;
  }

  return {
    status,
    signedCount,
    totalCount,
    rejectedCount,
    summaryText,
    disclaimer:
      'This certificate summarizes recorded GSIGN audit events and SHA-256 document hashes. It is not an independent determination of legal validity or enforceability.',
  };
}

export interface LifecycleStageInfo {
  label: string;
  description: string;
  isTerminal: boolean;
  tone: 'emerald' | 'amber' | 'rose' | 'slate' | 'brand';
}

export function getAgreementLifecycleInfo(status: AgreementStatus): LifecycleStageInfo {
  switch (status) {
    case 'Draft':
      return {
        label: 'Draft',
        description: 'Agreement created and editable before sending to recipients.',
        isTerminal: false,
        tone: 'slate',
      };
    case 'Awaiting OTP':
      return {
        label: 'Awaiting OTP',
        description: 'Sent to recipient; awaiting one-time verification challenge.',
        isTerminal: false,
        tone: 'amber',
      };
    case 'Awaiting signature':
      return {
        label: 'Awaiting signature',
        description: 'Active signing link issued; waiting for recipient signature.',
        isTerminal: false,
        tone: 'brand',
      };
    case 'Partially signed':
      return {
        label: 'Partially signed',
        description: 'One or more recipients have signed; remaining signatures pending.',
        isTerminal: false,
        tone: 'amber',
      };
    case 'Completed':
      return {
        label: 'Completed (Fully Signed)',
        description: 'All required signatures recorded and final signed package generated.',
        isTerminal: true,
        tone: 'emerald',
      };
    case 'Rejected':
      return {
        label: 'Rejected',
        description: 'Declined by a recipient; no further signatures can be recorded.',
        isTerminal: true,
        tone: 'rose',
      };
    case 'Expired':
      return {
        label: 'Expired',
        description: 'Signing window elapsed before all required signatures were completed.',
        isTerminal: true,
        tone: 'rose',
      };
    case 'Cancelled':
      return {
        label: 'Cancelled',
        description: 'Cancelled by the issuing organization before completion.',
        isTerminal: true,
        tone: 'slate',
      };
  }
}
