import { Router } from "express";
import { body, param } from "express-validator";
import multer from "multer";
import { RoomTypeLocalSpecsController } from "../Controllers/RoomTypeLocalSpecsController";
import { handleInputErrors } from "../middleware/validation";
import { authenticate } from "../middleware/auth";
import { hasRole } from "../middleware/hasRole";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 50 } });

router.post(
  "/",
  body("roomTypeID").isString().notEmpty().withMessage("roomTypeID es requerido"),
  body("bathroomsCount").isInt({ min: 0 }).withMessage("bathroomsCount debe ser un entero >= 0"),
  body("condominioID").optional().isMongoId().withMessage("condominioID debe ser un ObjectId valido"),
  body("bedrooms").isArray().withMessage("bedrooms debe ser un array"),
  body("bedrooms.*.number").isInt({ min: 1 }).withMessage("bedrooms[].number debe ser un entero >= 1"),
  body("bedrooms.*.description").optional().isString().withMessage("bedrooms[].description debe ser string"),
  body("bedrooms.*.photos").optional().isArray().withMessage("bedrooms[].photos debe ser un array"),
  body("bedrooms.*.photos.*").optional().isString().withMessage("Cada photo debe ser string"),
  body("video_url").optional().isArray().withMessage("video_url debe ser un array"),
  body("video_url.*").optional().isString().withMessage("Cada video_url debe ser string"),
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
