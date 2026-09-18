import { type RoomTypeModel } from "../models/RoomType.model";
import type { RoomTypeReducedDetailModel, RoomTypeReducedModel } from "../models/RoomTypeReduced.model";
import { toReducedModel, toReducedDetailModel } from "./roomTypesShow/dto";
import { fetchRoomTypeLocalSpecsIndex, fetchRoomTypeLocalPricingIndex } from "./roomTypesShow/localSpecsIndex";


/**
 * Esqueleto de `RoomTypeModel` sin presentación ni inventario, para los endpoints del catálogo
 * público, que ya no hablan con Cloudbeds.
 *
 * Va vacío a propósito. `toReducedModel`/`toReducedDetailModel` resuelven cada campo con
 * `preferLocalText`/`preferLocalNumber` contra las specs locales, así que lo que antes llegaba de
 * Cloudbeds y luego se pisaba con el dato local ahora simplemente no llega: el resultado es el
 * mismo y desaparece la llamada de red. Los campos que Cloudbeds llenaba y este payload nunca
 * emitió (adultsIncluded, totalUnits, linkedRoom*) se van con ella.
 *
 * `roomTypePhotos` queda en `[]`: era el respaldo de foto y hoy las 16 propiedades activas tienen
 * portada local, así que los consumidores (`portada ?? roomTypePhotos[0]`) ni lo miran.
 */
const emptyPresentationModel = (roomTypeID: string): RoomTypeModel => ({
  roomTypeID,
  presentation: {
    roomTypeName: "",
    roomTypePhotos: [],
  },
  inventory: {
    roomIDs: [],
    roomNames: [],
  },
  pricing: {
    ratePlans: [],
  },
});

export const RoomTypesShowService = {
  /**
   * Fuente primaria: las propiedades administradas localmente (`RoomTypeLocalSpecs`), no el
   * catálogo de Cloudbeds — una propiedad sin equivalente en Cloudbeds igual aparece aquí.
   * Cloudbeds se usa solo como enriquecimiento oportunista (fotos/inventario/features) cuando
   * el `roomTypeID` coincide con uno real.
   */
  async listRoomTypesReducedCatalogWithLocalPricing(params: {
    maxGuests?: number;
  }): Promise<RoomTypeReducedModel[]> {
    const specsIndex = await fetchRoomTypeLocalSpecsIndex();
    const localRoomTypeIDs = Array.from(specsIndex.keys());
    if (localRoomTypeIDs.length === 0) return [];

    const full: RoomTypeModel[] = localRoomTypeIDs.map(emptyPresentationModel);

    const pricingIndex = await fetchRoomTypeLocalPricingIndex(localRoomTypeIDs);

    // Ordenar por `orden` ascendente; los que no tengan `orden` quedan al final
    full.sort((a, b) => {
      const oa = specsIndex.get(a.roomTypeID)?.orden;
      const ob = specsIndex.get(b.roomTypeID)?.orden;
      const va = Number.isFinite(oa as number) ? (oa as number) : Infinity;
      const vb = Number.isFinite(ob as number) ? (ob as number) : Infinity;
      if (va !== vb) return va - vb;
      return a.roomTypeID.localeCompare(b.roomTypeID);
    });

    return full.map((m) => toReducedModel(m, specsIndex.get(m.roomTypeID), { includePortadaMenu: true }, pricingIndex.get(m.roomTypeID)));
  },

  async getRoomTypeReducedDetailWithLocalPricing(params: {
    roomTypeID: string;
    maxGuests?: number;
  }): Promise<RoomTypeReducedDetailModel | null> {
    const specsIndex = await fetchRoomTypeLocalSpecsIndex([params.roomTypeID]);
    const localSpecs = specsIndex.get(params.roomTypeID);
    if (!localSpecs) return null;

    const model = emptyPresentationModel(params.roomTypeID);

    const pricingIndex = await fetchRoomTypeLocalPricingIndex([params.roomTypeID]);
    return toReducedDetailModel(
      model,
      localSpecs,
      { applyFallbackDefaults: false, portadaOnly: true, includePortadaMenu: true },
      pricingIndex.get(params.roomTypeID)
    );
  },

  };
