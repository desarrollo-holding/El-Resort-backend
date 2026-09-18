import { Router } from "express";
import { RoomsController } from "../Controllers/RoomsController";

const router = Router();

// Solo quedan los dos endpoints del catalogo, que leen de Mongo. Los que consultaban
// disponibilidad y tarifas en Cloudbeds ("/", "/show", "/types") se retiraron con la integracion:
// ningun consumidor los llamaba ya.

router.get("/show-lite", RoomsController.showRoomTypesLite);
router.get("/show/:roomTypeID", RoomsController.showRoomTypeById);

export default router;
