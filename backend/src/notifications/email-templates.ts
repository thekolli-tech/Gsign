export type NotificationTemplateKey =
  | 'email_verification'
  | 'password_reset'
  | 'employee_invitation'
  | 'agreement_sent'
  | 'agreement_signed'
  | 'agreement_completed'
  | 'payment_confirmation'
  | 'payment_failure'
  | 'company_registration_ack'
  | 'contact_sales_ack'
  | 'signing_otp';

export type NotificationPayloadMap = {
  email_verification: { recipientName: string; companyName: string; verifyUrl: string };
  password_reset: { recipientName: string; otp: string; expiresMinutes?: number };
  employee_invitation: { tenantName: string; roleName: string; department: string; inviteUrl: string };
  agreement_sent: {
    recipientName: string;
    agreementTitle: string;
    agreementNumber: string;
    signingUrl: string;
    expiresAtText?: string;
    isReminder?: boolean;
  };
  agreement_signed: { recipientName: string; signerName: string; agreementNumber: string; agreementTitle: string };
  agreement_completed: { recipientName: string; agreementNumber: string; agreementTitle: string };
  payment_confirmation: { recipientName: string; companyName: string; planName: string; amountInr: number; checkoutReference: string };
  payment_failure: { recipientName: string; companyName: string; planName: string; checkoutReference: string; reason?: string };
  company_registration_ack: { recipientName: string; companyName: string };
  contact_sales_ack: { recipientName: string; companyName: string; requestedPlan: string };
  signing_otp: { recipientName: string; agreementNumber: string; agreementTitle: string; otp: string };
};

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapLayout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <div style="background:#0f172a;color:#ffffff;padding:18px 24px;">
      <div style="font-size:16px;font-weight:700;letter-spacing:0.4px;">GSIGN</div>
      <div style="font-size:12px;color:#cbd5e1;margin-top:2px;">${escapeHtml(title)}</div>
    </div>
    <div style="padding:24px;font-size:14px;line-height:1.6;color:#334155;">
      ${bodyHtml}
    </div>
    <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;">
      Powered by Genemax IT Solution Private Limited &bull; GSIGN Enterprise Platform
    </div>
  </div>
</body>
</html>`;
}

export function renderEmailTemplate<K extends NotificationTemplateKey>(
  key: K,
  data: NotificationPayloadMap[K],
): RenderedEmail {
  switch (key) {
    case 'email_verification': {
      const p = data as NotificationPayloadMap['email_verification'];
      const subject = 'Verify Your GSIGN Company Registration';
      return {
        subject,
        html: wrapLayout(
          subject,
          `<p>Hello ${escapeHtml(p.recipientName)},</p>
           <p>Thank you for registering <strong>${escapeHtml(p.companyName)}</strong> on GSIGN.</p>
           <p>Click the button below to verify your work email address (expires in 24 hours):</p>
           <p style="margin:20px 0;"><a href="${escapeHtml(p.verifyUrl)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Verify Company Email</a></p>
           <p style="font-size:12px;color:#64748b;">If you did not initiate this registration, you can safely ignore this email.</p>`,
        ),
        text: `Hello ${p.recipientName}, verify your GSIGN registration for ${p.companyName}: ${p.verifyUrl}`,
      };
    }

    case 'password_reset': {
      const p = data as NotificationPayloadMap['password_reset'];
      const mins = p.expiresMinutes ?? 10;
      const subject = 'GSIGN Password Reset Verification Code';
      return {
        subject,
        html: wrapLayout(
          subject,
          `<p>Hello ${escapeHtml(p.recipientName || 'User')},</p>
           <p>Use the verification code below to reset your GSIGN password:</p>
           <div style="margin:18px 0;padding:14px;background:#f1f5f9;border-radius:8px;text-align:center;font-size:24px;font-weight:700;letter-spacing:6px;color:#0f172a;">${escapeHtml(p.otp)}</div>
           <p style="font-size:12px;color:#64748b;">This code expires in ${mins} minutes. Do not share it with anyone.</p>`,
        ),
        text: `Hello ${p.recipientName || 'User'}, your GSIGN password reset code is ${p.otp} (expires in ${mins} minutes).`,
      };
    }

    case 'employee_invitation': {
      const p = data as NotificationPayloadMap['employee_invitation'];
      const subject = `You're invited to join ${p.tenantName} on GSIGN`;
      return {
        subject,
        html: wrapLayout(
          'Workspace Invitation',
          `<p>Hello,</p>
           <p>You have been invited to join <strong>${escapeHtml(p.tenantName)}</strong> on GSIGN as <strong>${escapeHtml(p.roleName)}</strong> (${escapeHtml(p.department)}).</p>
           <p style="margin:20px 0;"><a href="${escapeHtml(p.inviteUrl)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Accept Workspace Invitation</a></p>
           <p style="font-size:12px;color:#64748b;">This invitation expires in 7 days.</p>`,
        ),
        text: `You are invited to join ${p.tenantName} on GSIGN as ${p.roleName} (${p.department}): ${p.inviteUrl}`,
      };
    }

    case 'agreement_sent': {
      const p = data as NotificationPayloadMap['agreement_sent'];
      const subject = p.isReminder
        ? `Reminder — Signature Requested: ${p.agreementTitle} (${p.agreementNumber})`
        : `Signature Requested: ${p.agreementTitle} (${p.agreementNumber})`;
      return {
        subject,
        html: wrapLayout(
          p.isReminder ? 'Signature Reminder' : 'Signature Requested',
          `<p>Hello ${escapeHtml(p.recipientName)},</p>
           <p>${p.isReminder ? 'This is a reminder to review and sign' : 'You have been invited to review and sign'} <strong>${escapeHtml(p.agreementTitle)}</strong> (${escapeHtml(p.agreementNumber)}).</p>
           <p style="margin:20px 0;"><a href="${escapeHtml(p.signingUrl)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Open Secure Signing Portal</a></p>
           ${p.expiresAtText ? `<p style="font-size:12px;color:#64748b;">This link expires at ${escapeHtml(p.expiresAtText)}.</p>` : ''}`,
        ),
        text: `Hello ${p.recipientName}, please review and sign ${p.agreementTitle} (${p.agreementNumber}): ${p.signingUrl}`,
      };
    }

    case 'agreement_signed': {
      const p = data as NotificationPayloadMap['agreement_signed'];
      const subject = `Agreement Signed: ${p.agreementNumber}`;
      return {
        subject,
        html: wrapLayout(
          'Signatory Action Recorded',
          `<p>Hello ${escapeHtml(p.recipientName)},</p>
           <p><strong>${escapeHtml(p.signerName)}</strong> has signed <strong>${escapeHtml(p.agreementTitle)}</strong> (${escapeHtml(p.agreementNumber)}).</p>`,
        ),
        text: `${p.signerName} has signed ${p.agreementTitle} (${p.agreementNumber}).`,
      };
    }

    case 'agreement_completed': {
      const p = data as NotificationPayloadMap['agreement_completed'];
      const subject = `Agreement Completed: ${p.agreementNumber}`;
      return {
        subject,
        html: wrapLayout(
          'Agreement Finalized',
          `<p>Hello ${escapeHtml(p.recipientName)},</p>
           <p>All required signatures have been collected for <strong>${escapeHtml(p.agreementTitle)}</strong> (${escapeHtml(p.agreementNumber)}). Your completion certificate is ready in GSIGN.</p>`,
        ),
        text: `Agreement ${p.agreementTitle} (${p.agreementNumber}) is now completed.`,
      };
    }

    case 'payment_confirmation': {
      const p = data as NotificationPayloadMap['payment_confirmation'];
      const subject = `Payment Confirmed — ${p.companyName} (${p.checkoutReference})`;
      return {
        subject,
        html: wrapLayout(
          'Subscription Payment Confirmed',
          `<p>Hello ${escapeHtml(p.recipientName)},</p>
           <p>We have verified your payment of <strong>INR ${Number(p.amountInr).toLocaleString('en-IN')}</strong> for <strong>${escapeHtml(p.planName)}</strong> (Reference: <code>${escapeHtml(p.checkoutReference)}</code>).</p>
           <p>Your <strong>${escapeHtml(p.companyName)}</strong> workspace is now active.</p>`,
        ),
        text: `Payment confirmed for ${p.companyName} (${p.planName}, INR ${p.amountInr}, ref ${p.checkoutReference}).`,
      };
    }

    case 'payment_failure': {
      const p = data as NotificationPayloadMap['payment_failure'];
      const subject = `Payment Failed — ${p.companyName} (${p.checkoutReference})`;
      return {
        subject,
        html: wrapLayout(
          'Subscription Payment Failed',
          `<p>Hello ${escapeHtml(p.recipientName)},</p>
           <p>Your payment attempt for <strong>${escapeHtml(p.planName)}</strong> (Reference: <code>${escapeHtml(p.checkoutReference)}</code>) could not be completed${p.reason ? `: ${escapeHtml(p.reason)}` : '.'}</p>
           <p>You can retry checkout from the GSIGN registration portal.</p>`,
        ),
        text: `Payment failed for ${p.companyName} (${p.planName}, ref ${p.checkoutReference}).`,
      };
    }

    case 'company_registration_ack': {
      const p = data as NotificationPayloadMap['company_registration_ack'];
      const subject = `Registration Received — ${p.companyName}`;
      return {
        subject,
        html: wrapLayout(
          'Company Registration Received',
          `<p>Hello ${escapeHtml(p.recipientName)},</p>
           <p>We have received the workspace registration for <strong>${escapeHtml(p.companyName)}</strong>. Please complete email verification and plan checkout to activate access.</p>`,
        ),
        text: `Company registration received for ${p.companyName}.`,
      };
    }

    case 'contact_sales_ack': {
      const p = data as NotificationPayloadMap['contact_sales_ack'];
      const subject = `Enterprise Inquiry Received — ${p.companyName}`;
      return {
        subject,
        html: wrapLayout(
          'Enterprise Sales Inquiry',
          `<p>Hello ${escapeHtml(p.recipientName)},</p>
           <p>Thank you for contacting GSIGN Enterprise Sales regarding <strong>${escapeHtml(p.requestedPlan)}</strong> for <strong>${escapeHtml(p.companyName)}</strong>. Our team will reach out shortly.</p>`,
        ),
        text: `Thank you ${p.recipientName}, we received your enterprise inquiry for ${p.companyName} (${p.requestedPlan}).`,
      };
    }

    case 'signing_otp': {
      const p = data as NotificationPayloadMap['signing_otp'];
      const subject = `Your GSIGN Verification Code — ${p.agreementNumber}`;
      return {
        subject,
        html: wrapLayout(
          'Signing Verification Code',
          `<p>Hello ${escapeHtml(p.recipientName)},</p>
           <p>Use the following 6-digit verification code to unlock <strong>${escapeHtml(p.agreementTitle)}</strong>:</p>
           <div style="margin:18px 0;padding:14px;background:#f1f5f9;border-radius:8px;text-align:center;font-size:24px;font-weight:700;letter-spacing:6px;color:#0f172a;">${escapeHtml(p.otp)}</div>
           <p style="font-size:12px;color:#64748b;">This code expires in 10 minutes. Do not share it with anyone.</p>`,
        ),
        text: `Hello ${p.recipientName}, your GSIGN signing verification code for ${p.agreementNumber} is ${p.otp}.`,
      };
    }
  }
}
