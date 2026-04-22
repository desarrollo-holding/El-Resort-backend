import type { Request, Response } from "express";
import User from "../models/User";
import { hashPassword, checkPassword } from "../utils/auth";
import { generateJWT } from "../utils/jwt";

/**
 * @openapi
 * /api/auth/create-account:
 *   post:
 *     tags: [Auth]
 *     summary: Crear cuenta
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateAccountRequest' }
 *     responses:
 *       201: { description: Usuario creado }
 *       400:
 *         description: Validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationErrorResponse' }
 *       409:
 *         description: Usuario existente
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/LoginRequest' }
 *     responses:
 *       200:
 *         description: JWT
 *         content:
 *           text/plain:
 *             schema: { type: string }
 *       400:
 *         description: Validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationErrorResponse' }
 *       401:
 *         description: Credenciales incorrectas
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Credenciales incorrectas
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       429: { description: Rate limit }
 *       500:
 *         description: Error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *
 * /api/auth/user:
 *   get:
 *     tags: [Auth]
 *     summary: Obtener usuario autenticado
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Usuario
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *
 * /api/auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Cambiar contraseña
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ChangePasswordRequest' }
 *     responses:
 *       200: { description: OK }
 *       400:
 *         description: Validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationErrorResponse' }
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export class AuthController {

  static createAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const { password, email } = req.body;

      const userExists = await User.findOne({ email });
      if (userExists) {
        res.status(409).json({ error: "Ya hay un usuario registrado con ese correo." });
        return;
      }

      const user = new User({
        ...req.body,
        confirmed: true,
        password: await hashPassword(password),
      });

      await user.save();
      res.status(201).json({ message: "Usuario creado correctamente." });
    } catch (error) {
      res.status(500).json({ error: "Hubo un error al crear el usuario." });
    }
  };

  static login = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;

      const user = await User.findOne({ email });
      if (!user) {
        res.status(404).json({ error: "Credenciales incorrectas." });
        return;
      }

      const isPasswordCorrect = await checkPassword(password, user.password);
      if (!isPasswordCorrect) {
        res.status(401).json({ error: "Credenciales incorrectas." });
        return;
      }

      const token = generateJWT({ id: user.id, rol: user.rol });
      res.send(token);
    } catch (error) {
      res.status(500).json({ error: "Hubo un error." });
    }
  };

  static user = async (req: Request, res: Response): Promise<void> => {
    res.json(req.user);
  };

  static changePassword = async (req: Request, res: Response): Promise<void> => {
    try {
      const { current_password, new_password, new_password_confirmation } = req.body;

      if (new_password !== new_password_confirmation) {
        res.status(400).json({ error: "Las nuevas contraseñas no coinciden." });
        return;
      }

      const userFromDB = await User.findById(req.user._id).select("+password");
      const isMatch = await checkPassword(current_password, userFromDB.password);
      if (!isMatch) {
        res.status(401).json({ error: "La contraseña actual es incorrecta." });
        return;
      }

      userFromDB.password = await hashPassword(new_password);
      await userFromDB.save();

      res.send("Contraseña actualizada correctamente.");
    } catch (error) {
      res.status(500).json({ error: "Hubo un error al cambiar la contraseña." });
    }
  };
}
