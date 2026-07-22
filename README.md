# El Resort — Backend

API REST del sistema de reservas de El Resort: gestión de tipologías/habitaciones, reservas,
extras, pagos (Izipay), medios (Google Cloud Storage), textos e imágenes de la landing y
traducción automática (es/en). Construido con **Node.js + Express + TypeScript** y **MongoDB
(Mongoose)**.

Frontend correspondiente: [`El-Resort-frontend`](https://github.com/desarrollo-holding/El-Resort-frontend).

## Stack

- **Express 4** + **TypeScript**.
- **MongoDB** con **Mongoose**.
- **JWT** + **bcrypt** para autenticación; **helmet**, **cors** y **express-rate-limit** para
  seguridad; **express-validator** para validación.
- Integraciones: **Cloudbeds** (reservas), **Izipay** (pagos), **Google Cloud Storage**
  (medios), **Gemini / Google Translate / LibreTranslate** (traducción), **socket.io** y
  **web-push / expo** (notificaciones).
- **Swagger** para documentación (`/api/docs`).
- **Jest** + **ts-jest** para tests unitarios.

## Requisitos

- Node.js 20+
- npm 10+
- Una instancia de MongoDB accesible (`DATABASE_URL`).

## Puesta en marcha

```bash
npm install
cp .env.example .env   # completa los valores (ver .env.example)
npm run dev            # servidor con recarga en http://localhost:4000
```

Si el puerto está ocupado y no fijaste `PORT`, el servidor reintenta con el siguiente puerto
libre. La documentación interactiva queda en `http://localhost:4000/api/docs`.

## Scripts

| Script | Descripción |
| --- | --- |
| `npm run dev` | Servidor de desarrollo (nodemon + ts-node). |
| `npm run build` | Compila TypeScript a `dist/`. |
| `npm start` | Ejecuta el build (`node ./dist/index.js`). |
| `npm test` | Ejecuta los tests con Jest. |
| `npm run test:watch` | Jest en modo watch. |

## Variables de entorno

Todas las variables están documentadas en `.env.example`, agrupadas por área (servidor, base
de datos, auth, Cloudbeds, Izipay, GCS, Supabase, traducción y subida de archivos). Como
mínimo necesitas `DATABASE_URL`, `JWT_SECRET` y `PAYMENT_TOKEN_SECRET` para arrancar con
funcionalidad básica.

## Estructura

```
src/
  app.ts          Configuración de Express (middleware, rutas, Swagger)
  index.ts        Arranque del servidor
  config/         Configuración (db, cors, swagger, integraciones)
  Routes/         Definición de rutas (/api/*)
  Controllers/    Manejadores de las rutas
  services/       Lógica de negocio
  models/         Esquemas de Mongoose
  middleware/     Auth, roles, rate limiting, validación
  integrations/   Clientes externos (Cloudbeds, Izipay, Gemini, ...)
  utils/          Utilidades puras (fechas, http, jwt, firmas Izipay, ...)
scripts/          Scripts de mantenimiento y migración (uso puntual)
```

## Tests

Los tests unitarios (Jest) cubren la lógica pura de `src/utils` (parseo de query params,
fechas, firmas HMAC de Izipay, tokens de pago, normalización de URLs de vídeo y utilidades de
traducción). Añade nuevos tests como `*.test.ts` junto al módulo que prueban.

## Scripts de mantenimiento

`scripts/` contiene scripts puntuales de migración/corrección de datos. Se ejecutan con
`node scripts/<archivo>.js` y usan `DATABASE_URL` de tu `.env` (no incrustes credenciales en
el código).
