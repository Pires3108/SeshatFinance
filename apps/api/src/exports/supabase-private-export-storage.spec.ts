import { describe, expect, it, vi } from 'vitest';
import {
  SupabasePrivateExportStorage,
  type PrivateStorageClient,
} from './supabase-private-export-storage.js';

const now = new Date('2026-10-07T12:00:00.000Z');

describe('SupabasePrivateExportStorage', () => {
  it('uses a private bucket and bounds the signed URL expiry', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.test/signed' },
      error: null,
    });
    const getBucket = vi.fn().mockResolvedValue({
      data: { public: false },
      error: null,
    });
    const from = vi.fn().mockReturnValue({ upload, remove, createSignedUrl });
    const client = {
      storage: { from, getBucket },
    } as unknown as PrivateStorageClient;
    const storage = new SupabasePrivateExportStorage(
      () => client,
      'private-exports',
      { now: () => now },
    );
    await storage.put('user/job', new Uint8Array([1]), 'application/json');
    expect(upload).toHaveBeenCalledWith('user/job', new Uint8Array([1]), {
      contentType: 'application/json',
      upsert: false,
    });
    expect(from).toHaveBeenCalledWith('private-exports');
    expect(getBucket).toHaveBeenCalledWith('private-exports');
    expect(
      await storage.createSignedDownloadUrl(
        'user/job',
        new Date(now.getTime() + 10 * 60 * 1000),
      ),
    ).toBe('https://storage.test/signed');
    expect(createSignedUrl).toHaveBeenCalledWith('user/job', 600);
    await expect(
      storage.createSignedDownloadUrl(
        'user/job',
        new Date(now.getTime() + 601_000),
      ),
    ).rejects.toThrow('expiry');
    await storage.delete('user/job');
    expect(remove).toHaveBeenCalledWith(['user/job']);
  });

  it('refuses a public bucket before uploading financial data', async () => {
    const upload = vi.fn();
    const client = {
      storage: {
        getBucket: vi.fn().mockResolvedValue({
          data: { public: true },
          error: null,
        }),
        from: vi.fn().mockReturnValue({ upload }),
      },
    } as unknown as PrivateStorageClient;
    const storage = new SupabasePrivateExportStorage(
      () => client,
      'public-bucket',
      { now: () => now },
    );
    await expect(
      storage.put('user/job', new Uint8Array([1]), 'application/json'),
    ).rejects.toThrow('Private export bucket');
    expect(upload).not.toHaveBeenCalled();
  });
});
