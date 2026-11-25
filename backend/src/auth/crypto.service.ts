import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';

@Injectable()
export class CryptoService {
  private readonly mfaEncryptionKey: Buffer;

  constructor(private readonly configService: ConfigService) {
    const rawKey = this.configService.get<string>(
      'MFA_ENCRYPTION_KEY',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    );
    // Ensure 32 bytes (256 bits)
    this.mfaEncryptionKey = Buffer.from(rawKey.padEnd(64, '0').slice(0, 64), 'hex');
  }

  /**
   * Hashes a password using Argon2id with OWASP recommended parameters.
   */
  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB
      timeCost: 3,       // 3 iterations
      parallelism: 4,    // 4 threads
    });
  }

  /**
   * Verifies a password against an Argon2id hash.
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /**
   * Encrypts sensitive string (e.g., TOTP secret) using AES-256-GCM.
   * Returns format: iv:authTag:ciphertext
   */
  encryptAes256Gcm(plaintext: string): string {
    const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.mfaEncryptionKey, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypts AES-256-GCM payload formatted as: iv:authTag:ciphertext
   */
  decryptAes256Gcm(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted payload format');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.mfaEncryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Generates 8 single-use alphanumeric emergency recovery codes in XXXX-XXXX-XXXX format.
   */
  generateRecoveryCodes(count = 8): string[] {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Base32 without confusing chars (0, O, 1, I)
    const codes: string[] = [];

    for (let i = 0; i < count; i++) {
      let code = '';
      const bytes = crypto.randomBytes(12);
      for (let j = 0; j < 12; j++) {
        if (j > 0 && j % 4 === 0) code += '-';
        code += chars[bytes[j] % chars.length];
      }
      codes.push(code);
    }

    return codes;
  }

  /**
   * Normalizes a recovery code by trimming and converting to uppercase.
   */
  normalizeRecoveryCode(code: string): string {
    return code.trim().toUpperCase();
  }

  /**
   * Hashes a recovery code for database storage.
   */
  async hashRecoveryCode(code: string): Promise<string> {
    const normalized = this.normalizeRecoveryCode(code);
    return argon2.hash(normalized, {
      type: argon2.argon2id,
      memoryCost: 32768,
      timeCost: 2,
    });
  }

  /**
   * Verifies a recovery code against its stored hash.
   */
  async verifyRecoveryCode(code: string, hash: string): Promise<boolean> {
    try {
      const normalized = this.normalizeRecoveryCode(code);
      return await argon2.verify(hash, normalized);
    } catch {
      return false;
    }
  }

  /**
   * Generates a 256-bit cryptographically secure session ID.
   */
  generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generates a random high-entropy token (e.g. for MFA temporary login token).
   */
  generateToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
  }
}
