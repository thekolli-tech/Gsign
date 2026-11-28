export type RecipientSigningMethodId =
  | 'basic_drawn'
  | 'otp_verified'
  | 'digital_thumb_impression'
  | 'device_biometric'
  | 'dedicated_scanner'
  | 'aadhaar_esign'
  | 'dsc';

export interface BiometricCapabilitiesResponse {
  device_webauthn?: { available: boolean; label: string; reason?: string; note?: string };
  dedicated_scanner?: { available: boolean; label: string; reason?: string };
  approved_service?: { available: boolean; label: string; reason?: string };
  aadhaar_esign?: { available: boolean; label: string; reason?: string };
  dsc?: { available: boolean; label: string; reason?: string };
}

export interface SigningMethodOption {
  id: RecipientSigningMethodId;
  label: string;
  description: string;
  available: boolean;
  hiddenWhenUnavailable?: boolean;
  unavailableReason?: string;
}

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.credentials?.get)
  );
}

export function getSigningMethodOptions(params: {
  capabilities?: BiometricCapabilitiesResponse | null;
  webAuthnSupported?: boolean;
}): SigningMethodOption[] {
  const webAuthnOk = params.webAuthnSupported ?? isWebAuthnSupported();
  const serverWebAuthnAvailable = Boolean(params.capabilities?.device_webauthn?.available);
  const deviceBiometricAvailable = webAuthnOk && serverWebAuthnAvailable;
  const dedicatedAvailable = Boolean(params.capabilities?.dedicated_scanner?.available);

  const all: SigningMethodOption[] = [
    {
      id: 'basic_drawn',
      label: 'Drawn Electronic Signature',
      description: 'Draw your signature using touch, stylus, or mouse.',
      available: true,
    },
    {
      id: 'otp_verified',
      label: 'OTP-Verified Electronic Signature',
      description: 'Electronic signature backed by one-time email verification.',
      available: true,
    },
    {
      id: 'digital_thumb_impression',
      label: 'Digital Thumb Impression',
      description:
        'Manually captured digital thumb impression (touchscreen or PNG/JPEG upload). Does not perform biometric identity verification.',
      available: true,
    },
    {
      id: 'device_biometric',
      label: 'Device Biometric / Passkey Verification',
      description:
        'Verify with your registered device passkey, Touch ID, Face ID, Windows Hello, or device PIN via WebAuthn.',
      available: deviceBiometricAvailable,
      unavailableReason: !webAuthnOk
        ? 'WebAuthn passkey verification is not supported in this browser.'
        : params.capabilities?.device_webauthn?.reason ||
          'No registered trusted passkey/device credential exists for this recipient.',
    },
    {
      id: 'dedicated_scanner',
      label: 'Dedicated Fingerprint Authentication',
      description: 'Verify using an approved physical fingerprint scanner integration.',
      available: dedicatedAvailable,
      hiddenWhenUnavailable: true,
      unavailableReason:
        params.capabilities?.dedicated_scanner?.reason ||
        'No compatible dedicated fingerprint scanner integration is available.',
    },
    {
      id: 'aadhaar_esign',
      label: 'Aadhaar eSign',
      description: 'Government-regulated Aadhaar eSign workflow.',
      available: false,
      unavailableReason: 'Unavailable until an approved ASP/UIDAI provider is integrated.',
    },
    {
      id: 'dsc',
      label: 'DSC',
      description: 'Hardware Digital Signature Certificate token signing.',
      available: false,
      unavailableReason: 'Unavailable until an appropriate DSC provider integration exists.',
    },
  ];

  return all.filter((opt) => !(opt.hiddenWhenUnavailable && !opt.available));
}

export interface ThumbImageValidationInput {
  name: string;
  type: string;
  size: number;
  width?: number;
  height?: number;
}

export function validateThumbImageFile(file: ThumbImageValidationInput): {
  valid: boolean;
  error?: string;
} {
  const allowedTypes = ['image/png', 'image/jpeg'];
  const lowerName = (file.name || '').toLowerCase();
  const hasValidExt = lowerName.endsWith('.png') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg');
  if (!allowedTypes.includes(file.type) && !hasValidExt) {
    return { valid: false, error: 'Only PNG and JPEG images are supported for thumb impressions.' };
  }
  const maxBytes = 2 * 1024 * 1024;
  if (file.size <= 0 || file.size > maxBytes) {
    return { valid: false, error: 'Thumb impression image must be between 1 byte and 2 MB.' };
  }
  if (file.width !== undefined && file.height !== undefined) {
    if (file.width < 64 || file.height < 64) {
      return { valid: false, error: 'Thumb impression image must be at least 64 × 64 pixels.' };
    }
    if (file.width > 4096 || file.height > 4096) {
      return { valid: false, error: 'Thumb impression image must not exceed 4096 × 4096 pixels.' };
    }
  }
  return { valid: true };
}

export function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToUint8Array(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64url.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
