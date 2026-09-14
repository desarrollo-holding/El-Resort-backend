import { Router } from "express";
import { body, param } from "express-validator";
import { createMemoryUpload } from "../config/upload";
import { FullDaysController } from "../Controllers/FullDaysController";
import { handleInputErrors } from "../middleware/validation";
import { authenticate } from "../middleware/auth";
import { hasRole } from "../middleware/hasRole";

const router = Router();
const upload = createMemoryUpload(1);

// `imagen` llega como archivo (multipart, dashboard) o como URL de texto en el body (JSON).
// Por eso no se valida aquí como string requerido: el controller exige que haya una de las dos.
router.post(
  "/",
  upload.array("imagen", 1),
  body("nombre").notEmpty().withMessage("El nombre es requerido"),
  body("descripcion").notEmpty().withMessage("La descripcion es requerida"),
  body("idealPara").notEmpty().withMessage("idealPara es requerido"),
  body("cuposMaximos").isNumeric().withMessage("cuposMaximos debe ser numérico"),
  body("precioPorPersona").isNumeric().withMessage("precioPorPersona debe ser numérico"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  FullDaysController.create
);

router.get("/", FullDaysController.list);

router.get(
  "/:id",
  param("id").isMongoId().withMessage("El id del full day no es válido"),
  handleInputErrors,
  FullDaysController.getById
);

router.put(
  "/:id",
  upload.array("imagen", 1),
  param("id").isMongoId().withMessage("El id del full day no es válido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  FullDaysController.updateById
);

router.delete(
  "/:id",
  param("id").isMongoId().withMessage("El id del full day no es válido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  FullDaysController.deleteById
);

export default router;
