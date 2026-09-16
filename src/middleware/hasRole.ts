import { Request, Response, NextFunction } from "express";

/**
 * "Acceso denegado" a secas hacía imposible distinguir dos problemas muy distintos: no haber
 * iniciado sesión, y haberla iniciado con un usuario cuyo rol no alcanza. El mensaje ahora dice
 * cuál de los dos es y qué rol hace falta, que es lo único accionable.
 */
export const hasRole = (roles: string[]) => {
  const requeridos = roles.join(", ");

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: "No has iniciado sesión (o la sesión caducó). Vuelve a entrar al dashboard.",
        code: "NOT_AUTHENTICATED",
        hint: `Esta acción requiere un usuario con rol: ${requeridos}.`,
      });
      return;
    }

    if (!req.user.rol || !roles.includes(req.user.rol)) {
      res.status(403).json({
        error: `Tu usuario no tiene permiso para esta acción: hace falta el rol ${requeridos} y el tuyo es «${req.user.rol || "sin rol"}».`,
        code: "FORBIDDEN_ROLE",
        hint: "Pide a un administrador que cambie el rol de tu usuario, o entra con una cuenta que ya lo tenga.",
      });
      return;
    }

    next();
  };
};
