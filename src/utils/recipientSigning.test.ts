import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampZoomLevel,
  paginateDocumentContent,
  computeSigningProgress,
  validateRecipientFieldResponses,
  getCompletionBannerState,
} from './recipientSigning.ts';

describe('Phase 5C: Recipient Signing Experience Helpers', () => {
  it('clamps zoom levels cleanly between 75% and 150% in 25% steps', () => {
    assert.equal(clampZoomLevel(50), 75);
    assert.equal(clampZoomLevel(100), 100);
    assert.equal(clampZoomLevel(125), 125);
    assert.equal(clampZoomLevel(200), 150);
  });

  it('paginates long agreement content into multiple readable pages', () => {
    const longText = Array.from({ length: 120 }, (_, i) => `ClauseWord${i}`).join(' ');
    const pages = paginateDocumentContent(longText, 300);
    assert.ok(pages.length > 1);
    assert.ok(pages.every((p) => p.length > 0));
  });

  it('computes multi-signer progress and identifies the next pending required signer', () => {
    const progress = computeSigningProgress([
      { name: 'Alice', email: 'alice@acme.in', signing_order: 1, is_required: true, status: 'SIGNED' },
      { name: 'Bob', email: 'bob@acme.in', signing_order: 2, is_required: true, status: 'PENDING' },
      { name: 'Carol', email: 'carol@acme.in', signing_order: 3, is_required: false, status: 'PENDING' },
    ]);

    assert.equal(progress.totalSigners, 2);
    assert.equal(progress.signedCount, 1);
    assert.equal(progress.pendingCount, 1);
    assert.equal(progress.percentComplete, 50);
    assert.equal(progress.isPartiallySigned, true);
    assert.equal(progress.isFullyCompleted, false);
    assert.equal(progress.nextSigner?.email, 'bob@acme.in');
  });

  it('validates required recipient fields and excludes non-recipient fields from recipient submission', () => {
    const fields = [
      { id: 'f-init', type: 'Initials' as const, label: 'Initials', required: true, assignedRole: 'Recipient' as const },
      { id: 'f-date', type: 'Date' as const, label: 'Date', required: true, assignedRole: 'Recipient' as const },
      { id: 'f-chk', type: 'Checkbox' as const, label: 'Confirm Authority', required: true, assignedRole: 'Recipient' as const },
      { id: 'f-wit', type: 'Witness' as const, label: 'Witness Signature', required: true, assignedRole: 'Witness' as const },
    ];

    const invalid = validateRecipientFieldResponses(fields, {
      'f-init': { value: '' },
      'f-date': { value: '2026-11-28' },
      'f-chk': { checked: false },
    });
    assert.equal(invalid.valid, false);
    assert.equal(invalid.errors.length, 2);

    const valid = validateRecipientFieldResponses(fields, {
      'f-init': { value: 'AV' },
      'f-date': { value: '2026-11-28' },
      'f-chk': { checked: true },
    });
    assert.equal(valid.valid, true);
    assert.equal(valid.payloads.length, 3);
    assert.equal(valid.payloads.some((p) => p.field_id === 'f-wit'), false);
  });

  it('distinguishes partially signed agreements from fully completed agreements', () => {
    const partial = getCompletionBannerState({
      submitResult: {
        agreement_completed: false,
        agreement_status: 'Partially signed',
        next_signer: { name: 'Bob', email: 'bob@acme.in', signing_order: 2 },
      },
      portalData: {
        recipients_progress: [
          { name: 'Alice', email: 'alice@acme.in', signing_order: 1, is_required: true, status: 'SIGNED' },
          { name: 'Bob', email: 'bob@acme.in', signing_order: 2, is_required: true, status: 'PENDING' },
        ],
      },
    });
    assert.equal(partial.isCompleted, false);
    assert.match(partial.subtext, /Bob/);

    const completed = getCompletionBannerState({
      submitResult: {
        agreement_completed: true,
        agreement_status: 'Completed',
        next_signer: null,
      },
      portalData: {
        recipients_progress: [
          { name: 'Alice', email: 'alice@acme.in', signing_order: 1, is_required: true, status: 'SIGNED' },
        ],
      },
    });
    assert.equal(completed.isCompleted, true);
    assert.match(completed.headline, /completed/i);
  });
});
