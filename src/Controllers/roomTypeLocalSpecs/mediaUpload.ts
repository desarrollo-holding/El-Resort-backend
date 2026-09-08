import { GcsStorageService } from "../../services/csStorage.service";
import { uploadImageAsset } from "../../services/imageAssetUpload";
import type { ImageAssetType } from "../../models/shared/imageAsset";

export type UploadTracker = {
  uploadedFileIds: string[];
};

export const uploadImageFile = async (file: Express.Multer.File, tracker: UploadTracker): Promise<string> => {
  const uploaded = await GcsStorageService.uploadFile({
    fileBuffer: file.buffer,
    originalName: file.originalname,
    mimeType: file.mimetype,
    mediaKind: "image",
  });
  tracker.uploadedFileIds.push(uploaded.fileId);
  return uploaded.url;
};

/**
 * Igual que `uploadImageFile` pero devuelve el asset completo (con `variants[]` para
 * `srcset`), para los campos que sí se muestran en más de un tamaño: `portada`, `portadaMenu`,
 * fotos de dormitorio y galería extra.
 */
export const uploadImageAssetFile = async (file: Express.Multer.File, tracker: UploadTracker): Promise<ImageAssetType> => {
  const asset = await uploadImageAsset(file);
  tracker.uploadedFileIds.push(asset.storageKey);
  return asset;
};

export const uploadVideoFile = async (file: Express.Multer.File, tracker: UploadTracker): Promise<string> => {
  const uploaded = await GcsStorageService.uploadFile({
    fileBuffer: file.buffer,
    originalName: file.originalname,
    mimeType: file.mimetype,
    mediaKind: "video",
  });
  tracker.uploadedFileIds.push(uploaded.fileId);
  return uploaded.url;
};

export const rollbackUploads = async (uploadedFileIds: string[]): Promise<void> => {
  if (uploadedFileIds.length === 0) return;
  await Promise.allSettled(uploadedFileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
};
