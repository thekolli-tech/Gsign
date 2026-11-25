import { Injectable, BadRequestException } from '@nestjs/common';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class MfaService {
  constructor(private readonly redisService: RedisService) {
    // Configure otplib to RFC 6238 standard: 30-sec step, 6 digits, HMAC-SHA1
    authenticator.options = {
      step: 30,
      digits: 6,
      window: 1, // +/- 1 step tolerance for 30s clock skew
    };
  }

  /**
   * Generates a new 20-byte Base32 TOTP secret.
   */
  generateSecret(): string {
    return authenticator.generateSecret(20);
  }

  /**
   * Generates an otpauth:// URI for mobile authenticator apps.
   */
  generateOtpAuthUri(userEmail: string, secret: string): string {
    return authenticator.keyuri(userEmail, 'GSIGN', secret);
  }

  /**
   * Generates a QR Code as a Data URL for UI enrollment.
   */
  async generateQrCodeDataUrl(otpAuthUri: string): Promise<string> {
    return QRCode.toDataURL(otpAuthUri, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
      color: {
        dark: '#1e293b',
        light: '#ffffff',
      },
    });
  }

  /**
   * Verifies a 6-digit TOTP code against a decrypted secret with replay protection.
   */
  async verifyTotp(userId: string, code: string, secret: string): Promise<boolean> {
    const cleanCode = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanCode)) {
      return false;
    }

    // Verify code mathematically with time window
    const isValid = authenticator.check(cleanCode, secret);
    if (!isValid) {
      return false;
    }

    // Check for replay attack in Redis
    const replayKey = `mfa:used:${userId}:${cleanCode}`;
    const alreadyUsed = await this.redisService.get(replayKey);
    if (alreadyUsed) {
      throw new BadRequestException('MFA verification code has already been used. Please wait for the next 30-second code.');
    }

    // Store used code for 90 seconds (covers the full 3 * 30s window)
    await this.redisService.setex(replayKey, 90, '1');

    return true;
  }
}
