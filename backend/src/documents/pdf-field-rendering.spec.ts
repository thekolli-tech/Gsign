import { PDFDocument } from 'pdf-lib';
import { PdfGeneratorService } from './pdf-generator.service';

describe('PdfGeneratorService — Real PDF Field Rendering & Multi-Page Coordinates', () => {
  const service = new PdfGeneratorService();
  const baseAgreement = {
    agreement_number: 'AGR-2026-0042',
    template_type: 'Offer Letter',
    department: 'HR',
    status: 'Awaiting signature',
    recipient_name: 'Alok Verma',
    recipient_email: 'alok@example.com',
    period: '12 months',
    fee_amount: 50000,
    content: 'This offer is made to Alok Verma for 12 months.',
    document_hash: 'a'.repeat(64),
  };

  it('generates a valid backward-compatible PDF when fields are omitted', async () => {
    const buf = await service.generateAgreementPdf({
      agreement: baseAgreement,
      tenantName: 'Acme Corp',
    });

    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    const parsed = await PDFDocument.load(buf);
    expect(parsed.getPageCount()).toBe(1);
  });

  it('renders single-page and multi-page fields and clamps out-of-bounds coordinates safely', async () => {
    const buf = await service.generateAgreementPdf({
      agreement: baseAgreement,
      tenantName: 'Acme Corp',
      fields: [
        {
          id: 'f-sig',
          type: 'Signature',
          label: 'Recipient Signature',
          required: true,
          page: 1,
          x: 8,
          y: 74,
          width: 38,
          height: 11,
          assignedRole: 'Recipient',
        },
        {
          id: 'f-page2-date',
          type: 'Date',
          label: 'Page 2 Date',
          required: true,
          page: 2,
          x: 200, // out-of-bounds, must be clamped safely
          y: -15, // out-of-bounds, must be clamped safely
          width: 26,
          height: 7,
          assignedRole: 'Recipient',
        },
        {
          id: 'f-page3-check',
          type: 'Checkbox',
          label: 'Schedule A Consent',
          required: false,
          page: 3,
          x: 10,
          y: 20,
          width: 28,
          height: 6,
          assignedRole: 'Witness',
        },
      ],
    });

    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    const parsed = await PDFDocument.load(buf);
    expect(parsed.getPageCount()).toBe(3);
  });

  it('renders a Thumb Impression field with an embedded PNG image into the generated PDF', async () => {
    const valid1x1PngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const thumbDataUrl = `data:image/png;base64,${valid1x1PngBase64}`;

    const buf = await service.generateAgreementPdf({
      agreement: baseAgreement,
      tenantName: 'Acme Corp',
      fields: [
        {
          id: 'f-thumb',
          type: 'Thumb Impression',
          label: 'Right Thumb Impression',
          required: true,
          page: 1,
          x: 10,
          y: 72,
          width: 34,
          height: 12,
          assignedRole: 'Recipient',
          imageDataUrl: thumbDataUrl,
        },
      ],
    });

    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    const parsed = await PDFDocument.load(buf);
    expect(parsed.getPageCount()).toBe(1);
  });
});
