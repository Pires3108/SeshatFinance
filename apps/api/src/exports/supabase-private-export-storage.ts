import type { PrivateExportStorage } from '@seshat/application';
import type { Clock } from '@seshat/application';

type StorageResult = Readonly<{ error: { message: string } | null }>;
type SignedUrlResult = Readonly<{
  data: { signedUrl: string } | null;
  error: { message: string } | null;
}>;

export type PrivateStorageClient = Readonly<{
  storage: Readonly<{
    getBucket(bucket: string): PromiseLike<
      Readonly<{
        data: { public: boolean } | null;
        error: { message: string } | null;
      }>
    >;
    from(bucket: string): Readonly<{
      upload(
        key: string,
        content: Uint8Array,
        options: Readonly<{ contentType: string; upsert: false }>,
      ): PromiseLike<StorageResult>;
      remove(keys: string[]): PromiseLike<StorageResult>;
      createSignedUrl(
        key: string,
        expiresIn: number,
      ): PromiseLike<SignedUrlResult>;
    }>;
  }>;
}>;

export class SupabasePrivateExportStorage implements PrivateExportStorage {
  private privacyVerified = false;

  public constructor(
    private readonly clientFactory: () => PrivateStorageClient,
    private readonly bucket: string,
    private readonly clock: Clock,
  ) {
    if (bucket.length === 0)
      throw new Error('Private export bucket is required.');
  }

  public async put(
    key: string,
    content: Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.ensurePrivateBucket();
    const result = await this.clientFactory()
      .storage.from(this.bucket)
      .upload(key, content, { contentType, upsert: false });
    if (result.error !== null) throw new Error('Private export upload failed.');
  }

  public async delete(key: string): Promise<void> {
    await this.ensurePrivateBucket();
    const result = await this.clientFactory()
      .storage.from(this.bucket)
      .remove([key]);
    if (result.error !== null)
      throw new Error('Private export deletion failed.');
  }

  public async createSignedDownloadUrl(
    key: string,
    expiresAt: Date,
  ): Promise<string> {
    await this.ensurePrivateBucket();
    const seconds = Math.ceil(
      (expiresAt.getTime() - this.clock.now().getTime()) / 1000,
    );
    if (seconds < 1 || seconds > 600)
      throw new Error('Export download expiry is invalid.');
    const result = await this.clientFactory()
      .storage.from(this.bucket)
      .createSignedUrl(key, seconds);
    if (result.error !== null || result.data === null)
      throw new Error('Private export signed URL failed.');
    return result.data.signedUrl;
  }

  private async ensurePrivateBucket(): Promise<void> {
    if (this.privacyVerified) return;
    const result = await this.clientFactory().storage.getBucket(this.bucket);
    if (result.error !== null || result.data === null || result.data.public)
      throw new Error('Private export bucket is unavailable.');
    this.privacyVerified = true;
  }
}
