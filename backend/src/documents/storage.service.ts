import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  DeleteObjectCommand,
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

export interface StorageDiagnostics {
  driver: 's3' | 'local_private';
  productionMode: boolean;
  configured: boolean;
  bucketConfigured: boolean;
  endpointConfigured: boolean;
  credentialsConfigured: boolean;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client | null = null;
  private readonly s3Bucket: string | null = null;
  private readonly localRoot: string;
  private readonly isProduction: boolean;
  private readonly endpointConfigured: boolean;
  private readonly credentialsConfigured: boolean;

  constructor() {
    this.isProduction =
      process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

    const bucket = process.env.S3_BUCKET?.trim();
    const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
    const endpoint = process.env.S3_ENDPOINT?.trim();
    const region = process.env.S3_REGION?.trim() || 'auto';

    this.endpointConfigured = Boolean(endpoint);
    this.credentialsConfigured = Boolean(accessKeyId && secretAccessKey);

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
    } else if (!this.isProduction) {
      this.logger.log(
        'S3 credentials not configured; using private local filesystem vault (backend/.local_storage) for development/testing.',
      );
    }

    this.localRoot =
      process.env.LOCAL_STORAGE_ROOT?.trim() ||
      path.resolve(process.cwd(), '.local_storage');
  }

  onModuleInit() {
    if (this.isProduction && (!this.s3Client || !this.s3Bucket)) {
      const msg =
        'CRITICAL STORAGE MISCONFIGURATION: Private S3/R2 storage (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) is required in production. Local filesystem storage is disabled in production.';
      this.logger.error(msg);
      throw new Error(msg);
    }
  }

  isS3Enabled(): boolean {
    return Boolean(this.s3Client && this.s3Bucket);
  }

  getDiagnostics(): StorageDiagnostics {
    return {
      driver: this.isS3Enabled() ? 's3' : 'local_private',
      productionMode: this.isProduction,
      configured: this.isProduction ? this.isS3Enabled() : true,
      bucketConfigured: Boolean(this.s3Bucket),
      endpointConfigured: this.endpointConfigured,
      credentialsConfigured: this.credentialsConfigured,
    };
  }

  private assertWriteAllowedInCurrentEnv() {
    if (this.isProduction && (!this.s3Client || !this.s3Bucket)) {
      throw new Error(
        'Production storage is not configured: S3/R2 credentials and bucket are required.',
      );
    }
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
    this.assertWriteAllowedInCurrentEnv();

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

    if (this.isProduction) {
      throw new NotFoundException('Local storage objects cannot be read in production.');
    }

    const filePath = this.resolveSafeLocalPath(key);
    try {
      return await fs.readFile(filePath);
    } catch {
      throw new NotFoundException('Stored document file not found in private vault.');
    }
  }

  async deletePrivateObject(provider: string, bucket: string, key: string): Promise<void> {
    if (provider === 's3') {
      if (!this.s3Client) {
        throw new Error('S3 storage client is not configured for cleanup.');
      }
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      return;
    }

    if (this.isProduction) {
      throw new Error('Local storage cleanup is disabled in production.');
    }

    const filePath = this.resolveSafeLocalPath(key);
    await fs.rm(filePath, { force: true });
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

    if (this.isProduction) {
      return false;
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
