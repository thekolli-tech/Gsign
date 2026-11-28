import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Agreement, AuditEvent } from '../types.ts';
import {
  buildCompletionCertificateSummary,
  buildManagedDocumentRows,
  buildSanitizedAuditTimeline,
  filterAndSortDocuments,
  getAgreementLifecycleInfo,
  type StoredDocumentItem,
} from './documentManagement.ts';

const sampleAgreements: Agreement[] = [
  {
    id: 'AGR-2026-0101',
    recipientName: 'Aarav Mehta',
    recipientEmail: 'aarav@acme.in',
    recipientPhone: '+91 9876543210',
    templateType: 'Offer Letter',
    department: 'HR',
    status: 'Completed',
    createdAt: '2026-01-10T09:00:00.000Z',
    updatedAt: '2026-01-12T15:30:00.000Z',
    feeAmount: 85000,
    period: '12 months',
    content: 'Offer terms',
    signMethod: 'otp_verified',
    documentHash: 'abc123def456',
    auditTrail: [
      {
        id: 'ev-2',
        title: 'Agreement Signed',
        description: 'Signed by Aarav',
        timestamp: '2026-01-12T15:30:00.000Z',
        type: 'signed',
      },
      {
        id: 'ev-1',
        title: 'Agreement Created',
        description: 'Created by HR Admin',
        timestamp: '2026-01-10T09:00:00.000Z',
        type: 'created',
      },
    ],
  },
  {
    id: 'AGR-2026-0102',
    recipientName: 'Priya Nair',
    recipientEmail: 'priya@vendor.io',
    recipientPhone: '+91 9123456789',
    templateType: 'NDA',
    department: 'Legal',
    status: 'Partially signed',
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt: '2026-02-05T11:00:00.000Z',
    feeAmount: 0,
    period: '24 months',
    content: 'NDA terms',
    signMethod: 'basic_drawn',
    documentHash: 'fff999eee888',
    auditTrail: [],
  },
  {
    id: 'AGR-2026-0103',
    recipientName: 'Rohan Kapoor',
    recipientEmail: 'rohan@partner.co',
    recipientPhone: '+91 9000011111',
    templateType: 'Vendor Agreement',
    department: 'Ops',
    status: 'Rejected',
    createdAt: '2026-03-01T08:00:00.000Z',
    updatedAt: '2026-03-02T12:00:00.000Z',
    feeAmount: 50000,
    period: '6 months',
    content: 'Vendor terms',
    signMethod: 'otp_verified',
    documentHash: '111222333444',
    auditTrail: [],
  },
];

const sampleDocs: StoredDocumentItem[] = [
  {
    id: 'doc-1',
    agreement_id: 'AGR-2026-0101',
    title: 'Aarav Mehta — Offer Letter',
    doc_kind: 'signed_pdf',
    current_version: 2,
    created_at: '2026-01-10T09:00:00.000Z',
    updated_at: '2026-01-12T15:30:00.000Z',
    versions: [
      {
        id: 'ver-1b',
        version_number: 2,
        file_name: 'offer-signed.pdf',
        sha256_hash: 'aaaa1111bbbb2222cccc3333dddd4444',
        created_at: '2026-01-12T15:30:00.000Z',
      },
      {
        id: 'ver-1a',
        version_number: 1,
        file_name: 'offer-draft.pdf',
        sha256_hash: '00001111222233334444555566667777',
        created_at: '2026-01-10T09:00:00.000Z',
      },
    ],
  },
  {
    id: 'doc-2',
    agreement_id: 'AGR-2026-0102',
    title: 'Priya Nair — Mutual NDA',
    doc_kind: 'generated_pdf',
    current_version: 1,
    created_at: '2026-02-01T10:00:00.000Z',
    updated_at: '2026-02-05T11:00:00.000Z',
    versions: [
      {
        id: 'ver-2a',
        version_number: 1,
        file_name: 'nda.pdf',
        sha256_hash: '99998888777766665555444433332222',
        created_at: '2026-02-01T10:00:00.000Z',
      },
    ],
  },
  {
    id: 'doc-3',
    agreement_id: 'AGR-2026-0103',
    title: 'Rohan Kapoor — Vendor Contract',
    doc_kind: 'original',
    current_version: 1,
    created_at: '2026-03-01T08:00:00.000Z',
    updated_at: '2026-03-02T12:00:00.000Z',
    versions: [
      {
        id: 'ver-3a',
        version_number: 1,
        file_name: 'vendor.pdf',
        sha256_hash: '1234567890abcdef1234567890abcdef',
        created_at: '2026-03-01T08:00:00.000Z',
      },
    ],
  },
];

describe('documentManagement helpers', () => {
  it('filters by search query (agreement name, recipient, reference), status, category, and date range', () => {
    const rows = buildManagedDocumentRows(sampleDocs, sampleAgreements);

    assert.deepEqual(
      filterAndSortDocuments(rows, { search: 'AGR-2026-0102' }).items.map((r) => r.doc.id),
      ['doc-2'],
    );
    assert.deepEqual(
      filterAndSortDocuments(rows, { search: 'priya@vendor.io' }).items.map((r) => r.doc.id),
      ['doc-2'],
    );
    assert.deepEqual(
      filterAndSortDocuments(rows, { status: 'Signed' }).items.map((r) => r.doc.id),
      ['doc-1'],
    );
    assert.deepEqual(
      filterAndSortDocuments(rows, { status: 'Unsigned' }).items.map((r) => r.doc.id),
      ['doc-3', 'doc-2'],
    );
    assert.deepEqual(
      filterAndSortDocuments(rows, { status: 'Rejected' }).items.map((r) => r.doc.id),
      ['doc-3'],
    );
    assert.deepEqual(
      filterAndSortDocuments(rows, { category: 'NDA' }).items.map((r) => r.doc.id),
      ['doc-2'],
    );
    assert.deepEqual(
      filterAndSortDocuments(rows, { dateFrom: '2026-02-01', dateTo: '2026-02-28' }).items.map((r) => r.doc.id),
      ['doc-2'],
    );
  });

  it('sorts by created, updated, and signed dates and paginates accurately', () => {
    const rows = buildManagedDocumentRows(sampleDocs, sampleAgreements);

    assert.deepEqual(
      filterAndSortDocuments(rows, { sortBy: 'created_asc' }).items.map((r) => r.doc.id),
      ['doc-1', 'doc-2', 'doc-3'],
    );
    assert.deepEqual(
      filterAndSortDocuments(rows, { sortBy: 'updated_desc' }).items.map((r) => r.doc.id),
      ['doc-3', 'doc-2', 'doc-1'],
    );
    assert.equal(
      filterAndSortDocuments(rows, { sortBy: 'signed_desc' }).items[0].doc.id,
      'doc-1',
    );

    const page1 = filterAndSortDocuments(rows, { sortBy: 'created_asc', page: 1, pageSize: 2 });
    const page2 = filterAndSortDocuments(rows, { sortBy: 'created_asc', page: 2, pageSize: 2 });
    assert.equal(page1.totalItems, 3);
    assert.equal(page1.totalPages, 2);
    assert.deepEqual(page1.items.map((r) => r.doc.id), ['doc-1', 'doc-2']);
    assert.deepEqual(page2.items.map((r) => r.doc.id), ['doc-3']);
  });

  it('orders audit trail chronologically, flags unsupported types, and redacts secrets', () => {
    const events: AuditEvent[] = [
      {
        id: 'e2',
        title: 'OTP Verified',
        description: 'otp=482910 verification_token=tok_secret_123 biometric_template=raw_xyz',
        timestamp: '2026-01-12T15:00:00.000Z',
        type: 'otp',
      },
      {
        id: 'e1',
        title: 'Legacy Event',
        description: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig',
        timestamp: '2026-01-10T09:00:00.000Z',
        type: 'legacy_unknown' as AuditEvent['type'],
      },
    ];

    const timeline = buildSanitizedAuditTimeline(events, 'asc');
    assert.deepEqual(timeline.map((e) => e.id), ['e1', 'e2']);
    assert.equal(timeline[0].category, 'unsupported');
    assert.equal(timeline[1].category, 'recorded');
    assert.equal(timeline[0].description.includes('eyJhbGciOiJIUzI1NiJ9'), false);
    assert.equal(timeline[1].description.includes('482910'), false);
    assert.equal(timeline[1].description.includes('tok_secret_123'), false);
    assert.equal(timeline[1].description.includes('raw_xyz'), false);
    assert.equal(timeline[1].description.includes('[REDACTED]'), true);
  });

  it('distinguishes Fully Signed, Partially Signed, and Rejected completion certificate summaries', () => {
    const full = buildCompletionCertificateSummary('Completed', [
      { name: 'A', email: 'a@x.com', status: 'signed' },
      { name: 'B', email: 'b@x.com', status: 'signed' },
    ]);
    assert.equal(full.status, 'Fully Signed');
    assert.equal(full.disclaimer.toLowerCase().includes('not an independent determination of legal validity'), true);

    const partial = buildCompletionCertificateSummary('Partially signed', [
      { name: 'A', email: 'a@x.com', status: 'signed' },
      { name: 'B', email: 'b@x.com', status: 'pending' },
    ]);
    assert.equal(partial.status, 'Partially Signed');
    assert.equal(partial.signedCount, 1);
    assert.equal(partial.totalCount, 2);

    const rejected = buildCompletionCertificateSummary('Rejected', [
      { name: 'A', email: 'a@x.com', status: 'signed' },
      { name: 'B', email: 'b@x.com', status: 'rejected' },
    ]);
    assert.equal(rejected.status, 'Rejected');
    assert.equal(rejected.rejectedCount, 1);
  });

  it('maps agreement lifecycle states accurately', () => {
    assert.equal(getAgreementLifecycleInfo('Draft').isTerminal, false);
    assert.equal(getAgreementLifecycleInfo('Completed').isTerminal, true);
    assert.equal(getAgreementLifecycleInfo('Rejected').tone, 'rose');
  });
});
