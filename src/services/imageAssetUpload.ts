import { GcsStorageService } from "./csStorage.service";
import type { ImageAssetType } from "../models/shared/imageAsset";

/**
 * Sube una imagen a través del único punto de entrada (`GcsStorageService.uploadFile`) y
 * devuelve el asset completo (`url` + `variants[]`) listo para guardarse en un campo que
 * necesite `srcset`. Para campos de un solo tamaño (íconos, avatares) sigue siendo más simple
 * usar `GcsStorageService.uploadFile(...).url` directamente, sin pasar por acá.
 */
export const uploadImageAsset = async (file: { buffer: Buffer; originalname: string; mimetype: string }): Promise<ImageAssetType> => {
  const uploaded = await GcsStorageService.uploadFile({
    fileBuffer: file.buffer,
    originalName: file.originalname,
    mimeType: file.mimetype,
    mediaKind: "image",
  });

  return {
    url: uploaded.url,
    storageKey: uploaded.storageKey ?? uploaded.fileId,
    storagePrefix: uploaded.storagePrefix ?? "",
    width: uploaded.width,
    height: uploaded.height,
    variants: uploaded.variants ?? [],
  };
};
