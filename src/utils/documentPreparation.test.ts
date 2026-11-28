import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPercentage,
  normalizeFieldCoordinates,
  computeClickCoordinates,
  renderTemplateContent,
  validateAgreementPreparation,
  buildAgreementPreviewModel,
  isSigningMethodSupported,
} from './documentPreparation.ts';
import { canSignAgreementStatus } from './agreementUi.ts';

describe('Phase 5B: Document Preparation, Coordinates, Preview & Validation', () => {
  it('computes normalized percentage coordinates that stay consistent across screen sizes', () => {
    const mobileClick = computeClickCoordinates({
      clientX: 150,
      clientY: 250,
      rectLeft: 0,
      rectTop: 0,
      rectWidth: 300,
      rectHeight: 500,
      fieldWidthPct: 38,
      fieldHeightPct: 11,
    });
    const desktopClick = computeClickCoordinates({
      clientX: 300,
      clientY: 500,
      rectLeft: 0,
      rectTop: 0,
      rectWidth: 600,
      rectHeight: 1000,
      fieldWidthPct: 38,
      fieldHeightPct: 11,
    });

    assert.deepEqual(mobileClick, desktopClick);
    assert.deepEqual(mobileClick, { x: 50, y: 50 });
    assert.equal(clampPercentage(150, 2, 90), 90);
    assert.equal(clampPercentage(-10, 2, 90), 2);
  });

  it('normalizes legacy template fields with default page, coordinates, and recipient role', () => {
    const normalized = normalizeFieldCoordinates(
      { id: 'f1', type: 'Signature', label: 'Signer', required: true },
      0,
    );
    assert.equal(normalized.page, 1);
    assert.equal(normalized.assignedRole, 'Recipient');
    assert.ok(normalized.x >= 2 && normalized.x <= 90);
    assert.ok(normalized.y >= 2 && normalized.y <= 90);
  });

  it('renders template placeholders accurately for agreement content and preview', () => {
    const rendered = renderTemplateContent(
      'Offer to {{recipient_name}} for {{fee_amount}} over {{period}}.',
      { recipientName: 'Alok Verma', feeAmount: 50000, period: '12 months' },
    );
    assert.equal(rendered, 'Offer to Alok Verma for ₹50,000 over 12 months.');
  });

  it('validates required recipient details, content length, and required signature/initials field', () => {
    const errors = validateAgreementPreparation({
      recipientName: '',
      recipientEmail: 'invalid-email',
      recipientPhone: '123',
      templateType: 'Offer Letter',
      content: 'Short',
      fields: [{ id: 'f1', type: 'Text', label: 'Note', required: false }],
    });

    assert.equal(errors.length, 5);

    const validErrors = validateAgreementPreparation({
      recipientName: 'Alok Verma',
      recipientEmail: 'alok@example.com',
      recipientPhone: '+91 9876543210',
      templateType: 'Offer Letter',
      content: 'This offer is made to Alok Verma for 12 months.',
      fields: [{ id: 'f1', type: 'Signature', label: 'Recipient Signature', required: true }],
    });
    assert.deepEqual(validErrors, []);
  });

  it('builds a PRE_SEND_DRAFT preview model that never claims sent or signed', () => {
    const preview = buildAgreementPreviewModel({
      recipientName: 'Meera Iyer',
      recipientEmail: 'meera@acme.in',
      recipientPhone: '+91 9811111111',
      templateType: 'NDA',
      department: 'Legal',
      feeAmount: 0,
      period: '24 months',
      signMethod: 'otp_verified',
      rawContent: 'NDA with {{recipient_name}} for {{period}}.',
      fields: [
        { id: 'f1', type: 'Signature', label: 'Signature', required: true, x: 10, y: 75 },
        { id: 'f2', type: 'Date', label: 'Date', required: false, x: 55, y: 75 },
      ],
    });

    assert.equal(preview.previewStatus, 'PRE_SEND_DRAFT');
    assert.match(preview.previewBanner, /Not yet sent or signed/i);
    assert.equal(preview.renderedContent, 'NDA with Meera Iyer for 24 months.');
    assert.equal(preview.requiredFieldsCount, 1);
    assert.equal(preview.normalizedFields.length, 2);
  });

  it('blocks signing actions on terminal agreement states', () => {
    assert.equal(canSignAgreementStatus('Completed'), false);
    assert.equal(canSignAgreementStatus('Cancelled'), false);
    assert.equal(canSignAgreementStatus('Rejected'), false);
    assert.equal(canSignAgreementStatus('Expired'), false);
    assert.equal(canSignAgreementStatus('Awaiting signature'), true);
  });

  it('marks only basic_drawn and otp_verified as supported signing methods', () => {
    assert.equal(isSigningMethodSupported('basic_drawn'), true);
    assert.equal(isSigningMethodSupported('otp_verified'), true);
    assert.equal(isSigningMethodSupported('aadhaar_esign'), false);
    assert.equal(isSigningMethodSupported('dsc'), false);
  });
});
