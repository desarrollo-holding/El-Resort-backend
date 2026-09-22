import { Router } from "express";
import { RoomsController } from "../Controllers/RoomsController";
import { RoomOgImageController } from "../Controllers/RoomOgImageController";

const router = Router();

// Solo quedan los dos endpoints del catalogo, que leen de Mongo. Los que consultaban
// disponibilidad y tarifas en Cloudbeds ("/", "/show", "/types") se retiraron con la integracion:
// ningun consumidor los llamaba ya.

router.get("/show-lite", RoomsController.showRoomTypesLite);
router.get("/show/:roomTypeID", RoomsController.showRoomTypeById);

// Imagen Open Graph de la ficha (la que ven WhatsApp/Facebook al compartir `/casa/<slug>`). Va
// despues de las dos anteriores para que un roomTypeID llamado "show" o "show-lite" no se las
// coma; el sufijo ".jpg" esta en la ruta a proposito, porque algunos scrapers miran la extension
// de la URL antes de mirar el Content-Type.
router.get("/:roomTypeID/og.jpg", RoomOgImageController.showRoomOgImage);

export default router;
