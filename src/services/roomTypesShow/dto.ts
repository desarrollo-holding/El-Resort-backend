import type { RoomTypeModel } from "../../models/RoomType.model";
import type { RoomTypeReducedDetailModel, RoomTypeReducedModel } from "../../models/RoomTypeReduced.model";
import { preferLocalText, preferLocalNumber } from "../../utils/localOverride";
import type { LocalSpecsNormalized, LocalPricingNormalized, ReducedMappingOptions } from "./types";
import { buildDefaultLocalSpecs } from "./localSpecsIndex";

/**
 * Cuando una propiedad no tiene tarifa real de Cloudbeds (porque nunca existió ahí, o no hay
 * disponibilidad para las fechas pedidas), el schema del frontend (`pricing.baseRate`) exige un
 * objeto — no puede omitirse sin romper el parseo de toda la respuesta de `/api/rooms/show`.
 * `roomsAvailable: 0` marca a propósito "no reservable in-app": reservar sigue siendo 100% Cloudbeds.
 */
export const buildLocalBaseRateFallback = (
  roomTypeID: string,
  localPricing?: LocalPricingNormalized
): NonNullable<RoomTypeModel["pricing"]["baseRate"]> => ({
  rateID: `local:${roomTypeID}`,
  roomRate: localPricing?.totalRate ?? 0,
  totalRate: localPricing?.totalRate ?? 0,
  roomsAvailable: 0,
  isDerived: false,
});

export const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
export const asNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
export const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

export const normalizeRoomTypeFeatures = (value: unknown): string[] | undefined => {
  const arr = asStringArray(value);
  if (arr) return arr;

  const record = asRecord(value);
  if (!record) return undefined;

  return Object.keys(record)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => record[k])
    .filter((v): v is string => typeof v === "string");
};

export const toReducedModel = (
  model: RoomTypeModel,
  localSpecs?: LocalSpecsNormalized,
  options?: ReducedMappingOptions,
  localPricing?: LocalPricingNormalized
): RoomTypeReducedModel => {
  const ofertaDelMes = model.pricing.ratePlans.find((rp) => (rp.ratePlanNamePublic ?? "").trim() === "Oferta del Mes");
  const applyFallbackDefaults = options?.applyFallbackDefaults !== false;
  const resolvedSpecs = applyFallbackDefaults
    ? localSpecs && localSpecs.bedrooms.length > 0
      ? localSpecs
      : localSpecs
        ? { ...localSpecs, bedrooms: buildDefaultLocalSpecs().bedrooms }
        : buildDefaultLocalSpecs()
    : localSpecs ?? { bathroomsCount: 0, bedrooms: [] };
  const includeSpecs = applyFallbackDefaults || !!localSpecs;

  const result: Partial<Record<string, unknown>> = {
    roomTypeID: model.roomTypeID,
    roomTypeName: preferLocalText(localSpecs?.roomTypeNameLocalEs, model.presentation.roomTypeName),
    // El schema del frontend exige maxGuests siempre presente como number; 0 = "sin dato" (nunca undefined).
    maxGuests: preferLocalNumber(localSpecs?.maxGuestsLocal, model.presentation.maxGuests) ?? 0,
    pricing: {
      totalRate: localPricing?.totalRate ?? model.pricing.baseRate?.totalRate ?? 0,
      ofertaDelMesRoomRate: localPricing?.ofertaDelMesRoomRate ?? ofertaDelMes?.roomRate ?? 0,
    },
  };

  if (includeSpecs) {
    (result as any).bedroomsCount = resolvedSpecs.bedrooms.length;
    (result as any).bathroomsCount = resolvedSpecs.bathroomsCount ?? 0;
    (result as any).titleColor = resolvedSpecs.titleColor ?? null;
  }

  // Always include `portada` (may be null) so clients receive the field consistently
  (result as any).portada = localSpecs && localSpecs.portada ? localSpecs.portada : null;

  // Include posicion_fotos_portadas (may be null)
  (result as any).posicion_fotos_portadas = localSpecs && (localSpecs as any).posicion_fotos_portadas ? (localSpecs as any).posicion_fotos_portadas : null;

  // Include `portadaMenu` only when explicitly requested (detail responses)
  if (options?.includePortadaMenu) {
    (result as any).portadaMenu = localSpecs && localSpecs.portadaMenu ? localSpecs.portadaMenu : null;
  }

  if (!options?.portadaOnly) {
    (result as any).roomTypePhotos = model.presentation.roomTypePhotos;
  }

  return result as RoomTypeReducedModel;
};

export const toReducedDetailModel = (
  model: RoomTypeModel,
  localSpecs?: LocalSpecsNormalized,
  options?: ReducedMappingOptions,
  localPricing?: LocalPricingNormalized
): RoomTypeReducedDetailModel => {
  const applyFallbackDefaults = options?.applyFallbackDefaults !== false;
  const resolvedSpecs = applyFallbackDefaults
    ? localSpecs && localSpecs.bedrooms.length > 0
      ? localSpecs
      : localSpecs
        ? { ...localSpecs, bedrooms: buildDefaultLocalSpecs().bedrooms }
        : buildDefaultLocalSpecs()
    : localSpecs ?? { bathroomsCount: 0, bedrooms: [] };
  const includeSpecs = applyFallbackDefaults || !!localSpecs;
  const base = toReducedModel(model, localSpecs, { applyFallbackDefaults, includePortadaMenu: options?.includePortadaMenu }, localPricing);

  // For the detailed view we must NOT expose `portada` anymore; instead always expose `portadaMenu` (may be null)
  const result: any = { ...base };
  delete result.portada;
  result.portadaMenu = localSpecs && localSpecs.portadaMenu ? localSpecs.portadaMenu : null;
  result.posicion_fotos_portadas = localSpecs && (localSpecs as any).posicion_fotos_portadas ? (localSpecs as any).posicion_fotos_portadas : null;

  // `beneficios` manda cuando la propiedad ya tiene catálogo asignado; si está vacío se envía
  // `roomTypeFeatures` para que la ficha nunca quede sin comodidades.
  //
  // Ese respaldo ya NO viene de Cloudbeds: está congelado en `beneficiosTexto` dentro de la propia
  // propiedad. Se mantiene `model.presentation.roomTypeFeatures` como último recurso solo mientras
  // dure la transición — cuando se corte la integración ese valor llegará siempre vacío y el
  // operador `??` se quedará con el local sin que cambie nada de lo que ve el visitante.
  const beneficios = localSpecs?.beneficios ?? [];
  const beneficiosTexto = localSpecs?.beneficiosTexto ?? [];

  return {
    ...result,
    roomTypeDescription: preferLocalText(localSpecs?.roomTypeDescriptionLocalEs, model.presentation.roomTypeDescription),
    roomTypeFeatures: beneficiosTexto.length > 0 ? beneficiosTexto : model.presentation.roomTypeFeatures,
    beneficios,
    ...(includeSpecs ? { bedrooms: resolvedSpecs.bedrooms } : {}),
  } as RoomTypeReducedDetailModel;
};
