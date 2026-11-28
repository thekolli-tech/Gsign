import * as crypto from 'crypto';

export interface CheckoutTokenPayload {
  registration_id: string;
  admin_email: string;
  exp: number;
}

function getCheckoutTokenSecret(): string {
  return (
    process.env.CHECKOUT_TOKEN_SECRET ||
    process.env.SESSION_SECRET ||
    'gsign-dev-checkout-token-secret-do-not-use-in-prod'
  );
}

export function createCheckoutAccessToken(
  registrationId: string,
  adminEmail: string,
  ttlSeconds = 7200,
): string {
  const payload: CheckoutTokenPayload = {
    registration_id: registrationId,
    admin_email: adminEmail.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getCheckoutTokenSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyCheckoutAccessToken(
  token: string,
  expectedRegistrationId?: string,
  expectedAdminEmail?: string,
): CheckoutTokenPayload {
  if (!token || !token.includes('.')) {
    throw new Error('Invalid checkout access token.');
  }
  const [encoded, sig] = token.split('.', 2);
  if (!encoded || !sig) {
    throw new Error('Malformed checkout access token.');
  }
  const expectedSig = crypto
    .createHmac('sha256', getCheckoutTokenSecret())
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Invalid checkout access token signature.');
  }

  let parsed: CheckoutTokenPayload;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Corrupted checkout access token.');
  }

  if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Checkout access token has expired.');
  }
  if (expectedRegistrationId && parsed.registration_id !== expectedRegistrationId) {
    throw new Error('Checkout access token does not match registration.');
  }
  if (expectedAdminEmail && parsed.admin_email !== expectedAdminEmail.trim().toLowerCase()) {
    throw new Error('Checkout access token does not match registrant email.');
  }
  return parsed;
}
