import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';

export interface StoredObjectResult {
  provider: 's3' | 'local_private';
  bucket: string;
  key: string;
  byteSize: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client | null = null;
  private readonly s3Bucket: string | null = null;
  private readonly localRoot: string;

  constructor() {
    const bucket = process.env.S3_BUCKET?.trim();
    const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
    const endpoint = process.env.S3_ENDPOINT?.trim();
    const region = process.env.S3_REGION?.trim() || 'auto';

    if (bucket && accessKeyId && secretAccessKey) {
      this.s3Bucket = bucket;
      this.s3Client = new S3Client({
        region,
        endpoint: endpoint || undefined,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true' || Boolean(endpoint),
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      this.logger.log(`Private S3-compatible storage initialized (bucket: ${bucket})`);
    } else {
      this.logger.log(
        'S3 credentials not configured; using private local filesystem vault (backend/.local_storage)',
      );
    }

    this.localRoot =
      process.env.LOCAL_STORAGE_ROOT?.trim() ||
      path.resolve(process.cwd(), '.local_storage');
  }

  isS3Enabled(): boolean {
    return Boolean(this.s3Client && this.s3Bucket);
  }

  private resolveSafeLocalPath(key: string): string {
    const normalizedKey = key.replace(/\\/g, '/').replace(/^\/+/, '');
    const fullPath = path.resolve(this.localRoot, normalizedKey);
    const rootWithSep = this.localRoot.endsWith(path.sep)
      ? this.localRoot
      : `${this.localRoot}${path.sep}`;
    if (!fullPath.startsWith(rootWithSep)) {
      throw new Error('Invalid storage key path traversal attempt');
    }
    return fullPath;
  }

  async putPrivateObject(
    key: string,
    body: Buffer,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<StoredObjectResult> {
    if (this.s3Client && this.s3Bucket) {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ACL: 'private',
          Metadata: metadata,
        }),
      );
      return {
        provider: 's3',
        bucket: this.s3Bucket,
        key,
        byteSize: body.length,
      };
    }

    const filePath = this.resolveSafeLocalPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, { flag: 'wx' });
    return {
      provider: 'local_private',
      bucket: 'local-private-vault',
      key,
      byteSize: body.length,
    };
  }

  async getPrivateObjectBuffer(
    provider: string,
    bucket: string,
    key: string,
  ): Promise<Buffer> {
    if (provider === 's3') {
      if (!this.s3Client) {
        throw new NotFoundException('S3 storage client is not configured.');
      }
      const res = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      if (!res.Body) {
        throw new NotFoundException('Stored document object is empty.');
      }
      const stream = res.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }

    const filePath = this.resolveSafeLocalPath(key);
    try {
      return await fs.readFile(filePath);
    } catch {
      throw new NotFoundException('Stored document file not found in private vault.');
    }
  }

  async headPrivateObject(provider: string, bucket: string, key: string): Promise<boolean> {
    if (provider === 's3') {
      if (!this.s3Client) return false;
      try {
        await this.s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    }

    const filePath = this.resolveSafeLocalPath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async createPresignedDownloadUrl(
    provider: string,
    bucket: string,
    key: string,
    fileName: string,
    expiresInSeconds = 120,
  ): Promise<string | null> {
    if (provider !== 's3' || !this.s3Client) {
      return null;
    }
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
  }
}
