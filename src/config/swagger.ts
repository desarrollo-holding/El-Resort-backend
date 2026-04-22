import swaggerJSDoc from "swagger-jsdoc";

export const createSwaggerSpec = () => {
  const port = process.env.PORT || 4000;
  // Nota: Swagger UI es más consistente con URLs absolutas. Si necesitas otro host/IP, usa SWAGGER_SERVER_URL.
  const serverUrl = process.env.SWAGGER_SERVER_URL || `http://localhost:${port}`;

  const apis = process.env.NODE_ENV === "production" ? ["./dist/**/*.js"] : ["./src/**/*.ts"];

  return swaggerJSDoc({
    definition: {
      openapi: "3.0.0",
      info: {
        title: "El Resort Extras API",
        version: "1.0.0",
        description: "Backend base para reserva de extras",
      },
      servers: [{ url: serverUrl }, { url: "/" }],
      tags: [
        { name: "Auth", description: "Autenticación y usuario" },
        { name: "Extras", description: "Gestión de extras" },
        { name: "Areas", description: "Gestión de áreas" },
        { name: "Reservations", description: "Reservas (Cloudbeds)" },
        { name: "ReservationEdition", description: "Edición/confirmación de reservas (modelo propio)" },
        { name: "CustomFields", description: "Custom fields (Cloudbeds)" },
        { name: "Rates", description: "Rates (Cloudbeds)" },
        { name: "Rooms", description: "Rooms (Cloudbeds)" },
        { name: "Taxes", description: "Taxes and Fees (Cloudbeds)" },
        { name: "Items", description: "Items (Cloudbeds)" },
        { name: "Izipay", description: "Pagos (Izipay / Lyra)" },
        { name: "RoomTypeSpecs", description: "Metadatos locales de room types" },
        { name: "Condominios", description: "Gestión de condominios" },
        { name: "Retiros", description: "Gestión de retiros" },
        { name: "TextosLandingPage", description: "Textos dinámicos de landing por idioma y sección" },
        { name: "LandingPageSections", description: "Secciones reutilizables para textos de landing" },
        { name: "LandingMedia", description: "Configuraciones globales o por sección para media en landing" },
        { name: "Translate", description: "Traducción temporal de textos (es a en)" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
          paymentTokenAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "PAYMENT_TOKEN",
          },
        },
        schemas: {
          ErrorResponse: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          ValidationErrorResponse: {
            type: "object",
            properties: {
              errors: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string" },
                    msg: { type: "string" },
                    path: { type: "string" },
                    location: { type: "string" },
                  },
                },
              },
            },
          },
          CreateAccountRequest: {
            type: "object",
            required: ["name", "email", "password", "password_confirmation"],
            properties: {
              name: { type: "string", example: "Juan Perez" },
              email: { type: "string", example: "juan@correo.com" },
              password: { type: "string", example: "password123" },
              password_confirmation: { type: "string", example: "password123" },
            },
          },
          LoginRequest: {
            type: "object",
            required: ["email", "password"],
            properties: {
              email: { type: "string", example: "juan@correo.com" },
              password: { type: "string", example: "password123" },
            },
          },
          ChangePasswordRequest: {
            type: "object",
            required: ["current_password", "new_password", "new_password_confirmation"],
            properties: {
              current_password: { type: "string", example: "password123" },
              new_password: { type: "string", example: "password1234" },
              new_password_confirmation: { type: "string", example: "password1234" },
            },
          },
          User: {
            type: "object",
            properties: {
              _id: { type: "string", example: "64a6c0f1f6a2c8e7e0c0a111" },
              name: { type: "string", example: "Juan Perez" },
              email: { type: "string", example: "juan@correo.com" },
              rol: {
                type: "string",
                enum: ["admin", "host", "kitchen-admin", "kitchen-host", "delivery", "chofer", "marketing"],
                example: "host",
              },
            },
          },
          ExtraArea: {
            type: "object",
            required: ["nombre", "horarios", "stockArea"],
            properties: {
              nombre: { type: "string", example: "Spa" },
              horarios: { type: "array", items: { type: "string" }, example: ["09:00", "10:00"] },
              stockArea: { type: "number", example: 5 },
            },
          },
          ExtraFechaBloqueada: {
            type: "object",
            required: ["inicio"],
            properties: {
              inicio: { type: "string", format: "date-time" },
              fin: { type: "string", format: "date-time", nullable: true },
            },
          },
          Extra: {
            type: "object",
            required: ["nombre", "precio", "descripcion", "duracion"],
            properties: {
              _id: { type: "string", example: "64a6c0f1f6a2c8e7e0c0a222" },
              nombre: { type: "string", example: "Masaje" },
              precio: { type: "number", example: 120 },
              descripcion: { type: "string", example: "Masaje relajante" },
              grupo: { type: "string", nullable: true, example: "Wellness" },
              minPersonas: { type: "number", nullable: true, example: 1 },
              personas: { type: "number", nullable: true, example: 2 },
              montoAdicional: { type: "number", nullable: true, example: 30 },
              stock: { type: "number", nullable: true, example: 10 },
              imagenes: { type: "array", items: { type: "string" }, example: [] },
              diasNoDisponibles: { type: "array", items: { type: "string" }, nullable: true, example: [] },
              fechasBloqueadas: {
                type: "array",
                nullable: true,
                items: { $ref: "#/components/schemas/ExtraFechaBloqueada" },
              },
              duracion: { type: "number", example: 60, description: "Duración en minutos" },
              areas: { type: "array", nullable: true, items: { $ref: "#/components/schemas/ExtraArea" } },
            },
          },
          CreateExtraRequest: {
            allOf: [{ $ref: "#/components/schemas/Extra" }],
          },
          RetiroIncluye: {
            type: "object",
            required: ["yoga", "comidasPorDia", "masajesIncluidos", "trasladoIncluido"],
            properties: {
              yoga: { type: "boolean", example: true },
              comidasPorDia: { type: "number", example: 2 },
              masajesIncluidos: { type: "boolean", example: true },
              trasladoIncluido: { type: "boolean", example: true },
            },
          },
          RetiroActividad: {
            type: "object",
            required: ["dia", "actividadesDelDia"],
            properties: {
              dia: { type: "number", example: 1 },
              actividadesDelDia: {
                type: "array",
                items: { type: "string" },
                example: ["Yoga al atardecer"],
              },
            },
          },
          Retiro: {
            type: "object",
            required: [
              "nombre",
              "descripcion",
              "duracionNoches",
              "fechaInicio",
              "fechaFin",
              "idealPara",
              "cuposMaximos",
              "imagen",
              "incluye",
              "actividades",
              "precioPorPersona",
              "disponible",
            ],
            properties: {
              _id: { type: "string", example: "68377eb74a64a493f851b34d" },
              nombre: { type: "string", example: "Volver a ti" },
              descripcion: { type: "string", example: "x" },
              duracionNoches: { type: "number", example: 2 },
              fechaInicio: { type: "string", format: "date-time" },
              fechaFin: { type: "string", format: "date-time" },
              idealPara: { type: "string", example: "Un descanso real. Un respiro entre tanto ruido." },
              cuposMaximos: { type: "number", example: 6 },
              imagen: {
                type: "string",
                example: "https://elresort.pe/wp-content/uploads/2025/05/yoga2-scaled.webp",
              },
              incluye: { $ref: "#/components/schemas/RetiroIncluye" },
              actividades: {
                type: "array",
                items: { $ref: "#/components/schemas/RetiroActividad" },
              },
              precioPorPersona: { type: "number", example: 750 },
              disponible: { type: "boolean", example: false },
              fechaRegistro: { type: "string", format: "date-time" },
            },
          },
          CreateRetiroRequest: {
            allOf: [{ $ref: "#/components/schemas/Retiro" }],
          },
          Area: {
            type: "object",
            required: ["nombre", "categoria", "imagenes"],
            properties: {
              _id: { type: "string", example: "64a6c0f1f6a2c8e7e0c0a333" },
              nombre: { type: "string", example: "Spa" },
              categoria: { type: "string", enum: ["AREAS", "ACTIVIDADES_GRUPALES"], example: "AREAS" },
              imagenes: { type: "array", items: { type: "string" }, example: [] },
            },
          },
          CreateAreaRequest: {
            type: "object",
            required: ["nombre", "categoria"],
            properties: {
              nombre: { type: "string", example: "Spa" },
              categoria: { type: "string", enum: ["AREAS", "ACTIVIDADES_GRUPALES"], example: "AREAS" },
              imagenes: { type: "array", items: { type: "string" }, example: [] },
            },
            example: {
              nombre: "Spa",
              categoria: "AREAS",
              imagenes: ["https://example.com/area-1.jpg"],
            },
          },
          IzipayFormTokenRequest: {
            type: "object",
            required: ["amount", "currency", "orderId", "email", "firstName", "lastName"],
            properties: {
              amount: { type: "number", example: 120.5, description: "Monto en moneda (se convierte a centavos)" },
              currency: { type: "string", example: "PEN" },
              orderId: { type: "string", example: "RESORT-EXP-1773349199373" },
              email: { type: "string", example: "cliente@correo.com" },
              firstName: { type: "string", example: "Juan" },
              lastName: { type: "string", example: "Perez" },
              phoneNumber: { type: "string", nullable: true, example: "+51999999999" },
              identityType: { type: "string", nullable: true, example: "DNI" },
              identityCode: { type: "string", nullable: true, example: "12345678" },
              address: { type: "string", nullable: true, example: "Av. Siempre Viva 123" },
              country: { type: "string", nullable: true, example: "PE" },
              city: { type: "string", nullable: true, example: "Lima" },
              state: { type: "string", nullable: true, example: "Lima" },
              zipCode: { type: "string", nullable: true, example: "15001" },
              customerEmail: { type: "string", nullable: true, example: "cliente@correo.com" },
              customerName: { type: "string", nullable: true, example: "Juan Perez" },
            },
          },
          IzipayFormTokenResponse: {
            type: "object",
            properties: {
              formToken: { type: "string" },
              publicKey: { type: "string" },
            },
          },
          IzipaySignatureRequest: {
            type: "object",
            required: ["kr-answer", "kr-hash"],
            properties: {
              "kr-answer": { type: "string", description: "JSON string devuelto por Lyra/Izipay" },
              "kr-hash": { type: "string", description: "Firma HMAC-SHA256 en hex" },
            },
          },
          RoomTypeLocalSpecs: {
            type: "object",
            required: ["roomTypeID", "bathroomsCount", "bedrooms"],
            properties: {
              _id: { type: "string", example: "64a6c0f1f6a2c8e7e0c0a999" },
              roomTypeID: { type: "string", example: "12345" },
              bathroomsCount: { type: "integer", example: 1, minimum: 0 },
              bedrooms: {
                type: "array",
                items: {
                  type: "object",
                  required: ["number", "photos"],
                  properties: {
                    number: { type: "integer", example: 1, minimum: 1 },
                    description: { type: "string", nullable: true, example: "Dormitorio principal" },
                    photos: { type: "array", items: { type: "string" }, example: [] },
                  },
                },
              },
              video_url: {
                type: "array",
                description: "URLs publicas de videos del room type",
                items: { type: "string" },
                example: ["https://storage.example.com/video-1.mp4"],
              },
              extraGalleryImages: {
                type: "array",
                description: "Galeria extra de imagenes (jpg/png)",
                items: { type: "string" },
                example: ["https://storage.example.com/extra-1.jpg"],
              },
              pricing: {
                type: "object",
                properties: {
                  totalRate: { type: "number", nullable: true, minimum: 0, example: 2770 },
                  ofertaDelMesRoomRate: { type: "number", nullable: true, minimum: 0, example: 2350 },
                },
              },
              condominioID: { type: "string", nullable: true, example: "64a6c0f1f6a2c8e7e0c0b111" },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
          },
          CreateRoomTypeLocalSpecsRequest: {
            type: "object",
            required: ["roomTypeID", "bathroomsCount", "bedrooms"],
            properties: {
              roomTypeID: { type: "string", example: "12345" },
              bathroomsCount: { type: "integer", example: 1, minimum: 0 },
              bedrooms: {
                type: "array",
                items: {
                  type: "object",
                  required: ["number"],
                  properties: {
                    number: { type: "integer", example: 1, minimum: 1 },
                    description: { type: "string", nullable: true, example: "Dormitorio principal" },
                    photos: { type: "array", items: { type: "string" }, example: [] },
                  },
                },
              },
              video_url: {
                type: "array",
                items: { type: "string" },
                example: ["https://storage.example.com/video-1.mp4"],
              },
              extraGalleryImages: {
                type: "array",
                items: { type: "string" },
                example: ["https://storage.example.com/extra-1.jpg"],
              },
              pricing: {
                type: "object",
                properties: {
                  totalRate: { type: "number", nullable: true, minimum: 0, example: 2770 },
                  ofertaDelMesRoomRate: { type: "number", nullable: true, minimum: 0, example: 2350 },
                },
              },
              condominioID: { type: "string", nullable: true, example: "64a6c0f1f6a2c8e7e0c0b111" },
            },
          },
          UpdateRoomTypeLocalSpecsRequest: {
            type: "object",
            properties: {
              bathroomsCount: { type: "integer", example: 2, minimum: 0 },
              bedrooms: {
                type: "array",
                items: {
                  type: "object",
                  required: ["number"],
                  properties: {
                    number: { type: "integer", example: 1, minimum: 1 },
                    description: { type: "string", nullable: true, example: "Dormitorio secundario" },
                    photos: { type: "array", items: { type: "string" }, example: [] },
                  },
                },
              },
              video_url: {
                type: "array",
                items: { type: "string" },
                example: ["https://storage.example.com/video-2.mp4"],
              },
              extraGalleryImages: {
                type: "array",
                items: { type: "string" },
                example: ["https://storage.example.com/extra-2.png"],
              },
              pricing: {
                type: "object",
                properties: {
                  totalRate: { type: "number", nullable: true, minimum: 0, example: 2770 },
                  ofertaDelMesRoomRate: { type: "number", nullable: true, minimum: 0, example: 2350 },
                },
              },
              condominioID: { type: "string", nullable: true, example: "64a6c0f1f6a2c8e7e0c0b111" },
            },
          },
          UpdateRoomTypeLocalSpecsMultipartPayload: {
            type: "object",
            properties: {
              bathroomsCount: { type: "integer", example: 2, minimum: 0 },
              condominioID: { type: "string", nullable: true, example: "64a6c0f1f6a2c8e7e0c0b111" },
              pricing: {
                type: "object",
                properties: {
                  totalRate: { type: "number", nullable: true, minimum: 0, example: 2770 },
                  ofertaDelMesRoomRate: { type: "number", nullable: true, minimum: 0, example: 2350 },
                },
              },
              video_url: {
                type: "array",
                description: "URLs de videos que se conservan",
                items: { type: "string" },
                example: ["https://storage.example.com/video-previo.mp4"],
              },
              extraGalleryImages: {
                type: "array",
                description: "URLs de galeria extra que se conservan",
                items: { type: "string" },
                example: ["https://storage.example.com/extra-previo.jpg"],
              },
              bedrooms: {
                type: "array",
                items: {
                  type: "object",
                  required: ["number"],
                  properties: {
                    _id: { type: "string", nullable: true, example: "69e10f2aeff9291c01ff5250" },
                    clientKey: { type: "string", nullable: true, example: "tmp-b3" },
                    number: { type: "integer", example: 1, minimum: 1 },
                    description: { type: "string", nullable: true, example: "Dormitorio principal" },
                    keepUrls: {
                      type: "array",
                      description: "URLs existentes que se conservan",
                      items: { type: "string" },
                      example: ["https://example.com/prev-1.jpg"],
                    },
                  },
                },
              },
            },
          },
          UpdateRoomTypeLocalSpecsMultipartRequest: {
            type: "object",
            required: ["payload"],
            properties: {
              payload: {
                type: "string",
                description:
                  "JSON string con bathroomsCount, condominioID y bedrooms. Usa _id o clientKey para asociar archivos",
                example:
                  '{"bathroomsCount":1,"bedrooms":[{"_id":"69e10f2aeff9291c01ff5250","number":1,"description":"Principal","keepUrls":["https://example.com/anterior.jpg"]},{"clientKey":"tmp-b3","number":3,"description":"Nuevo","keepUrls":[]}]}',
              },
              bedroomFiles: {
                type: "array",
                description:
                  "Archivos nuevos. En el form-data cada campo debe llamarse bedroomFiles[<key>] donde <key> es _id, clientKey o number",
                items: { type: "string", format: "binary" },
              },
              videoFiles: {
                type: "array",
                description: "Videos nuevos para anexar a video_url",
                items: { type: "string", format: "binary" },
              },
              extraGalleryImageFiles: {
                type: "array",
                description: "Imagenes jpg/png nuevas para anexar a extraGalleryImages",
                items: { type: "string", format: "binary" },
              },
            },
          },
          RoomTypeReduced: {
            type: "object",
            required: ["roomTypeID", "roomTypeName", "roomTypePhotos", "bedroomsCount", "bathroomsCount", "pricing"],
            properties: {
              roomTypeID: { type: "string" },
              roomTypeName: { type: "string" },
              roomTypePhotos: { type: "array", items: { type: "string" } },
              maxGuests: { type: "integer", nullable: true, minimum: 0 },
              bedroomsCount: { type: "integer", minimum: 0 },
              bathroomsCount: { type: "integer", minimum: 0 },
              pricing: {
                type: "object",
                properties: {
                  totalRate: { type: "number", nullable: true },
                  ofertaDelMesRoomRate: { type: "number", nullable: true },
                },
              },
            },
          },
          RoomTypeReducedDetail: {
            allOf: [
              { $ref: "#/components/schemas/RoomTypeReduced" },
              {
                type: "object",
                required: ["bedrooms"],
                properties: {
                  roomTypeDescription: { type: "string", nullable: true },
                  roomTypeFeatures: { type: "array", nullable: true, items: { type: "string" } },
                  bedrooms: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["number", "photos"],
                      properties: {
                        number: { type: "integer", minimum: 1 },
                        description: { type: "string", nullable: true },
                        photos: { type: "array", items: { type: "string" } },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
    apis,
  });
};
