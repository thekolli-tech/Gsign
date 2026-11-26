import * as crypto from 'crypto';
import { Readable } from 'stream';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service';

describe('StorageService (Cloudflare R2 Compatibility & Security)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      S3_BUCKET: 'gsign-private-documents',
      S3_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com',
      S3_REGION: 'auto',
      S3_ACCESS_KEY_ID: 'test-access-key',
      S3_SECRET_ACCESS_KEY: 'test-secret-key',
      S3_FORCE_PATH_STYLE: 'true',
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('does NOT send S3 ACL header on PutObjectCommand (R2 AccessControlListNotSupported fix)', async () => {
    const sendSpy = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation((async () => ({})) as any);
    const storage = new StorageService();
    const body = Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8');

    const res = await storage.putPrivateObject(
      'gsign-system-tests/test.pdf',
      body,
      'application/pdf',
      { purpose: 'regression' },
    );

    expect(res.provider).toBe('s3');
    expect(res.bucket).toBe('gsign-private-documents');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const cmd = sendSpy.mock.calls[0][0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).not.toHaveProperty('ACL');
    expect(cmd.input.Bucket).toBe('gsign-private-documents');
    expect(cmd.input.Key).toBe('gsign-system-tests/test.pdf');
  });

  it('streams GetObjectCommand response into exact Buffer matching SHA-256', async () => {
    const original = Buffer.from('%PDF-1.4\nhello-r2\n%%EOF\n', 'utf8');
    const expectedSha = crypto.createHash('sha256').update(original).digest('hex');

    jest.spyOn(S3Client.prototype, 'send').mockImplementation(async (cmd: any) => {
      if (cmd instanceof GetObjectCommand) {
        return { Body: Readable.from([original.subarray(0, 8), original.subarray(8)]) };
      }
      return {};
    });

    const storage = new StorageService();
    const downloaded = await storage.getPrivateObjectBuffer(
      's3',
      'gsign-private-documents',
      'gsign-system-tests/test.pdf',
    );
    const actualSha = crypto.createHash('sha256').update(downloaded).digest('hex');
    expect(actualSha).toBe(expectedSha);
  });

  it('deletes object and confirms HeadObject returns false when NotFound', async () => {
    let exists = true;
    jest.spyOn(S3Client.prototype, 'send').mockImplementation(async (cmd: any) => {
      if (cmd instanceof DeleteObjectCommand) {
        exists = false;
        return {};
      }
      if (cmd instanceof HeadObjectCommand) {
        if (!exists) throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
        return {};
      }
      return {};
    });

    const storage = new StorageService();
    expect(await storage.headPrivateObject('s3', 'gsign-private-documents', 'k.pdf')).toBe(true);
    await storage.deletePrivateObject('s3', 'gsign-private-documents', 'k.pdf');
    expect(await storage.headPrivateObject('s3', 'gsign-private-documents', 'k.pdf')).toBe(false);
  });
});
