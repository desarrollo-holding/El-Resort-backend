export function getOptimizedVideoUrl(bucketName: string, fileName: string): string {
  const base = (process.env.CLOUDFLARE_WORKER_URL || "").trim();
  if (!base) throw new Error("CLOUDFLARE_WORKER_URL no está definido");

  const normalizedBase = base.replace(/\/+$/,'');
  const normalizedBucket = (bucketName || "").replace(/^\/+|\/+$/g, "");
  const normalizedFile = (fileName || "").replace(/^\/+/, "");

  return `${normalizedBase}/${normalizedBucket}/${normalizedFile}`;
}

export default getOptimizedVideoUrl;
