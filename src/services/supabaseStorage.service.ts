import { v4 as uuidv4 } from "uuid";
import { getCachedSupabaseClientFromEnv } from "../config/supabase";
import getOptimizedVideoUrl from "../utils/videoUrl";

interface ImageDimensions {
  width: number;
  height: number;
  format: "png" | "jpeg" | "webp";
}

export interface UploadResponse {
  fileId: string;
  url: string;
}

export interface ListStorageFilesInput {
  page?: number;
  pageSize?: number;
  prefix?: string;
  signed?: boolean;
  expiresIn?: number;
}

export interface StorageFileWithUrl {
  name: string;
  path: string;
  url: string;
  id?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastAccessedAt?: string;
  contentType?: string;
  size?: number;
}

export interface ListStorageFilesResult {
  bucket: string;
  page: number;
  pageSize: number;
  prefix: string;
  signed: boolean;
  expiresIn: number | null;
  total: number;
  count: number;
  data: StorageFileWithUrl[];
}

export interface DeleteStorageFilesResult {
  bucket: string;
  deleted: number;
  fileIds: string[];
}

export interface UploadFileInput {
  fileBuffer: Buffer;
  originalName: string;
  mimeType?: string;
  mediaKind?: "image" | "video" | "file";
  imageConstraints?: ImageConstraintsOverrides;
}

export interface ImageConstraintsOverrides {
  maxImageBytes?: number;
  maxImageSidePx?: number;
}

const readUInt24LE = (buffer: Buffer, offset: number): number => {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
};

const getPngDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (buffer.length < 24) return null;

  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) return null;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width && height ? { width, height, format: "png" } : null;
};

const getJpegDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    let marker = buffer[offset + 1];
    while (marker === 0xff && offset + 2 < buffer.length) {
      offset++;
      marker = buffer[offset + 1];
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    if (offset + 4 >= buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null;

    const isSOF = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isSOF) {
      if (offset + 9 >= buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height, format: "jpeg" };
    }

    offset += 2 + segmentLength;
  }

  return null;
};

const getWebpDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (buffer.length < 30) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WEBP") return null;

  const chunkType = buffer.toString("ascii", 12, 16);

  if (chunkType === "VP8X") {
    if (buffer.length < 30) return null;
    return {
      width: readUInt24LE(buffer, 24) + 1,
      height: readUInt24LE(buffer, 27) + 1,
      format: "webp",
    };
  }

  if (chunkType === "VP8L") {
    if (buffer.length < 25) return null;
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];

    const width = ((b1 & 0x3f) << 8 | b0) + 1;
    const height = ((b3 & 0x0f) << 10 | b2 << 2 | (b1 & 0xc0) >> 6) + 1;

    return { width, height, format: "webp" };
  }

  if (chunkType === "VP8 ") {
    if (buffer.length < 30) return null;
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;

    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;

    return width && height ? { width, height, format: "webp" } : null;
  }

  return null;
};

const getImageDimensions = (buffer: Buffer): ImageDimensions | null => {
  return getPngDimensions(buffer) ?? getJpegDimensions(buffer) ?? getWebpDimensions(buffer);
};

const isSvgMimeType = (mimeType?: string): boolean => {
  return typeof mimeType === "string" && mimeType.trim().toLowerCase() === "image/svg+xml";
};

const enforceSvgConstraints = ({
  buffer,
  contextLabel,
  constraints,
}: {
  buffer: Buffer;
  contextLabel: string;
  constraints?: ImageConstraintsOverrides;
}): void => {
  if (!Buffer.isBuffer(buffer)) {
    throw Object.assign(new Error("Archivo invalido"), { status: 400 });
  }

  const { config } = getCachedSupabaseClientFromEnv();
  const maxImageBytes = constraints?.maxImageBytes ?? config.maxImageBytes;

  if (!Number.isFinite(maxImageBytes) || maxImageBytes <= 0) {
    throw Object.assign(new Error(`${contextLabel}: maxImageBytes invalido`), { status: 400 });
  }

  if (buffer.length > maxImageBytes) {
    throw Object.assign(new Error(`${contextLabel}: Excede bytes`), { status: 400 });
  }

  const text = buffer.toString("utf8", 0, Math.min(buffer.length, 2048)).trimStart();
  if (!/^<\?xml\b|^<svg\b/i.test(text)) {
    throw Object.assign(new Error("SVG invalido"), { status: 400 });
  }
};

const enforceImageConstraints = ({
  buffer,
  contextLabel,
  constraints,
}: {
  buffer: Buffer;
  contextLabel: string;
  constraints?: ImageConstraintsOverrides;
}): ImageDimensions => {
  if (!Buffer.isBuffer(buffer)) {
    throw Object.assign(new Error("Archivo invalido"), { status: 400 });
  }

  const { config } = getCachedSupabaseClientFromEnv();
  const maxImageBytes = constraints?.maxImageBytes ?? config.maxImageBytes;
  const maxImageSidePx = constraints?.maxImageSidePx ?? config.maxImageSidePx;

  if (!Number.isFinite(maxImageBytes) || maxImageBytes <= 0) {
    throw Object.assign(new Error(`${contextLabel}: maxImageBytes invalido`), { status: 400 });
  }

  if (buffer.length > maxImageBytes) {
    throw Object.assign(new Error(`${contextLabel}: Excede bytes`), { status: 400 });
  }

  const dims = getImageDimensions(buffer);
  if (!dims) {
    throw Object.assign(new Error("Formato no soportado"), { status: 400 });
  }

  // Si `maxImageSidePx` está definido y > 0, se aplica; si es 0 (o <=0) no hay restricción de dimensiones.
  if (Number.isFinite(maxImageSidePx) && maxImageSidePx > 0) {
    if (Math.max(dims.width, dims.height) > maxImageSidePx) {
      throw Object.assign(new Error("Excede dimensiones px"), { status: 400 });
    }
  }

  return dims;
};

const getExtensionFromName = (fileName: string, fallback: string): string => {
  const extension = fileName.split(".").pop()?.toLowerCase() || fallback;
  return extension.replace(/[^a-z0-9]/g, "") || fallback;
};

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "avi", "mkv"]);

const detectUploadMediaKind = ({
  mediaKind,
  mimeType,
  originalName,
}: {
  mediaKind?: "image" | "video" | "file";
  mimeType?: string;
  originalName: string;
}): "image" | "video" | "file" => {
  if (mediaKind === "video") return "video";
  if (mediaKind === "image") return "image";

  const normalizedMime = typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";
  if (normalizedMime.startsWith("video/")) return "video";
  if (normalizedMime.startsWith("image/")) return "image";

  const extension = getExtensionFromName(originalName, "");
  if (VIDEO_EXTENSIONS.has(extension)) return "video";

  return "file";
};

const normalizePrefix = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
};

const isFolderEntry = (item: {
  id?: string | null;
  metadata?: unknown;
}): boolean => {
  const hasId = typeof item.id === "string" && item.id.length > 0;
  if (!hasId) return true;

  const metadata = item.metadata;
  if (!metadata || typeof metadata !== "object") return true;

  const hasMimetype = typeof (metadata as { mimetype?: unknown }).mimetype === "string";

  return !hasMimetype;
};

const listAllFilesFromPrefix = async ({
  client,
  bucket,
  prefix,
}: {
  client: ReturnType<typeof getCachedSupabaseClientFromEnv>["client"];
  bucket: string;
  prefix: string;
}): Promise<Array<{ path: string; item: { name: string; id?: string | null; metadata?: unknown; created_at?: string; updated_at?: string; last_accessed_at?: string } }>> => {
  const queue: string[] = [prefix];
  const files: Array<{ path: string; item: { name: string; id?: string | null; metadata?: unknown; created_at?: string; updated_at?: string; last_accessed_at?: string } }> = [];

  while (queue.length > 0) {
    const currentPrefix = queue.shift() ?? "";
    let offset = 0;

    while (true) {
      const { data, error } = await client.storage.from(bucket).list(currentPrefix, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      });

      if (error) throw error;

      const entries = data ?? [];
      if (entries.length === 0) break;

      for (const entry of entries) {
        if (!entry?.name) continue;

        const fullPath = currentPrefix ? `${currentPrefix}/${entry.name}` : entry.name;

        if (isFolderEntry(entry)) {
          queue.push(fullPath);
          continue;
        }

        files.push({ path: fullPath, item: entry });
      }

      if (entries.length < 1000) break;
      offset += 1000;
    }
  }

  return files;
};

export const SupabaseStorageService = {
  async listFilesWithUrls({ page = 1, pageSize = 100, prefix = "", signed = false, expiresIn = 3600 }: ListStorageFilesInput = {}): Promise<ListStorageFilesResult> {
    const { client, config } = getCachedSupabaseClientFromEnv();

    if (!Number.isInteger(page) || page < 1) {
      throw Object.assign(new Error("page debe ser un entero >= 1"), { status: 400 });
    }

    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
      throw Object.assign(new Error("pageSize debe ser un entero entre 1 y 1000"), { status: 400 });
    }

    if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 60 * 60 * 24 * 7) {
      throw Object.assign(new Error("expiresIn debe ser un entero entre 1 y 604800"), { status: 400 });
    }

    const normalizedPrefix = normalizePrefix(prefix);
    const allFiles = await listAllFilesFromPrefix({
      client,
      bucket: config.bucket,
      prefix: normalizedPrefix,
    });

    allFiles.sort((a, b) => a.path.localeCompare(b.path));

    const total = allFiles.length;
    const offset = (page - 1) * pageSize;
    const entries = allFiles.slice(offset, offset + pageSize);

    const mappedData = await Promise.all(
      entries.map(async ({ path: fullPath, item }) => {

        const metadata = item.metadata && typeof item.metadata === "object" ? (item.metadata as Record<string, unknown>) : null;
        const metadataMimetype = metadata && typeof metadata.mimetype === "string" ? metadata.mimetype : undefined;
        const metadataSize = metadata && typeof metadata.size === "number" ? metadata.size : undefined;

        let url = "";
        if (signed) {
          const signedUrlResult = await client.storage.from(config.bucket).createSignedUrl(fullPath, expiresIn);
          if (signedUrlResult.error) throw signedUrlResult.error;
          url = signedUrlResult.data.signedUrl;
        } else {
          const isVideo = (typeof metadataMimetype === "string" && metadataMimetype.startsWith("video/")) || /\.(mp4|mov|m4v|webm|ogg|avi|mkv)$/i.test(fullPath);
          if (isVideo) {
            url = getOptimizedVideoUrl(config.bucket, fullPath);
          } else {
            const { data: publicUrlData } = client.storage.from(config.bucket).getPublicUrl(fullPath);
            url = publicUrlData.publicUrl;
          }
        }

        return {
          name: item.name,
          path: fullPath,
          url,
          id: item.id,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          lastAccessedAt: item.last_accessed_at,
          contentType: metadataMimetype,
          size: metadataSize,
        } satisfies StorageFileWithUrl;
      })
    );

    return {
      bucket: config.bucket,
      page,
      pageSize,
      prefix: normalizedPrefix,
      signed,
      expiresIn: signed ? expiresIn : null,
      total,
      count: mappedData.length,
      data: mappedData,
    };
  },

  async uploadImage({
    fileName,
    base64,
    imageConstraints,
  }: {
    fileName: string;
    base64: string;
    imageConstraints?: ImageConstraintsOverrides;
  }): Promise<UploadResponse> {
    const trimmed = base64.trim();
    if (trimmed.startsWith("http")) {
      return { fileId: trimmed, url: trimmed };
    }

    const { client, config } = getCachedSupabaseClientFromEnv();

    const svgDataUri = /^data:image\/svg\+xml;base64,/i.test(trimmed);
    const normalizedBase64 = trimmed.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
    const buffer = Buffer.from(normalizedBase64, "base64");
    if (svgDataUri) {
      enforceSvgConstraints({ buffer, contextLabel: "uploadImage", constraints: imageConstraints });
    } else {
      enforceImageConstraints({ buffer, contextLabel: "uploadImage", constraints: imageConstraints });
    }

    const extension = getExtensionFromName(fileName, "jpg");
    const generatedName = `evidencia-${uuidv4()}.${extension}`;

    const { error } = await client.storage.from(config.bucket).upload(generatedName, buffer, {
      contentType: `image/${extension}`,
      upsert: false,
    });

    if (error) throw error;

    const { data } = client.storage.from(config.bucket).getPublicUrl(generatedName);
    return { fileId: generatedName, url: data.publicUrl };
  },

  async uploadFile({ fileBuffer, originalName, mimeType, mediaKind, imageConstraints }: UploadFileInput): Promise<UploadResponse> {
    const { client, config } = getCachedSupabaseClientFromEnv();

    const resolvedKind = detectUploadMediaKind({ mediaKind, mimeType, originalName });
    if (resolvedKind === "image") {
      if (isSvgMimeType(mimeType)) {
        enforceSvgConstraints({
          buffer: fileBuffer,
          contextLabel: "uploadFile",
          constraints: imageConstraints,
        });
      } else {
        enforceImageConstraints({
          buffer: fileBuffer,
          contextLabel: "uploadFile",
          constraints: imageConstraints,
        });
      }
    }

    const extension = getExtensionFromName(originalName, "dat");
    let contentType = mimeType;

    if (!contentType) {
      const mimeMap: Record<string, string> = {
        pdf: "application/pdf",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        svg: "image/svg+xml",
      };
      contentType = mimeMap[extension] || "application/octet-stream";
    }

    const generatedName = `archivo-${uuidv4()}.${extension}`;

    const { error } = await client.storage.from(config.bucket).upload(generatedName, fileBuffer, {
      contentType,
      upsert: false,
    });

    if (error) {
      const message = typeof error.message === "string" ? error.message : "";
      if (resolvedKind === "video" && /maximum allowed size/i.test(message)) {
        throw Object.assign(new Error("El video excede el limite configurado en Supabase Storage (bucket). No es una restriccion del backend."), {
          status: 413,
        });
      }
      throw error;
    }

    if (resolvedKind === "video") {
      return { fileId: generatedName, url: getOptimizedVideoUrl(config.bucket, generatedName) };
    }

    const { data } = client.storage.from(config.bucket).getPublicUrl(generatedName);

    return {
      fileId: generatedName,
      url: data.publicUrl,
    };
  },

  async deleteFile({ fileId }: { fileId: string }): Promise<void> {
    if (!fileId || typeof fileId !== "string") return;

    const { client, config } = getCachedSupabaseClientFromEnv();

    const { error } = await client.storage.from(config.bucket).remove([fileId]);
    if (error) throw error;
  },

  async deleteFiles({ fileIds }: { fileIds: string[] }): Promise<DeleteStorageFilesResult> {
    const normalizedIds = Array.from(
      new Set(fileIds.map((value) => (typeof value === "string" ? value.trim() : "")).filter((value) => value.length > 0))
    );

    if (normalizedIds.length === 0) {
      throw Object.assign(new Error("fileIds no puede estar vacio"), { status: 400 });
    }

    if (normalizedIds.length > 1000) {
      throw Object.assign(new Error("fileIds excede el maximo de 1000 por request"), { status: 400 });
    }

    const { client, config } = getCachedSupabaseClientFromEnv();

    const { error } = await client.storage.from(config.bucket).remove(normalizedIds);
    if (error) throw error;

    return {
      bucket: config.bucket,
      deleted: normalizedIds.length,
      fileIds: normalizedIds,
    };
  },
};
