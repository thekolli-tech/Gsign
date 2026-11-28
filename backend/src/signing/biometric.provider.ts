import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as crypto from 'crypto';

export type BiometricProviderCategory =
  | 'device_webauthn'
  | 'dedicated_scanner'
  | 'approved_service';

export interface BiometricAdapterStatus {
  category: BiometricProviderCategory;
  available: boolean;
  label: string;
  reason?: string;
}

export interface BiometricScannerAdapter {
  getCategory(): BiometricProviderCategory;
  isAvailable(): boolean;
  getStatus(): BiometricAdapterStatus;
  verifyCapture(payload: Record<string, any>): Promise<{
    verified: boolean;
    referenceId: string;
    providerCategory: BiometricProviderCategory;
  }>;
}

@Injectable()
export class DedicatedFingerprintScannerAdapter implements BiometricScannerAdapter {
  getCategory(): BiometricProviderCategory {
    return 'dedicated_scanner';
  }

  isAvailable(): boolean {
    return process.env.BIOMETRIC_SCANNER_ENABLED === 'true' && Boolean(process.env.BIOMETRIC_SCANNER_SDK_URL);
  }

  getStatus(): BiometricAdapterStatus {
    const available = this.isAvailable();
    return {
      category: 'dedicated_scanner',
      available,
      label: 'Dedicated Fingerprint Scanner Authentication',
      reason: available
        ? undefined
        : 'No compatible dedicated fingerprint scanner SDK or local device service is configured.',
    };
  }

  async verifyCapture(): Promise<never> {
    throw new ServiceUnavailableException(
      'Dedicated fingerprint scanner integration is not configured on this server.',
    );
  }
}

@Injectable()
export class ApprovedBiometricServiceAdapter implements BiometricScannerAdapter {
  getCategory(): BiometricProviderCategory {
    return 'approved_service';
  }

  isAvailable(): boolean {
    return Boolean(process.env.APPROVED_BIOMETRIC_SERVICE_URL && process.env.APPROVED_BIOMETRIC_SERVICE_KEY);
  }

  getStatus(): BiometricAdapterStatus {
    const available = this.isAvailable();
    return {
      category: 'approved_service',
      available,
      label: 'Approved Biometric Authentication Service',
      reason: available
        ? undefined
        : 'No external approved biometric authentication provider is configured.',
    };
  }

  async verifyCapture(): Promise<never> {
    throw new ServiceUnavailableException(
      'Approved biometric authentication service is not configured.',
    );
  }
}

export interface TrustedWebAuthnCredentialRecord {
  credentialId: string;
  subjectId: string; // Authenticated user ID or verified recipient identity key
  publicKeySpkiPem: string;
  signCount: number;
  createdAt: string;
  revokedAt?: string | null;
  revocationReason?: string | null;
  replacedByCredentialId?: string | null;
}

export interface TrustedWebAuthnCredentialStore {
  hasActiveCredentialsForSubject(subjectId: string): Promise<boolean>;
  findCredentialForSubject(
    subjectId: string,
    credentialId: string,
  ): Promise<TrustedWebAuthnCredentialRecord | null>;
  registerCredential(record: Omit<TrustedWebAuthnCredentialRecord, 'createdAt'>): Promise<TrustedWebAuthnCredentialRecord>;
  updateSignCount(credentialId: string, newSignCount: number): Promise<void>;
  revokeCredential(subjectId: string, credentialId: string, reason: string): Promise<boolean>;
  replaceCredential(
    subjectId: string,
    oldCredentialId: string,
    newRecord: Omit<TrustedWebAuthnCredentialRecord, 'createdAt'>,
  ): Promise<TrustedWebAuthnCredentialRecord>;
}

/**
 * Default non-persistent credential store.
 * Returns no trusted credentials for unauthenticated recipients unless explicitly enrolled
 * in an authenticated session or backed by a persistent database credential repository.
 */
@Injectable()
export class InMemoryTrustedCredentialStore implements TrustedWebAuthnCredentialStore {
  private readonly records = new Map<string, TrustedWebAuthnCredentialRecord>();

  async hasActiveCredentialsForSubject(subjectId: string): Promise<boolean> {
    for (const rec of this.records.values()) {
      if (rec.subjectId === subjectId && !rec.revokedAt) {
        return true;
      }
    }
    return false;
  }

  async findCredentialForSubject(
    subjectId: string,
    credentialId: string,
  ): Promise<TrustedWebAuthnCredentialRecord | null> {
    const rec = this.records.get(credentialId);
    if (!rec || rec.subjectId !== subjectId) {
      return null;
    }
    return rec;
  }

  async registerCredential(
    record: Omit<TrustedWebAuthnCredentialRecord, 'createdAt'>,
  ): Promise<TrustedWebAuthnCredentialRecord> {
    if (this.records.has(record.credentialId)) {
      throw new BadRequestException('Credential ID is already registered.');
    }
    const stored: TrustedWebAuthnCredentialRecord = {
      ...record,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    this.records.set(record.credentialId, stored);
    return stored;
  }

  async updateSignCount(credentialId: string, newSignCount: number): Promise<void> {
    const rec = this.records.get(credentialId);
    if (rec) {
      rec.signCount = newSignCount;
    }
  }

  async revokeCredential(subjectId: string, credentialId: string, reason: string): Promise<boolean> {
    const rec = this.records.get(credentialId);
    if (!rec || rec.subjectId !== subjectId || rec.revokedAt) {
      return false;
    }
    rec.revokedAt = new Date().toISOString();
    rec.revocationReason = reason;
    return true;
  }

  async replaceCredential(
    subjectId: string,
    oldCredentialId: string,
    newRecord: Omit<TrustedWebAuthnCredentialRecord, 'createdAt'>,
  ): Promise<TrustedWebAuthnCredentialRecord> {
    const oldRec = this.records.get(oldCredentialId);
    if (!oldRec || oldRec.subjectId !== subjectId) {
      throw new ForbiddenException('Original credential not found for replacement.');
    }
    oldRec.revokedAt = new Date().toISOString();
    oldRec.revocationReason = 'Replaced by newer credential';
    oldRec.replacedByCredentialId = newRecord.credentialId;
    return this.registerCredential(newRecord);
  }
}

export interface WebAuthnRegistrationInput {
  credential_id: string;
  client_data_json: string; // base64url
  authenticator_data: string; // base64url (from attestationObject.authData or getAuthenticatorData)
  public_key_spki_der: string; // base64url SPKI DER from authenticator getPublicKey()
  expected_rp_id: string;
  expected_origin: string;
  expected_challenge: string;
}

export interface WebAuthnAssertionInput {
  challenge_id: string;
  credential_id: string;
  client_data_json: string; // base64url
  authenticator_data: string; // base64url
  signature: string; // base64url
  trusted_public_key_spki_pem: string; // Strictly from server-side TrustedWebAuthnCredentialStore
  expected_rp_id: string;
  expected_origin: string;
  expected_challenge: string;
  previous_sign_count: number;
}

@Injectable()
export class WebAuthnBiometricVerifier {
  private getHmacSecret(): string {
    const configured =
      process.env.SIGNING_BIOMETRIC_SECRET ||
      process.env.JWT_SECRET ||
      process.env.PAYMENT_WEBHOOK_SECRET;
    if (!configured && process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException(
        'SIGNING_BIOMETRIC_SECRET is required in production.',
      );
    }
    return configured || 'gsign-dev-biometric-hmac-secret';
  }

  generateChallenge(): { challengeId: string; challenge: string } {
    return {
      challengeId: crypto.randomUUID(),
      challenge: crypto.randomBytes(32).toString('base64url'),
    };
  }

  private validateClientDataAndRp(params: {
    clientDataJsonB64: string;
    authDataBuf: Buffer;
    expectedType: 'webauthn.create' | 'webauthn.get';
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRpId: string;
  }) {
    let clientData: any;
    try {
      const jsonStr = Buffer.from(params.clientDataJsonB64, 'base64url').toString('utf8');
      clientData = JSON.parse(jsonStr);
    } catch {
      throw new BadRequestException('Malformed WebAuthn clientDataJSON.');
    }

    if (clientData.type !== params.expectedType) {
      throw new BadRequestException(`Invalid WebAuthn ceremony type (expected ${params.expectedType}).`);
    }
    if (clientData.challenge !== params.expectedChallenge) {
      throw new ForbiddenException('WebAuthn challenge mismatch.');
    }
    if (
      !clientData.origin ||
      String(clientData.origin).toLowerCase() !== params.expectedOrigin.toLowerCase()
    ) {
      throw new ForbiddenException('WebAuthn origin mismatch.');
    }

    if (params.authDataBuf.length < 37) {
      throw new BadRequestException('Malformed WebAuthn authenticatorData.');
    }

    const rpIdHash = params.authDataBuf.subarray(0, 32);
    const expectedRpIdHash = crypto.createHash('sha256').update(params.expectedRpId).digest();
    if (!crypto.timingSafeEqual(rpIdHash, expectedRpIdHash)) {
      throw new ForbiddenException('WebAuthn Relying Party ID mismatch.');
    }

    const flags = params.authDataBuf[32];
    const userPresent = Boolean(flags & 0x01);
    const userVerified = Boolean(flags & 0x04);
    if (!userPresent || !userVerified) {
      throw new ForbiddenException('Device user verification (UV) and presence (UP) are required.');
    }

    return {
      signCount: params.authDataBuf.readUInt32BE(33),
      userPresent,
      userVerified,
      flags,
    };
  }

  verifyRegistration(input: WebAuthnRegistrationInput): {
    credentialId: string;
    publicKeySpkiPem: string;
    signCount: number;
  } {
    const authDataBuf = Buffer.from(input.authenticator_data, 'base64url');
    const { signCount, flags } = this.validateClientDataAndRp({
      clientDataJsonB64: input.client_data_json,
      authDataBuf,
      expectedType: 'webauthn.create',
      expectedChallenge: input.expected_challenge,
      expectedOrigin: input.expected_origin,
      expectedRpId: input.expected_rp_id,
    });

    // AT flag (0x40) indicates attestedCredentialData is present when available
    if (flags & 0x40 && authDataBuf.length >= 55) {
      const credIdLen = authDataBuf.readUInt16BE(53);
      if (authDataBuf.length >= 55 + credIdLen) {
        const embeddedCredId = authDataBuf.subarray(55, 55 + credIdLen).toString('base64url');
        if (embeddedCredId !== input.credential_id) {
          throw new ForbiddenException('Registered credential ID mismatch.');
        }
      }
    }

    let publicKeySpkiPem: string;
    try {
      const derBuf = Buffer.from(input.public_key_spki_der, 'base64url');
      const keyObj = crypto.createPublicKey({ key: derBuf, format: 'der', type: 'spki' });
      publicKeySpkiPem = keyObj.export({ format: 'pem', type: 'spki' }).toString();
    } catch {
      throw new BadRequestException('Invalid SPKI public key in WebAuthn registration.');
    }

    return {
      credentialId: input.credential_id,
      publicKeySpkiPem,
      signCount,
    };
  }

  verifyAssertion(input: WebAuthnAssertionInput): {
    verified: boolean;
    signCount: number;
    userVerified: boolean;
    userPresent: boolean;
  } {
    const authDataBuf = Buffer.from(input.authenticator_data, 'base64url');
    const { signCount, userVerified, userPresent } = this.validateClientDataAndRp({
      clientDataJsonB64: input.client_data_json,
      authDataBuf,
      expectedType: 'webauthn.get',
      expectedChallenge: input.expected_challenge,
      expectedOrigin: input.expected_origin,
      expectedRpId: input.expected_rp_id,
    });

    if (input.previous_sign_count > 0 && signCount <= input.previous_sign_count) {
      throw new ForbiddenException('WebAuthn signature counter did not advance (possible cloned/replayed authenticator).');
    }

    if (!input.trusted_public_key_spki_pem) {
      throw new ForbiddenException('No trusted public key found for this credential.');
    }

    const clientDataHash = crypto
      .createHash('sha256')
      .update(Buffer.from(input.client_data_json, 'base64url'))
      .digest();
    const signedData = Buffer.concat([authDataBuf, clientDataHash]);
    const sigBuf = Buffer.from(input.signature, 'base64url');

    let signatureValid = false;
    try {
      signatureValid = crypto.verify(
        'sha256',
        signedData,
        input.trusted_public_key_spki_pem,
        sigBuf,
      );
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      throw new ForbiddenException('WebAuthn cryptographic assertion signature verification failed.');
    }

    return {
      verified: true,
      signCount,
      userVerified,
      userPresent,
    };
  }

  issueVerificationToken(params: {
    recipientId: string;
    agreementId: string;
    signingRequestId: string;
    providerCategory: BiometricProviderCategory;
    referenceId: string;
    ttlSeconds?: number;
  }): { token: string; jti: string; ttlSeconds: number } {
    const jti = crypto.randomUUID();
    const ttlSeconds = params.ttlSeconds ?? 300;
    const payload = {
      jti,
      rid: params.recipientId,
      aid: params.agreementId,
      sid: params.signingRequestId,
      cat: params.providerCategory,
      ref: params.referenceId,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.getHmacSecret())
      .update(encoded)
      .digest('base64url');
    return { token: `${encoded}.${sig}`, jti, ttlSeconds };
  }

  verifyVerificationToken(
    token: string,
    expectedRecipientId: string,
    expectedAgreementId: string,
    expectedSigningRequestId: string,
  ): { jti: string; providerCategory: BiometricProviderCategory; referenceId: string } {
    const parts = (token || '').split('.');
    if (parts.length !== 2) {
      throw new ForbiddenException('Invalid biometric verification token.');
    }
    const [encoded, providedSig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', this.getHmacSecret())
      .update(encoded)
      .digest('base64url');

    const a = Buffer.from(providedSig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new ForbiddenException('Invalid biometric verification token signature.');
    }

    let payload: any;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      throw new ForbiddenException('Malformed biometric verification token.');
    }

    if (
      !payload.jti ||
      payload.rid !== expectedRecipientId ||
      payload.aid !== expectedAgreementId ||
      payload.sid !== expectedSigningRequestId
    ) {
      throw new ForbiddenException(
        'Biometric verification token does not match recipient, agreement, or signing session.',
      );
    }
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new ForbiddenException('Biometric verification token has expired. Please re-verify.');
    }

    return {
      jti: payload.jti,
      providerCategory: payload.cat,
      referenceId: payload.ref,
    };
  }
}
