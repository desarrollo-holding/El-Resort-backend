import { Router } from "express";
import { body, param, query } from "express-validator";
import { TextosLandingPageController } from "../Controllers/TextosLandingPageController";
import { handleInputErrors } from "../middleware/validation";
import { authenticate } from "../middleware/auth";
import { hasRole } from "../middleware/hasRole";

const router = Router();

router.post(
  "/",
  body("idioma").isString().notEmpty().withMessage("idioma es requerido"),
  body("section").isMongoId().withMessage("section debe ser un id valido"),
  body("json").exists().withMessage("json es requerido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  TextosLandingPageController.create
);

router.get(
  "/",
  query("idioma").isString().notEmpty().withMessage("idioma es requerido"),
  handleInputErrors,
  TextosLandingPageController.list
);

router.get(
  "/section/:sectionId/es",
  param("sectionId").isMongoId().withMessage("sectionId debe ser un id valido"),
  handleInputErrors,
  TextosLandingPageController.getSpanishBySectionId
);

router.get(
  "/:id",
  param("id").isString().notEmpty().withMessage("id es requerido"),
  handleInputErrors,
  TextosLandingPageController.getById
);

router.patch(
  "/:id",
  param("id").isString().notEmpty().withMessage("id es requerido"),
  body("json").optional().exists().withMessage("json es requerido cuando se envia"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  TextosLandingPageController.updateById
);

router.delete(
  "/:id",
  param("id").isString().notEmpty().withMessage("id es requerido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  TextosLandingPageController.deleteById
);

export default router;