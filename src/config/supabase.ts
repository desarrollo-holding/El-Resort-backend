import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseStorageConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  bucket: string;
  maxImageBytes: number;
  maxImageSidePx: number;
};

export const getSupabaseStorageConfigFromEnv = (): SupabaseStorageConfig => {
  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const bucket = (process.env.SUPABASE_BUCKET || "evidencias").trim() || "evidencias";

  const maxImageBytes = Number(process.env.SUPABASE_MAX_IMAGE_BYTES ?? 1 * 1024 * 1024);
  const maxImageSidePx = Number(process.env.SUPABASE_MAX_IMAGE_SIDE_PX ?? 0);

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no definidos");
  }

  if (!Number.isFinite(maxImageBytes) || maxImageBytes <= 0) {
    throw new Error("SUPABASE_MAX_IMAGE_BYTES debe ser un numero > 0");
  }

  if (!Number.isFinite(maxImageSidePx) || maxImageSidePx < 0) {
    throw new Error("SUPABASE_MAX_IMAGE_SIDE_PX debe ser un numero >= 0");
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    bucket,
    maxImageBytes,
    maxImageSidePx,
  };
};

let cachedSupabaseClient: SupabaseClient | null = null;

export const getCachedSupabaseClientFromEnv = (): { client: SupabaseClient; config: SupabaseStorageConfig } => {
  const config = getSupabaseStorageConfigFromEnv();

  if (!cachedSupabaseClient) {
    cachedSupabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  }

  return { client: cachedSupabaseClient, config };
};
