import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

export interface PreparedPdfField {
  id?: string;
  type: string;
  label: string;
  required?: boolean;
  page?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  assignedRole?: string;
  value?: string;
  imageDataUrl?: string;
}

@Injectable()
export class PdfGeneratorService {
  private clamp(val: number, min: number, max: number): number {
    if (!Number.isFinite(val)) return min;
    return Math.min(max, Math.max(min, val));
  }

  private async renderPreparedFieldsOnPdf(
    pdfDoc: PDFDocument,
    fields: PreparedPdfField[] | undefined,
    boldFont: PDFFont,
    regularFont: PDFFont,
  ): Promise<void> {
    if (!Array.isArray(fields) || fields.length === 0) return;

    for (let idx = 0; idx < fields.length; idx++) {
      const f = fields[idx];
      const targetPageNum = Math.max(1, Math.floor(Number(f.page || 1)));
      while (pdfDoc.getPageCount() < targetPageNum) {
        pdfDoc.addPage([595.28, 841.89]);
      }
      const targetPage = pdfDoc.getPage(targetPageNum - 1);
      const { width: pageW, height: pageH } = targetPage.getSize();

      const wPct = this.clamp(Number(f.width ?? 32), 12, 80);
      const hPct = this.clamp(Number(f.height ?? 8), 4, 24);
      const xPct = this.clamp(Number(f.x ?? (idx % 2 === 0 ? 8 : 54)), 2, 98 - wPct);
      const yPct = this.clamp(Number(f.y ?? 72), 8, 96 - hPct);

      const boxW = this.clamp((wPct / 100) * pageW, 60, pageW - 48);
      const boxH = this.clamp((hPct / 100) * pageH, 26, pageH - 96);
      const boxX = this.clamp((xPct / 100) * pageW, 24, pageW - 24 - boxW);
      // Convert top-left percentage Y to PDF bottom-left coordinate
      const topY = pageH - (yPct / 100) * pageH;
      const boxY = this.clamp(topY - boxH, 24, pageH - 64 - boxH);

      const isRequired = Boolean(f.required);
      targetPage.drawRectangle({
        x: boxX,
        y: boxY,
        width: boxW,
        height: boxH,
        borderColor: isRequired ? rgb(37 / 255, 99 / 255, 235 / 255) : rgb(0.58, 0.64, 0.72),
        borderWidth: isRequired ? 1.2 : 0.8,
        color: rgb(0.97, 0.98, 1),
      });

      const title = `${f.label || f.type}${isRequired ? ' *' : ''}`;
      targetPage.drawText(title.slice(0, 32), {
        x: boxX + 6,
        y: boxY + boxH - 12,
        size: 8,
        font: boldFont,
        color: rgb(0.06, 0.09, 0.16),
      });

      const sub = f.value
        ? String(f.value).slice(0, 34)
        : `${f.type} · ${f.assignedRole || 'Recipient'}`;
      targetPage.drawText(sub, {
        x: boxX + 6,
        y: boxY + 6,
        size: 7,
        font: regularFont,
        color: rgb(0.39, 0.45, 0.55),
      });

      if (f.imageDataUrl && typeof f.imageDataUrl === 'string') {
        const imgMatch = f.imageDataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
        if (imgMatch) {
          try {
            const imgType = imgMatch[1].toLowerCase();
            const imgBuf = Buffer.from(imgMatch[2], 'base64');
            if (imgBuf.length > 32) {
              const embedded =
                imgType === 'png'
                  ? await pdfDoc.embedPng(imgBuf)
                  : await pdfDoc.embedJpg(imgBuf);
              const maxW = Math.max(24, boxW * 0.4);
              const maxH = Math.max(18, boxH - 8);
              const dims = embedded.scaleToFit(maxW, maxH);
              targetPage.drawImage(embedded, {
                x: boxX + boxW - dims.width - 4,
                y: boxY + 4,
                width: dims.width,
                height: dims.height,
              });
            }
          } catch {
            // Ignore malformed field image payload
          }
        }
      }
    }
  }
  private wrapText(text: string, maxCharsPerLine = 88): string[] {
    const lines: string[] = [];
    for (const paragraph of (text || '').split(/\r?\n/)) {
      if (!paragraph.trim()) {
        lines.push('');
        continue;
      }
      const words = paragraph.split(/\s+/);
      let current = '';
      for (const word of words) {
        if ((current + ' ' + word).trim().length > maxCharsPerLine) {
          if (current) lines.push(current);
          current = word;
        } else {
          current = (current + ' ' + word).trim();
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  }

  private drawHeader(page: PDFPage, boldFont: PDFFont, regularFont: PDFFont, tenantName: string, subtitle: string) {
    const { width, height } = page.getSize();
    page.drawRectangle({
      x: 0,
      y: height - 56,
      width,
      height: 56,
      color: rgb(91 / 255, 19 / 255, 236 / 255),
    });
    page.drawText(tenantName || 'GSIGN Enterprise', {
      x: 48,
      y: height - 28,
      size: 15,
      font: boldFont,
      color: rgb(1, 1, 1),
    });
    page.drawText(subtitle, {
      x: 48,
      y: height - 45,
      size: 9,
      font: regularFont,
      color: rgb(0.92, 0.92, 1),
    });
  }

  async generateAgreementPdf(params: {
    agreement: any;
    tenantName: string;
    fields?: PreparedPdfField[];
  }): Promise<Buffer> {
    const { agreement, tenantName, fields } = params;
    const pdfDoc = await PDFDocument.create();
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    let page = pdfDoc.addPage([595.28, 841.89]);
    this.drawHeader(page, boldFont, regularFont, tenantName, 'DIGITAL AGREEMENT RECORD');

    let y = 760;
    page.drawText(`${agreement.template_type || 'Agreement'} — ${agreement.agreement_number}`, {
      x: 48,
      y,
      size: 16,
      font: boldFont,
      color: rgb(0.06, 0.09, 0.16),
    });
    y -= 22;

    const metaLines = [
      `Department: ${agreement.department || 'General'}   |   Status: ${agreement.status}`,
      `Primary Recipient: ${agreement.recipient_name} <${agreement.recipient_email}>`,
      `Effective Period: ${agreement.period || '12 months'}   |   Fee: INR ${Number(agreement.fee_amount || 0).toFixed(2)}`,
    ];
    for (const line of metaLines) {
      page.drawText(line, { x: 48, y, size: 10, font: regularFont, color: rgb(0.28, 0.33, 0.41) });
      y -= 15;
    }

    y -= 8;
    page.drawLine({
      start: { x: 48, y },
      end: { x: 547, y },
      thickness: 1,
      color: rgb(0.8, 0.84, 0.88),
    });
    y -= 20;

    page.drawText('AGREEMENT TERMS & CONTENT', {
      x: 48,
      y,
      size: 11,
      font: boldFont,
      color: rgb(0.06, 0.09, 0.16),
    });
    y -= 18;

    for (const line of this.wrapText(agreement.content || '', 88)) {
      if (y < 72) {
        page = pdfDoc.addPage([595.28, 841.89]);
        y = 790;
      }
      if (line) {
        page.drawText(line, { x: 48, y, size: 10, font: regularFont, color: rgb(0.12, 0.16, 0.23) });
      }
      y -= 14;
    }

    if (y < 90) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = 790;
    }
    y -= 14;
    page.drawText(`Content SHA-256: ${agreement.document_hash}`, {
      x: 48,
      y,
      size: 8.5,
      font: regularFont,
      color: rgb(0.39, 0.45, 0.55),
    });
    page.drawText(`Generated At (UTC): ${new Date().toISOString()}`, {
      x: 48,
      y: y - 13,
      size: 8.5,
      font: regularFont,
      color: rgb(0.39, 0.45, 0.55),
    });

    await this.renderPreparedFieldsOnPdf(pdfDoc, fields, boldFont, regularFont);

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }

  async generateSignedAgreementPdf(params: {
    agreement: any;
    tenantName: string;
    recipients: any[];
    signatures: any[];
    consents: any[];
    fields?: PreparedPdfField[];
  }): Promise<Buffer> {
    const { agreement, tenantName, recipients, signatures, consents, fields } = params;
    const pdfDoc = await PDFDocument.create();
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    let page = pdfDoc.addPage([595.28, 841.89]);
    this.drawHeader(page, boldFont, regularFont, tenantName, 'EXECUTED & SIGNED AGREEMENT');

    let y = 760;
    page.drawText(`${agreement.template_type || 'Agreement'} — ${agreement.agreement_number}`, {
      x: 48,
      y,
      size: 16,
      font: boldFont,
      color: rgb(0.06, 0.09, 0.16),
    });
    y -= 22;

    const meta = [
      `Status: ${agreement.status}   |   Department: ${agreement.department || 'General'}`,
      `Primary Recipient: ${agreement.recipient_name} <${agreement.recipient_email}>`,
      `Completed At (UTC): ${agreement.completed_at ? new Date(agreement.completed_at).toISOString() : new Date().toISOString()}`,
    ];
    for (const line of meta) {
      page.drawText(line, { x: 48, y, size: 10, font: regularFont, color: rgb(0.28, 0.33, 0.41) });
      y -= 15;
    }

    y -= 6;
    page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 1, color: rgb(0.8, 0.84, 0.88) });
    y -= 20;

    page.drawText('EXECUTED AGREEMENT TEXT', { x: 48, y, size: 11, font: boldFont, color: rgb(0.06, 0.09, 0.16) });
    y -= 18;

    for (const line of this.wrapText(agreement.content || '', 88)) {
      if (y < 140) {
        page = pdfDoc.addPage([595.28, 841.89]);
        y = 790;
      }
      if (line) {
        page.drawText(line, { x: 48, y, size: 10, font: regularFont, color: rgb(0.12, 0.16, 0.23) });
      }
      y -= 14;
    }

    y -= 14;
    if (y < 130) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = 790;
    }
    page.drawText('VERIFIED ELECTRONIC SIGNATURES', {
      x: 48,
      y,
      size: 11,
      font: boldFont,
      color: rgb(91 / 255, 19 / 255, 236 / 255),
    });
    y -= 16;

    for (const rec of recipients) {
      const sig = signatures.find((s) => s.recipient_id === rec.id);
      const consent = consents.find((c) => c.recipient_id === rec.id);

      if (y < 120) {
        page = pdfDoc.addPage([595.28, 841.89]);
        y = 790;
      }

      const boxHeight = 84;
      const boxBottom = y - boxHeight;
      page.drawRectangle({
        x: 48,
        y: boxBottom,
        width: 499,
        height: boxHeight,
        color: rgb(0.97, 0.98, 0.99),
        borderColor: rgb(0.8, 0.84, 0.88),
        borderWidth: 1,
      });

      page.drawText(`#${rec.signing_order} ${rec.name} (${rec.email})`, {
        x: 60,
        y: y - 16,
        size: 9.5,
        font: boldFont,
        color: rgb(0.06, 0.09, 0.16),
      });
      page.drawText(`Status: ${rec.status}   |   Method: ${rec.sign_method} (Basic electronic signature)`, {
        x: 60,
        y: y - 31,
        size: 8.5,
        font: regularFont,
        color: rgb(0.28, 0.33, 0.41),
      });
      page.drawText(`Email OTP Verified: ${rec.otp_verified_at ? new Date(rec.otp_verified_at).toISOString() : 'N/A'}`, {
        x: 60,
        y: y - 44,
        size: 8.5,
        font: regularFont,
        color: rgb(0.28, 0.33, 0.41),
      });
      page.drawText(`Signed At: ${sig?.signed_at ? new Date(sig.signed_at).toISOString() : 'N/A'}   |   IP: ${sig?.ip_address || 'N/A'}`, {
        x: 60,
        y: y - 57,
        size: 8.5,
        font: regularFont,
        color: rgb(0.28, 0.33, 0.41),
      });
      page.drawText(`Consent: ${consent?.accepted ? 'Accepted' : 'N/A'}`, {
        x: 60,
        y: y - 70,
        size: 8.5,
        font: regularFont,
        color: rgb(0.28, 0.33, 0.41),
      });

      if (sig?.signature_data_url && typeof sig.signature_data_url === 'string') {
        const match = sig.signature_data_url.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
        if (match) {
          try {
            const imgType = match[1].toLowerCase();
            const imgBuf = Buffer.from(match[2], 'base64');
            if (imgBuf.length > 32) {
              const embeddedImage =
                imgType === 'png'
                  ? await pdfDoc.embedPng(imgBuf)
                  : await pdfDoc.embedJpg(imgBuf);
              const dims = embeddedImage.scaleToFit(100, 52);
              page.drawImage(embeddedImage, {
                x: 430,
                y: boxBottom + 16,
                width: dims.width,
                height: dims.height,
              });
            }
          } catch {
            // Ignore malformed image payload
          }
        }
      }

      y = boxBottom - 12;
    }

    page.drawText(`Root Agreement SHA-256: ${agreement.document_hash}`, {
      x: 48,
      y: Math.max(y - 10, 36),
      size: 8,
      font: regularFont,
      color: rgb(0.39, 0.45, 0.55),
    });

    await this.renderPreparedFieldsOnPdf(pdfDoc, fields, boldFont, regularFont);

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }

  async generateCompletionCertificatePdf(params: {
    certificateNumber: string;
    agreement: any;
    tenantName: string;
    recipients: any[];
    signatures: any[];
    consents: any[];
    finalPdfSha256: string;
  }): Promise<Buffer> {
    const {
      certificateNumber,
      agreement,
      tenantName,
      recipients,
      signatures,
      consents,
      finalPdfSha256,
    } = params;

    const pdfDoc = await PDFDocument.create();
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    let page = pdfDoc.addPage([595.28, 841.89]);
    this.drawHeader(page, boldFont, regularFont, tenantName, 'COMPLETION CERTIFICATE & SIGNING RECEIPT');

    let y = 760;
    page.drawText(`Completion Certificate: ${certificateNumber}`, {
      x: 48,
      y,
      size: 15,
      font: boldFont,
      color: rgb(0.06, 0.09, 0.16),
    });
    y -= 24;

    const totalRecipients = recipients.length;
    const signedRecipients = recipients.filter((r) => r.status === 'signed').length;
    const rejectedRecipients = recipients.filter((r) => r.status === 'rejected').length;

    let completionStatus = 'In Progress';
    if (agreement.status === 'Rejected' || rejectedRecipients > 0) {
      completionStatus = 'Rejected';
    } else if (agreement.status === 'Completed' || (totalRecipients > 0 && signedRecipients === totalRecipients)) {
      completionStatus = 'Fully Signed';
    } else if (agreement.status === 'Partially signed' || signedRecipients > 0) {
      completionStatus = 'Partially Signed';
    }

    const summaryLines = [
      `Agreement Number: ${agreement.agreement_number}`,
      `Agreement Completion Status: ${completionStatus} (${signedRecipients}/${totalRecipients} signed)`,
      `Agreement Type: ${agreement.template_type} (${agreement.department})`,
      `Issuer Organization: ${tenantName}`,
      `Issued At (UTC): ${new Date().toISOString()}`,
      `Agreement Content SHA-256: ${agreement.document_hash}`,
      `Final Signed PDF SHA-256: ${finalPdfSha256}`,
      `Audit Notice: Summary of recorded GSIGN events and hashes only; not independent proof of legal validity.`,
    ];
    for (const line of summaryLines) {
      page.drawText(line, { x: 48, y, size: 9.5, font: regularFont, color: rgb(0.2, 0.25, 0.33) });
      y -= 15;
    }

    y -= 14;
    page.drawText('SIGNING PARTIES & AUDIT EVIDENCE', {
      x: 48,
      y,
      size: 11,
      font: boldFont,
      color: rgb(91 / 255, 19 / 255, 236 / 255),
    });
    y -= 18;

    for (const rec of recipients) {
      const sig = signatures.find((s) => s.recipient_id === rec.id);
      const consent = consents.find((c) => c.recipient_id === rec.id);
      if (y < 90) {
        page = pdfDoc.addPage([595.28, 841.89]);
        y = 790;
      }
      page.drawText(`• ${rec.name} <${rec.email}> — Order #${rec.signing_order} (${rec.status})`, {
        x: 48,
        y,
        size: 9.5,
        font: boldFont,
        color: rgb(0.06, 0.09, 0.16),
      });
      y -= 14;
      page.drawText(
        `  OTP Verified: ${rec.otp_verified_at ? new Date(rec.otp_verified_at).toISOString() : 'N/A'} | Signed: ${sig?.signed_at ? new Date(sig.signed_at).toISOString() : 'N/A'} | IP: ${sig?.ip_address || 'N/A'}`,
        { x: 48, y, size: 8.5, font: regularFont, color: rgb(0.28, 0.33, 0.41) },
      );
      y -= 13;
      page.drawText(
        `  Consent Recorded: ${consent?.consented_at ? new Date(consent.consented_at).toISOString() : 'N/A'} | Method: ${sig?.signing_method || rec.signing_method || 'N/A'}`,
        {
          x: 48,
          y,
          size: 8.5,
          font: regularFont,
          color: rgb(0.28, 0.33, 0.41),
        },
      );
      y -= 18;
    }

    const footerStatement =
      completionStatus === 'Fully Signed'
        ? 'This certificate summarizes recorded GSIGN verification, consent, and signing events for a fully signed agreement. It does not independently establish legal validity.'
        : `Status: ${completionStatus}. This certificate summarizes recorded GSIGN events only and does not independently establish legal validity.`;

    page.drawText(footerStatement, {
      x: 48,
      y: Math.max(y - 10, 40),
      size: 8,
      font: regularFont,
      color: rgb(0.39, 0.45, 0.55),
    });

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }
}
