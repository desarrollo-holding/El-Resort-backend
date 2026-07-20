import { Storage } from '@google-cloud/storage';

export class GcsStorageService {
  private static getBucket() {
    const credentials = JSON.parse(process.env.GOOGLE_CLOUD_STORAGE_CREDENTIALS!);
    const storage = new Storage({ credentials });
    return storage.bucket(process.env.GCS_BUCKET_RESORT!);
  }

  static async uploadFile({
    fileBuffer,
    originalName,
    mimeType,
    mediaKind,
    imageConstraints,
  }: {
    fileBuffer: Buffer;
    originalName: string;
    mimeType: string;
    mediaKind: 'image' | 'video' | 'file';
    imageConstraints?: any;
  }) {
    const bucket = this.getBucket();
    
    const timestamp = Date.now();
    const extension = originalName.split('.').pop();
    const folder = mediaKind === 'image' ? 'fotosresort' : mediaKind === 'video' ? 'videos' : 'files';
    const fileName = `${folder}/${timestamp}_${originalName}`;

    const blob = bucket.file(fileName);
    await blob.save(fileBuffer, {
      resumable: false,
      metadata: { contentType: mimeType },
    });

    const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_RESORT}/${fileName}`;

    return {
      fileId: fileName,
      url: publicUrl,
    };
  }

  static async deleteFile({ fileId }: { fileId: string }) {
    try {
      const bucket = this.getBucket();
      await bucket.file(fileId).delete();
      return { success: true };
    } catch (error) {
      console.error('Error deleting file from GCS:', error);
      return { success: false, error };
    }
  }

  static async deleteFiles({ fileIds }: { fileIds: string[] }) {
    try {
      const bucket = this.getBucket();
      await Promise.all(fileIds.map(fileId => bucket.file(fileId).delete()));
      return {
        bucket: process.env.GCS_BUCKET_RESORT,
        deleted: fileIds.length,
        fileIds,
      };
    } catch (error) {
      console.error('Error deleting files from GCS:', error);
      return {
        bucket: process.env.GCS_BUCKET_RESORT,
        deleted: 0,
        fileIds: [],
      };
    }
  }

  static async listFilesWithUrls({
    page = 1,
    pageSize = 100,
    prefix = '',
    signed = false,
    expiresIn = 3600,
  }: {
    page?: number;
    pageSize?: number;
    prefix?: string;
    signed?: boolean;
    expiresIn?: number;
  }) {
    const bucket = this.getBucket();
    
    const [files] = await bucket.getFiles({
      prefix: prefix || undefined,
      maxResults: pageSize * page,
    });

    const offset = (page - 1) * pageSize;
    const paginatedFiles = files.slice(offset, offset + pageSize);

    const data = await Promise.all(
      paginatedFiles.map(async (file) => {
        const [metadata] = await file.getMetadata();
        
        let url = '';
        if (signed) {
          const [signedUrl] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + expiresIn * 1000,
          });
          url = signedUrl;
        } else {
          url = `https://storage.googleapis.com/${process.env.GCS_BUCKET_RESORT}/${file.name}`;
        }

        return {
          name: file.name.split('/').pop() || file.name,
          path: file.name,
          url,
          id: file.id || file.name,
          createdAt: metadata.timeCreated,
          updatedAt: metadata.updated,
          lastAccessedAt: metadata.customTime || null,
          contentType: metadata.contentType,
          size: metadata.size ? parseInt(metadata.size as string) : undefined,
        };
      })
    );

    return {
      bucket: process.env.GCS_BUCKET_RESORT,
      page,
      pageSize,
      prefix,
      signed,
      expiresIn: signed ? expiresIn : null,
      total: files.length,
      count: data.length,
      data,
    };
  }
}