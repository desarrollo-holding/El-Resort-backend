import { Router } from "express";
import { body, param } from "express-validator";
import { RetirosController } from "../Controllers/RetirosController";
import { handleInputErrors } from "../middleware/validation";
import { authenticate } from "../middleware/auth";
import { hasRole } from "../middleware/hasRole";

const router = Router();

router.post(
  "/",
  body("nombre").notEmpty().withMessage("El nombre es requerido"),
  body("descripcion").notEmpty().withMessage("La descripcion es requerida"),
  body("duracionNoches").isNumeric().withMessage("duracionNoches debe ser numérico"),
  body("fechaInicio").isISO8601().withMessage("fechaInicio debe ser una fecha válida"),
  body("fechaFin").isISO8601().withMessage("fechaFin debe ser una fecha válida"),
  body("idealPara").notEmpty().withMessage("idealPara es requerido"),
  body("cuposMaximos").isNumeric().withMessage("cuposMaximos debe ser numérico"),
  body("imagen").isString().notEmpty().withMessage("imagen es requerida"),
  body("incluye").isObject().withMessage("incluye debe ser un objeto"),
  body("precioPorPersona").isNumeric().withMessage("precioPorPersona debe ser numérico"),
  body("disponible").isBoolean().withMessage("disponible debe ser booleano"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  RetirosController.create
);

router.get("/", RetirosController.list);

router.get(
  "/:id",
  param("id").isMongoId().withMessage("El id del retiro no es válido"),
  handleInputErrors,
  RetirosController.getById
);

router.put(
  "/:id",
  param("id").isMongoId().withMessage("El id del retiro no es válido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  RetirosController.updateById
);

router.delete(
  "/:id",
  param("id").isMongoId().withMessage("El id del retiro no es válido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  RetirosController.deleteById
);

export default router;
