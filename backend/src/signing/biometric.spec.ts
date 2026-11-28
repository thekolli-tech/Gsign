import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import {
  ApprovedBiometricServiceAdapter,
  DedicatedFingerprintScannerAdapter,
  InMemoryTrustedCredentialStore,
  WebAuthnBiometricVerifier,
} from './biometric.provider';
import { SigningService } from './signing.service';

describe('Phase 5D: WebAuthn Security Hardening & Trusted Credential Lifecycle', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const rawToken = 'raw-signing-token-biometric-123456';
  const rpId = 'gsign.in';
  const origin = 'https://gsign.in';

  function buildWebAuthnAssertion(params: {
    challenge: string;
    origin: string;
    rpId: string;
    flags?: number;
    signCount?: number;
    privateKeyPem: string;
  }) {
    const clientDataJson = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: params.challenge,
        origin: params.origin,
      }),
      'utf8',
    ).toString('base64url');

    const rpIdHash = crypto.createHash('sha256').update(params.rpId).digest();
    const flagsBuf = Buffer.from([params.flags ?? 0x05]); // UP (0x01) + UV (0x04)
    const countBuf = Buffer.alloc(4);
    countBuf.writeUInt32BE(params.signCount ?? 1, 0);
    const authData = Buffer.concat([rpIdHash, flagsBuf, countBuf]);

    const clientHash = crypto
      .createHash('sha256')
      .update(Buffer.from(clientDataJson, 'base64url'))
      .digest();
    const signedData = Buffer.concat([authData, clientHash]);
    const signature = crypto.sign('sha256', signedData, params.privateKeyPem).toString('base64url');

    return {
      client_data_json: clientDataJson,
      authenticator_data: authData.toString('base64url'),
      signature,
    };
  }

  function makeAtomicRedisMock() {
    const store = new Map<string, string>();
    return {
      store,
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      setex: jest.fn(async (k: string, _ttl: number, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      getdel: jest.fn(async (k: string) => {
        const val = store.get(k) ?? null;
        if (val !== null) store.delete(k);
        return val;
      }),
      del: jest.fn(async (k: string) => {
        store.delete(k);
        return 1;
      }),
    } as any;
  }

  function makeSigningDbMock(recipientId = 'rec-bio-1', agreementId = 'agr-1', reqId = 'req-1') {
    return {
      executeAsSuperAdmin: jest.fn(async (fn: (c: any) => Promise<any>) =>
        fn({
          query: jest.fn().mockResolvedValue({
            rows: [{
              id: recipientId,
              tenant_id: tenantId,
              signing_request_id: reqId,
              agreement_id: agreementId,
              email: 'signer@acme.in',
              status: 'PENDING',
              otp_verified_at: new Date().toISOString(),
              token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
            }],
          }),
        }),
      ),
      executeWithTenantContext: jest.fn(async (_tid: string, fn: (c: any) => Promise<any>) =>
        fn({
          query: jest.fn(async (sql: string) => {
            if (sql.includes('FROM signing_requests')) return { rows: [{ id: reqId, status: 'ACTIVE', sequential: false }] };
            if (sql.includes('FROM agreements')) return { rows: [{ id: agreementId, agreement_number: 'AGR-1', template_type: 'NDA', status: 'Awaiting signature', document_hash: 'a'.repeat(64) }] };
            if (sql.includes('FROM signing_recipients') && sql.includes('signing_request_id = $1::uuid') && sql.includes('FOR UPDATE')) {
              return { rows: [{ id: recipientId, signing_order: 1, is_required: true, status: 'PENDING' }] };
            }
            if (sql.includes('FROM signing_recipients') && sql.includes('COUNT(*)')) return { rows: [{ pending_count: 0 }] };
            if (sql.includes('FROM signing_recipients')) {
              return { rows: [{ id: recipientId, name: 'Signer', email: 'signer@acme.in', status: 'PENDING', otp_verified_at: new Date().toISOString(), token_expires_at: new Date(Date.now() + 3600_000).toISOString() }] };
            }
            return { rows: [] };
          }),
        }),
      ),
    } as any;
  }

  it('keeps device_webauthn unavailable for unauthenticated recipients with no registered trusted credential', async () => {
    const svc = new SigningService(makeSigningDbMock(), makeAtomicRedisMock());
    const caps = await svc.getBiometricCapabilities(rawToken);
    expect(caps.device_webauthn.available).toBe(false);
    await expect(svc.createBiometricChallenge(rawToken, origin, rpId)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('verifies registration, registers trusted credential, enforces assertion checks, atomic concurrency, revocation & token replay', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const attackerKey = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const verifier = new WebAuthnBiometricVerifier();
    const credStore = new InMemoryTrustedCredentialStore();
    const redisMock = makeAtomicRedisMock();
    const dbMock = makeSigningDbMock('rec-bio-1', 'agr-1', 'req-1');

    // 1. Registration verification
    const regChallenge = 'reg-chal-123';
    const regClientData = Buffer.from(
      JSON.stringify({ type: 'webauthn.create', challenge: regChallenge, origin }),
      'utf8',
    ).toString('base64url');
    const regAuthData = Buffer.concat([
      crypto.createHash('sha256').update(rpId).digest(),
      Buffer.from([0x05]), // UP + UV
      Buffer.alloc(4),
    ]).toString('base64url');

    const regResult = verifier.verifyRegistration({
      credential_id: 'trusted-cred-1',
      client_data_json: regClientData,
      authenticator_data: regAuthData,
      public_key_spki_der: publicKey.toString('base64url'),
      expected_rp_id: rpId,
      expected_origin: origin,
      expected_challenge: regChallenge,
    });

    await credStore.registerCredential({
      credentialId: regResult.credentialId,
      subjectId: 'rec-bio-1',
      publicKeySpkiPem: regResult.publicKeySpkiPem,
      signCount: 0,
    });

    const svc = new SigningService(
      dbMock,
      redisMock,
      undefined,
      undefined,
      verifier,
      undefined,
      undefined,
      credStore,
    );

    // 2. Concurrent challenge consumption: 2 parallel assertions -> exactly 1 succeeds, 1 fails
    const chal = await svc.createBiometricChallenge(rawToken, origin, rpId, '127.0.0.1');
    const assertion1 = buildWebAuthnAssertion({
      challenge: chal.challenge,
      origin,
      rpId,
      signCount: 1,
      privateKeyPem: privateKey,
    });

    const results = await Promise.allSettled([
      svc.verifyBiometricAssertion(rawToken, { challenge_id: chal.challenge_id, credential_id: 'trusted-cred-1', ...assertion1 }, origin, rpId),
      svc.verifyBiometricAssertion(rawToken, { challenge_id: chal.challenge_id, credential_id: 'trusted-cred-1', ...assertion1 }, origin, rpId),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const bioToken = (fulfilled[0] as PromiseFulfilledResult<any>).value.biometric_verification_token;

    // 3. Cross-agreement token reuse rejected
    const wrongAgrVerifier = verifier.verifyVerificationToken.bind(verifier);
    expect(() => wrongAgrVerifier(bioToken, 'rec-bio-1', 'agr-OTHER', 'req-1')).toThrow(ForbiddenException);

    // 4. First submitSignature consumes jti; second replay is rejected
    const submit1 = await svc.submitSignature(rawToken, {
      signature_data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      consent_accepted: true,
      consent_text: 'I consent',
      signing_method: 'device_biometric',
      biometric_verification_token: bioToken,
    });
    expect(submit1.signed).toBe(true);

    await expect(
      svc.submitSignature(rawToken, {
        signature_data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        consent_accepted: true,
        consent_text: 'I consent',
        signing_method: 'device_biometric',
        biometric_verification_token: bioToken,
      }),
    ).rejects.toThrow(ForbiddenException);

    // 5. Public-key substitution / attacker key, wrong RP ID, missing UV, unregistered credential
    const chal2 = await svc.createBiometricChallenge(rawToken, origin, rpId);
    const attackerAssertion = buildWebAuthnAssertion({
      challenge: chal2.challenge,
      origin,
      rpId,
      signCount: 2,
      privateKeyPem: attackerKey.privateKey,
    });
    await expect(
      svc.verifyBiometricAssertion(
        rawToken,
        { challenge_id: chal2.challenge_id, credential_id: 'trusted-cred-1', ...attackerAssertion },
        origin,
        rpId,
      ),
    ).rejects.toThrow(ForbiddenException);

    const chal3 = await svc.createBiometricChallenge(rawToken, origin, rpId);
    await expect(
      svc.verifyBiometricAssertion(
        rawToken,
        { challenge_id: chal3.challenge_id, credential_id: 'unregistered-cred', ...attackerAssertion },
        origin,
        rpId,
      ),
    ).rejects.toThrow(ForbiddenException);

    const chal4 = await svc.createBiometricChallenge(rawToken, origin, rpId);
    const wrongRpAssertion = buildWebAuthnAssertion({
      challenge: chal4.challenge,
      origin,
      rpId: 'evil.com',
      signCount: 3,
      privateKeyPem: privateKey,
    });
    await expect(
      svc.verifyBiometricAssertion(
        rawToken,
        { challenge_id: chal4.challenge_id, credential_id: 'trusted-cred-1', ...wrongRpAssertion },
        origin,
        rpId,
      ),
    ).rejects.toThrow(ForbiddenException);

    const chal5 = await svc.createBiometricChallenge(rawToken, origin, rpId);
    const noUvAssertion = buildWebAuthnAssertion({
      challenge: chal5.challenge,
      origin,
      rpId,
      flags: 0x01, // UP only, UV missing
      signCount: 4,
      privateKeyPem: privateKey,
    });
    await expect(
      svc.verifyBiometricAssertion(
        rawToken,
        { challenge_id: chal5.challenge_id, credential_id: 'trusted-cred-1', ...noUvAssertion },
        origin,
        rpId,
      ),
    ).rejects.toThrow(ForbiddenException);

    // 6. Revocation blocks subsequent verification
    const revoked = await credStore.revokeCredential('rec-bio-1', 'trusted-cred-1', 'Device lost');
    expect(revoked).toBe(true);
    await expect(svc.createBiometricChallenge(rawToken, origin, rpId)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects expired biometric_verification_token and unconfigured dedicated scanner / approved service', async () => {
    const verifier = new WebAuthnBiometricVerifier();
    const expired = verifier.issueVerificationToken({
      recipientId: 'rec-1',
      agreementId: 'agr-1',
      signingRequestId: 'req-1',
      providerCategory: 'device_webauthn',
      referenceId: 'ref-1',
      ttlSeconds: -10,
    });
    expect(() => verifier.verifyVerificationToken(expired.token, 'rec-1', 'agr-1', 'req-1')).toThrow(
      ForbiddenException,
    );

    const scanner = new DedicatedFingerprintScannerAdapter();
    const approved = new ApprovedBiometricServiceAdapter();
    expect(scanner.isAvailable()).toBe(false);
    expect(approved.isAvailable()).toBe(false);
    await expect(scanner.verifyCapture()).rejects.toThrow(ServiceUnavailableException);
    await expect(approved.verifyCapture()).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects digital_thumb_impression without valid PNG/JPEG image', async () => {
    const svc = new SigningService(makeSigningDbMock(), makeAtomicRedisMock());
    await expect(
      svc.submitSignature(rawToken, {
        signature_data_url: 'data:image/png;base64,abc',
        consent_accepted: true,
        consent_text: 'I consent',
        signing_method: 'digital_thumb_impression',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
