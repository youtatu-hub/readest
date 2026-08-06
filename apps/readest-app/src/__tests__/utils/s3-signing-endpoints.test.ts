import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('S3 browser signing endpoints', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('S3_ENDPOINT', 'http://minio:9000');
    vi.stubEnv('S3_PUBLIC_ENDPOINT', 'https://upload.example.com');
    vi.stubEnv('S3_PUBLIC_DOWNLOAD_ENDPOINT', 'https://download.example.com');
    vi.stubEnv('S3_REGION', 'us-east-1');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'test-access-key');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'test-secret-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('signs uploads and downloads with their dedicated public endpoints', async () => {
    const { s3Storage } = await import('@/utils/s3');

    const downloadUrl = await s3Storage.getDownloadSignedUrl('books', 'user/book.epub', 60);
    const uploadUrl = await s3Storage.getUploadSignedUrl('books', 'user/book.epub', 1024, 60);

    expect(new URL(downloadUrl).origin).toBe('https://download.example.com');
    expect(new URL(uploadUrl).origin).toBe('https://upload.example.com');
  });

  it('falls back to the upload endpoint for single-endpoint deployments', async () => {
    vi.stubEnv('S3_PUBLIC_DOWNLOAD_ENDPOINT', '');
    vi.resetModules();
    const { s3Storage } = await import('@/utils/s3');

    const downloadUrl = await s3Storage.getDownloadSignedUrl('books', 'user/book.epub', 60);

    expect(new URL(downloadUrl).origin).toBe('https://upload.example.com');
  });
});
