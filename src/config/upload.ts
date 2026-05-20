import multer from "multer";

const defaultFileSizeBytes = (() => {
  const envBytes = process.env.MAX_UPLOAD_FILE_SIZE_BYTES;
  const envMb = process.env.MAX_UPLOAD_FILE_SIZE_MB;
  if (envBytes && !Number.isNaN(Number(envBytes))) return Number(envBytes);
  if (envMb && !Number.isNaN(Number(envMb))) return Math.round(Number(envMb) * 1024 * 1024);
  return 20 * 1024 * 1024; // default 20 MB per file
})();

export const createMemoryUpload = (filesLimit = 10) =>
  multer({ storage: multer.memoryStorage(), limits: { files: filesLimit, fileSize: defaultFileSizeBytes } });

export default createMemoryUpload;
