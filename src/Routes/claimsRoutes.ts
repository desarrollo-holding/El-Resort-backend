import { Router } from "express";
import { body } from "express-validator";
import { createMemoryUpload } from "../config/upload";
import { ClaimsController } from "../Controllers/ClaimsController";
import { handleInputErrors } from "../middleware/validation";
import claimsLimiter from "../middleware/claimsLimiter";

const router = Router();
const upload = createMemoryUpload(5);

router.post(
  "/",
  claimsLimiter,
  upload.array("attachments", 5),
  body("fullName").trim().notEmpty().withMessage("fullName es requerido"),
  body("documentType").isIn(["DNI", "CE", "PASAPORTE"]).withMessage("documentType inválido"),
  body("documentNumber").trim().notEmpty().withMessage("documentNumber es requerido"),
  body("email").isEmail().withMessage("email inválido"),
  body("phone").trim().notEmpty().withMessage("phone es requerido"),
  body("reportType").isIn(["RECLAMO", "QUEJA"]).withMessage("reportType inválido"),
  body("summary").trim().notEmpty().withMessage("summary es requerido"),
  body("amountClaimed").optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage("amountClaimed debe ser number >= 0"),
  body("contractedGood")
    .isIn(["VENTA_INMUEBLE", "HOSPEDAJE"])
    .withMessage("contractedGood inválido"),
  body("contractedGoodDetail").trim().notEmpty().withMessage("contractedGoodDetail es requerido"),
  body("detail").trim().notEmpty().withMessage("detail es requerido"),
  body("request").trim().notEmpty().withMessage("request es requerido"),
  body("accept").custom((v) => v === "true").withMessage("Debes aceptar los términos"),
  handleInputErrors,
  ClaimsController.submit
);

export default router;
