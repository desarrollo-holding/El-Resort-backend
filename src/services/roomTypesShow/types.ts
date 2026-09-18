import type { BeneficioDTO } from "../beneficios.service";
import type { ImageAssetType } from "../../models/shared/imageAsset";

export type CloudbedsRoomsResponse = {
  success?: boolean;
  data?: Array<{
    propertyID?: string;
    rooms?: Array<{
      roomID?: string;
      roomName?: string;
      roomTypeID?: string;
    }>;
  }>;
  count?: number;
  total?: number;
};

export type CloudbedsRoomTypesResponse = {
  success?: boolean;
  data?: Array<Record<string, unknown>>;
  count?: number;
  total?: number;
};

export type CloudbedsRatePlansResponse = {
  success?: boolean;
  data?: Array<Record<string, unknown>>;
};

export type LocalSpecsNormalized = {
  bathroomsCount: number;
  titleColor?: string | null;
  bedrooms: Array<{ number: number; description?: string; photos: ImageAssetType[] }>;
  portada?: ImageAssetType | null;
  portadaMenu?: ImageAssetType | null;
  posicion_fotos_portadas?: Record<string, unknown> | null;
  orden?: number;
  /** Catálogo local ya resuelto (icono + texto). Vacío = la ficha cae a `beneficiosTexto`. */
  beneficios?: BeneficioDTO[];
  /** Comodidades congeladas (texto). Respaldo de `beneficios` cuando está vacío. */
  beneficiosTexto?: string[];
  /** Nombre/descripción locales crudos (sin resolver por idioma); `Es` vacío = cae a Cloudbeds. */
  roomTypeNameLocalEs?: string;
  roomTypeNameLocalEn?: string | null;
  roomTypeDescriptionLocalEs?: string;
  roomTypeDescriptionLocalEn?: string | null;
  /** Huéspedes máximos local; `null`/no seteado = cae a Cloudbeds. */
  maxGuestsLocal?: number | null;
};

export type LocalPricingNormalized = { totalRate?: number; ofertaDelMesRoomRate?: number };

export type ReducedMappingOptions = { applyFallbackDefaults?: boolean; portadaOnly?: boolean; includePortadaMenu?: boolean };
