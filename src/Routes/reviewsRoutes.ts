import { Router } from "express";
import { body } from "express-validator";
import { createMemoryUpload } from "../config/upload";
import { ReviewsController } from "../Controllers/ReviewsController";
import { handleInputErrors } from "../middleware/validation";
import { authenticate } from "../middleware/auth";
import { hasRole } from "../middleware/hasRole";

const router = Router();
const upload = createMemoryUpload(1);

// Público — la landing page lee las reseñas
router.get("/", ReviewsController.getAll);

// Dashboard — requiere auth + rol marketing
router.post(
  "/",
  authenticate,
  hasRole(["marketing"]),
  upload.array("avatar", 1),
  [
    body("name").trim().notEmpty().withMessage("Nombre es requerido"),
    body("text").trim().notEmpty().withMessage("Texto es requerido"),
    body("rating").isInt({ min: 1, max: 5 }).withMessage("Rating debe ser 1-5"),
  ],
  handleInputErrors,
  ReviewsController.create,
);

router.put(
  "/:reviewId",
  authenticate,
  hasRole(["marketing"]),
  upload.array("avatar", 1),
  ReviewsController.update,
);

router.delete(
  "/:reviewId",
  authenticate,
  hasRole(["marketing"]),
  ReviewsController.remove,
);

router.patch(
  "/reorder",
  authenticate,
  hasRole(["marketing"]),
  ReviewsController.reorder,
);

export default router;
