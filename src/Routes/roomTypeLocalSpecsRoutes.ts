import { Router } from "express";
import { body, param } from "express-validator";
import multer from "multer";
import { createMemoryUpload } from "../config/upload";
import { RoomTypeLocalSpecsController } from "../Controllers/RoomTypeLocalSpecsController";
import { handleInputErrors } from "../middleware/validation";
import { authenticate } from "../middleware/auth";
import { hasRole } from "../middleware/hasRole";

const router = Router();
// Hasta 50 archivos (fotos de dormitorios + video) en el mismo multipart; el tamaño por archivo
// usa el límite global (MAX_UPLOAD_FILE_SIZE_BYTES/MB, 20 MB por defecto) para que el video no
// pese tanto como para afectar la performance de carga de la página.
const upload = createMemoryUpload(50);

// Bulk update of `orden` for multiple roomTypeIDs
router.put(
  "/orden",
  // Accept either a JSON array or an object with numeric keys (0,1,...)
  body().custom((value, { req }) => {
    const body = req.body;
    if (Array.isArray(body)) return true;
    if (body && typeof body === "object") {
      const keys = Object.keys(body);
      if (keys.length === 0) throw new Error("body debe ser un array");
      const allNumeric = keys.every((k) => /^\d+$/.test(k));
      if (allNumeric) return true;
    }
    throw new Error("body debe ser un array");
  }),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  RoomTypeLocalSpecsController.updateOrderBulk
);

router.get(
  "/",
  authenticate,
  hasRole(["marketing"]),
  RoomTypeLocalSpecsController.getAllAdmin
);

router.patch(
  "/:roomTypeID/deactivate",
  param("roomTypeID").isString().notEmpty().withMessage("roomTypeID es requerido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  RoomTypeLocalSpecsController.softDelete
);

router.patch(
  "/:roomTypeID/reactivate",
  param("roomTypeID").isString().notEmpty().withMessage("roomTypeID es requerido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  RoomTypeLocalSpecsController.reactivate
);

router.post(
  "/duplicate",
  body("sourceRoomTypeID").isString().notEmpty().withMessage("sourceRoomTypeID es requerido"),
  body("newRoomTypeName").isString().trim().notEmpty().withMessage("newRoomTypeName es requerido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  RoomTypeLocalSpecsController.duplicate
);

router.post(
  "/",
  body("roomTypeName").isString().trim().notEmpty().withMessage("roomTypeName es requerido"),
  body("roomTypeDescription").optional().isString().withMessage("roomTypeDescription debe ser string"),
  body("bathroomsCount").isInt({ min: 0 }).withMessage("bathroomsCount debe ser un entero >= 0"),
  body("condominioID").optional().isMongoId().withMessage("condominioID debe ser un ObjectId valido"),
  body("bedrooms").isArray().withMessage("bedrooms debe ser un array"),
  body("bedrooms.*.number").isInt({ min: 1 }).withMessage("bedrooms[].number debe ser un entero >= 1"),
  body("bedrooms.*.description").optional().isString().withMessage("bedrooms[].description debe ser string"),
  body("bedrooms.*.photos").optional().isArray().withMessage("bedrooms[].photos debe ser un array"),
  body("bedrooms.*.photos.*").optional().isString().withMessage("Cada photo debe ser string"),
  body("video_url").optional().isArray().withMessage("video_url debe ser un array"),
  body("video_url.*").optional().isString().withMessage("Cada video_url debe ser string"),
  body("video_url_mobile").optional().isArray().withMessage("video_url_mobile debe ser un array"),
  body("video_url_mobile.*").optional().isString().withMessage("Cada video_url_mobile debe ser string"),
  body("extraGalleryImages").optional().isArray().withMessage("extraGalleryImages debe ser un array"),
  body("extraGalleryImages.*").optional().isString().withMessage("Cada extraGalleryImages debe ser string"),
  body("pricing").optional().isObject().withMessage("pricing debe ser un objeto"),
  body("pricing.totalRate").optional().isFloat({ min: 0 }).withMessage("pricing.totalRate debe ser number >= 0"),
  body("pricing.ofertaDelMesRoomRate")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("pricing.ofertaDelMesRoomRate debe ser number >= 0"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  RoomTypeLocalSpecsController.create
);

router.get(
  "/:roomTypeID",
  param("roomTypeID").isString().notEmpty().withMessage("roomTypeID es requerido"),
  handleInputErrors,
  RoomTypeLocalSpecsController.getByRoomTypeID
);

router.put(
  "/:roomTypeID",
  upload.any(),
  param("roomTypeID").isString().notEmpty().withMessage("roomTypeID es requerido"),
  body("payload").optional().isString().withMessage("payload debe ser string JSON en multipart"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  RoomTypeLocalSpecsController.updateByRoomTypeID
);

export default router;
