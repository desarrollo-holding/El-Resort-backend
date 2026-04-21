import { Router } from "express";
import { body, param, query } from "express-validator";
import multer from "multer";
import { AreaController } from "../Controllers/AreaController";
import { handleInputErrors } from "../middleware/validation";
import { AREA_CATEGORIAS } from "../models/Area";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 30 } });

// Obtener todas las áreas
router.get(
  "/",
  query("categoria").optional().isIn(AREA_CATEGORIAS).withMessage("La categoría no es válida"),
  handleInputErrors,
  AreaController.getAllAreas
);

router.get(
  "/:id",
  param("id").isMongoId().withMessage("El id no es valido"),
  handleInputErrors,
  AreaController.getAreaById
);

// Crear área
router.post(
  "/",
  body("nombre").notEmpty().withMessage("El nombre del área es requerido"),
  body("categoria").notEmpty().withMessage("La categoría es requerida"),
  body("categoria").isIn(AREA_CATEGORIAS).withMessage("La categoría no es válida"),
  body("imagenes").optional().isArray().withMessage("Las imágenes deben ser un array"),
  body("imagenes.*").optional().isString().withMessage("Cada imagen debe ser un string"),
  handleInputErrors,
  AreaController.createArea
);

router.patch(
  "/:id",
  upload.array("imagenes", 1),
  param("id").isMongoId().withMessage("El id no es valido"),
  body("nombre").optional().isString().withMessage("El nombre debe ser texto"),
  handleInputErrors,
  AreaController.patchAreaById
);

router.delete(
  "/:id/imagenes",
  param("id").isMongoId().withMessage("El id no es valido"),
  body("imagen").optional().isString().withMessage("imagen debe ser string"),
  body("imagenes").optional().isArray().withMessage("imagenes debe ser un array"),
  body("imagenes.*").optional().isString().withMessage("Cada imagen debe ser string"),
  handleInputErrors,
  AreaController.deleteAreaImagesById
);

export default router;
