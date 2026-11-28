import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSigningMethodOptions,
  validateThumbImageFile,
  bufferToBase64Url,
  base64UrlToUint8Array,
} from './biometricSigning.ts';

describe('Biometric Signing & Thumb Impression Helpers', () => {
  it('exposes accurate signing method availability and hides dedicated_scanner when unavailable', () => {
    const opts = getSigningMethodOptions({
      capabilities: {
        device_webauthn: { available: true, label: 'Device Biometric / Passkey Verification' },
        dedicated_scanner: { available: false, label: 'Dedicated Fingerprint Authentication' },
      },
      webAuthnSupported: true,
    });

    const ids = opts.map((o) => o.id);
    assert.deepEqual(ids, [
      'basic_drawn',
      'otp_verified',
      'digital_thumb_impression',
      'device_biometric',
      'aadhaar_esign',
      'dsc',
    ]);
    assert.equal(opts.find((o) => o.id === 'digital_thumb_impression')?.available, true);
    assert.equal(opts.find((o) => o.id === 'device_biometric')?.available, true);
    assert.equal(opts.find((o) => o.id === 'aadhaar_esign')?.available, false);
    assert.equal(opts.find((o) => o.id === 'dsc')?.available, false);
  });

  it('includes dedicated_scanner only when backend reports it available and marks device_biometric unavailable if browser lacks WebAuthn', () => {
    const opts = getSigningMethodOptions({
      capabilities: {
        dedicated_scanner: { available: true, label: 'Dedicated Fingerprint Authentication' },
      },
      webAuthnSupported: false,
    });

    assert.equal(opts.find((o) => o.id === 'dedicated_scanner')?.available, true);
    assert.equal(opts.find((o) => o.id === 'device_biometric')?.available, false);

    const noCredOpts = getSigningMethodOptions({
      capabilities: {
        device_webauthn: {
          available: false,
          label: 'Device Biometric / Passkey Verification',
          reason: 'No registered trusted passkey/device credential exists for this recipient.',
        },
      },
      webAuthnSupported: true,
    });
    assert.equal(noCredOpts.find((o) => o.id === 'device_biometric')?.available, false);
    assert.match(
      noCredOpts.find((o) => o.id === 'device_biometric')?.unavailableReason || '',
      /No registered trusted passkey/i,
    );
  });

  it('validates thumb impression image files (PNG/JPEG, size, dimensions) and rejects unsupported files', () => {
    assert.equal(
      validateThumbImageFile({ name: 'thumb.png', type: 'image/png', size: 12000, width: 240, height: 240 }).valid,
      true,
    );
    assert.equal(
      validateThumbImageFile({ name: 'thumb.jpg', type: 'image/jpeg', size: 50000, width: 400, height: 400 }).valid,
      true,
    );
    assert.equal(
      validateThumbImageFile({ name: 'bad.svg', type: 'image/svg+xml', size: 500 }).valid,
      false,
    );
    assert.equal(
      validateThumbImageFile({ name: 'huge.png', type: 'image/png', size: 3 * 1024 * 1024 }).valid,
      false,
    );
    assert.equal(
      validateThumbImageFile({ name: 'tiny.png', type: 'image/png', size: 1000, width: 16, height: 16 }).valid,
      false,
    );
  });

  it('round-trips base64url buffers accurately for WebAuthn', () => {
    const raw = new Uint8Array([1, 2, 3, 250, 251, 252]).buffer;
    const encoded = bufferToBase64Url(raw);
    const decoded = base64UrlToUint8Array(encoded);
    assert.deepEqual(Array.from(decoded), [1, 2, 3, 250, 251, 252]);
  });
});
