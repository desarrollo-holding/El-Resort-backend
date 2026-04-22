import { Router } from "express";
import { param, body } from "express-validator";
import multer from "multer";
import { LandingMediaController } from "../Controllers/LandingMediaController";
import { handleInputErrors } from "../middleware/validation";
import { authenticate } from "../middleware/auth";
import { hasRole } from "../middleware/hasRole";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 100 } });

router.post(
  "/",
  upload.any(),
  body("payload").optional().isString().withMessage("payload debe ser string JSON en multipart"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  LandingMediaController.create
);

router.get("/", LandingMediaController.list);

router.get("/lookup", LandingMediaController.getByIdentifier);

router.get("/storage/files", LandingMediaController.listStorageFiles);
router.delete(
  "/storage/files",
  authenticate,
  hasRole(["marketing"]),
  LandingMediaController.deleteStorageFiles
);

router.patch(
  "/",
  upload.any(),
  body("payload").optional().isString().withMessage("payload debe ser string JSON en multipart"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  LandingMediaController.updateById
);

router.get(
  "/:id",
  param("id").isMongoId().withMessage("id debe ser un ObjectId valido"),
  handleInputErrors,
  LandingMediaController.getById
);

router.patch(
  "/:id",
  upload.any(),
  param("id").isMongoId().withMessage("id debe ser un ObjectId valido"),
  body("payload").optional().isString().withMessage("payload debe ser string JSON en multipart"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  LandingMediaController.updateById
);

router.delete(
  "/:id",
  param("id").isMongoId().withMessage("id debe ser un ObjectId valido"),
  handleInputErrors,
  authenticate,
  hasRole(["marketing"]),
  LandingMediaController.deleteById
);

export default router;
