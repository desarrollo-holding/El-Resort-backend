import { Router } from "express";
import { body } from "express-validator";
import { LandingPageSectionsController } from "../Controllers/LandingPageSectionsController";
import { handleInputErrors } from "../middleware/validation";
import { authenticate } from "../middleware/auth";
import { hasRole } from "../middleware/hasRole";

const router = Router();

router.post(
  "/",
  body("name").isString().notEmpty().withMessage("name es requerido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  LandingPageSectionsController.create
);

router.get("/", LandingPageSectionsController.list);

export default router;