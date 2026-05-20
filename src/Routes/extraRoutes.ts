import { Router } from "express";
import { body, param } from "express-validator";
import multer from "multer";
import { createMemoryUpload } from "../config/upload";
import { ExtraController } from "../Controllers/ExtraController";
import { handleInputErrors } from "../middleware/validation";
import { authenticate } from "../middleware/auth";

const router = Router();
const upload = createMemoryUpload(30);

//Crear extra 
router.post(
  "/", 
  authenticate,
  body("nombre").notEmpty().withMessage("El nombre del extra es requerido"),
  body("precio").notEmpty().withMessage("El precio del extra es requerido"),
  body("descripcion").notEmpty().withMessage("La descripcion del extra es requerida"),
  handleInputErrors,
  ExtraController.createExtra
);

//Obtener todos los extras
router.get("/", ExtraController.getAllExtras);

//Obtener todos los extras agrupados por grupo
router.get("/grouped", ExtraController.getExtrasGroupedByGrupo);

//Obtener un extra por id
router.get(
  "/:id",
  authenticate,
  param("id").isMongoId().withMessage("El id del extra no es válido"),
  handleInputErrors,
  ExtraController.getExtraById
);

//Actualizar extra
router.put(
  "/:id",
  authenticate,
  upload.array("imagenes", 1),
  param("id").isMongoId().withMessage("El id del extra no es válido"),
  body("nombre").notEmpty().withMessage("El nombre del extra es requerido"),
  body("precio").notEmpty().withMessage("El precio del extra es requerido"),
  body("descripcion").notEmpty().withMessage("La descripcion del extra es requerida"),
  handleInputErrors,
  ExtraController.updateExtra
);

//Eliminar extra
router.delete(
  "/:id",
  authenticate,
  param("id").isMongoId().withMessage("El id del extra no es válido"),
  handleInputErrors,
  ExtraController.deleteExtra
);

export default router;
