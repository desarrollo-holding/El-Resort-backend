import { Router } from "express";
import { body, param } from "express-validator";
import multer from "multer";
import { CondominiosController } from "../Controllers/CondominiosController";
import { handleInputErrors } from "../middleware/validation";
import { authenticate } from "../middleware/auth";
import { hasRole } from "../middleware/hasRole";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1 } });

router.post(
  "/",
  upload.single("map_url"),
  body("name").isString().notEmpty().withMessage("name es requerido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  CondominiosController.create
);

router.get("/", authenticate, hasRole(["marketing"]), CondominiosController.list);

router.get(
  "/:id",
  param("id").isString().notEmpty().withMessage("id es requerido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  CondominiosController.getById
);

router.put(
  "/:id",
  upload.single("map_url"),
  param("id").isString().notEmpty().withMessage("id es requerido"),
  body("name").isString().notEmpty().withMessage("name es requerido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  CondominiosController.updateById
);

router.delete(
  "/:id",
  param("id").isString().notEmpty().withMessage("id es requerido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  CondominiosController.deleteById
);

export default router;
