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
        { name: "ReservationEdition", description: "Edición/confirmación de reservas (modelo propio)" },
        { name: "Rooms", description: "Catálogo de propiedades" },
        { name: "Izipay", description: "Pagos (Izipay / Lyra)" },
        { name: "RoomTypeSpecs", description: "Metadatos locales de room types" },
        { name: "Condominios", description: "Gestión de condominios" },
        { name: "Retiros", description: "Gestión de retiros" },
        { name: "FullDays", description: "Gestión de paquetes full day" },
        { name: "TextosLandingPage", description: "Textos dinámicos de landing por idioma y sección" },
        { name: "LandingPageSections", description: "Secciones reutilizables para textos de landing" },
        { name: "LandingMedia", description: "Configuraciones globales o por sección para media en landing" },
        { name: "Translate", description: "Traducción temporal de textos (es a en)" },
        { name: "Claims", description: "Libro de Reclamaciones Virtual" },
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
                  portadaMenu: { type: "string", nullable: true, description: "URL de la imagen para menu (portadaMenu). Solo en detalle" },
              },
            },
          },
          Claim: {
            type: "object",
            properties: {
              code: { type: "string", example: "REC-2026-00001" },
              fullName: { type: "string", example: "Juan Perez" },
              documentType: { type: "string", enum: ["DNI", "CE", "PASAPORTE"] },
              documentNumber: { type: "string", example: "12345678" },
              email: { type: "string", example: "juan@correo.com" },
              phone: { type: "string", example: "+51987654321" },
              reportType: { type: "string", enum: ["RECLAMO", "QUEJA"] },
              summary: { type: "string" },
              amountClaimed: { type: "number", nullable: true },
              contractedGood: {
                type: "string",
                enum: ["VENTA_INMUEBLE", "HOSPEDAJE"],
              },
              contractedGoodDetail: { type: "string" },
              detail: { type: "string" },
              request: { type: "string" },
              attachments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    url: { type: "string" },
                    originalName: { type: "string" },
                    mimeType: { type: "string" },
                    sizeBytes: { type: "number" },
                  },
                },
              },
              createdAt: { type: "string", format: "date-time" },
            },
          },
          CreateClaimMultipartRequest: {
            type: "object",
            required: [
              "fullName",
              "documentType",
              "documentNumber",
              "email",
              "phone",
              "reportType",
              "summary",
              "contractedGood",
              "contractedGoodDetail",
              "detail",
              "request",
              "accept",
            ],
            properties: {
              fullName: { type: "string", example: "Juan Perez" },
              representativeName: { type: "string", nullable: true },
              documentType: { type: "string", enum: ["DNI", "CE", "PASAPORTE"] },
              documentNumber: { type: "string", example: "12345678" },
              email: { type: "string", example: "juan@correo.com" },
              phone: { type: "string", example: "+51987654321" },
              reportType: { type: "string", enum: ["RECLAMO", "QUEJA"] },
              summary: { type: "string" },
              amountClaimed: { type: "string", nullable: true, example: "150.50" },
              contractedGood: {
                type: "string",
                enum: ["VENTA_INMUEBLE", "HOSPEDAJE"],
              },
              contractedGoodDetail: { type: "string" },
              detail: { type: "string" },
              request: { type: "string" },
              accept: { type: "string", example: "true" },
              attachments: {
                type: "array",
                items: { type: "string", format: "binary" },
              },
            },
          },
          ClaimSubmitResponse: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  code: { type: "string", example: "REC-2026-00001" },
                  id: { type: "string" },
                  submittedAt: { type: "string", format: "date-time" },
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
              encuadreImagen: {
                type: "object",
                nullable: true,
                description:
                  "Encuadre de la foto en la card, uno por viewport (\"x,y,ancho,alto\" en píxeles del archivo guardado). null = foto centrada. Al enviarlo: en multipart va como texto JSON; null, \"\" o \"null\" lo borran; con source_width/source_height y una foto subida en la misma petición, el servidor reescala las coordenadas al archivo que guarda. Si cambia la foto sin enviar encuadre, el anterior se borra.",
                properties: {
                  desktop_coordinates: { type: "string", example: "120,0,1164,960" },
                  mobile_coordinates: { type: "string", example: "140,0,1119,960" },
                  source_width: { type: "number", example: 4032 },
                  source_height: { type: "number", example: 3024 },
                },
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
          FullDay: {
            type: "object",
            description: "El horario es fijo (9am–6pm) y no se guarda: lo muestra el front como texto.",
            required: [
              "nombre",
              "descripcion",
              "idealPara",
              "cuposMaximos",
              "imagen",
              "incluye",
              "itinerario",
              "precioPorPersona",
              "disponible",
            ],
            properties: {
              _id: { type: "string", example: "68377eb74a64a493f851b34d" },
              nombre: { type: "string", example: "Full Day Relax" },
              descripcion: { type: "string", example: "x" },
              idealPara: { type: "string", example: "Familias y grupos de amigos" },
              cuposMaximos: { type: "number", example: 20 },
              imagen: {
                type: "string",
                example: "https://elresort.pe/wp-content/uploads/2025/05/fullday-scaled.webp",
              },
              incluye: {
                type: "array",
                items: { type: "string" },
                example: ["Almuerzo buffet", "Piscina", "Traslado"],
              },
              itinerario: {
                type: "array",
                items: { type: "string" },
                example: ["9:00am Llegada y bienvenida", "1:00pm Almuerzo buffet"],
              },
              precioPorPersona: { type: "number", example: 150 },
              disponible: { type: "boolean", example: true },
              fechaRegistro: { type: "string", format: "date-time" },
            },
          },
          CreateFullDayRequest: {
            allOf: [{ $ref: "#/components/schemas/FullDay" }],
          },
          CreateFullDayMultipartRequest: {
            type: "object",
            description:
              "Mismos campos que CreateFullDayRequest, pero como form-data: `incluye` e `itinerario` viajan serializados en JSON y `imagen` es el archivo.",
            properties: {
              nombre: { type: "string", example: "Full Day Relax" },
              descripcion: { type: "string" },
              idealPara: { type: "string", example: "Familias y grupos de amigos" },
              cuposMaximos: { type: "string", example: "20" },
              precioPorPersona: { type: "string", example: "150" },
              disponible: { type: "string", example: "true" },
              incluye: { type: "string", example: '["Almuerzo buffet","Piscina"]' },
              itinerario: { type: "string", example: '["9:00am Llegada","1:00pm Almuerzo"]' },
              imagen: {
                type: "string",
                format: "binary",
                description: "Archivo de imagen. Si se manda como texto, se interpreta como URL ya subida.",
              },
            },
          },
          Area: {
            type: "object",
            required: ["nombre", "categoria", "imagenes"],
            properties: {
              _id: { type: "string", example: "64a6c0f1f6a2c8e7e0c0a333" },
              nombre: { type: "string", example: "Spa" },
              categoria: { type: "string", enum: ["AREAS", "ACTIVIDADES_GRUPALES"], example: "AREAS" },
              imagenes: { type: "array", items: { type: "string" }, example: [] },
              encuadreImagen: {
                type: "object",
                nullable: true,
                description:
                  "Encuadre de la foto de la tarjeta, uno por viewport, en píxeles del orig guardado (\"x,y,ancho,alto\"). null = foto centrada.",
                properties: {
                  desktop_coordinates: { type: "string", example: "120,0,1600,1800" },
                  mobile_coordinates: { type: "string", example: "300,0,1500,1800" },
                },
              },
            },
          },
          CreateAreaRequest: {
            type: "object",
            required: ["nombre", "categoria"],
            properties: {
              nombre: { type: "string", example: "Spa" },
              categoria: { type: "string", enum: ["AREAS", "ACTIVIDADES_GRUPALES"], example: "AREAS" },
              imagenes: { type: "array", items: { type: "string" }, example: [] },
              encuadreImagen: {
                type: "object",
                nullable: true,
                description:
                  "Opcional. En multipart va como texto JSON. null, \"\" o \"null\" lo borran. source_width/source_height: tamaño de la imagen sobre la que se midieron las coordenadas; el servidor las reescala al archivo que guarda. Si cambia la foto sin enviar encuadre, el anterior se borra.",
                properties: {
                  desktop_coordinates: { type: "string", example: "200,0,2667,3000" },
                  mobile_coordinates: { type: "string", example: "500,0,2500,3000" },
                  source_width: { type: "number", example: 4032 },
                  source_height: { type: "number", example: 3024 },
                },
              },
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
                description: "URLs publicas del video de escritorio del room type",
                items: { type: "string" },
                example: ["https://storage.example.com/video-1.mp4"],
              },
              video_url_mobile: {
                type: "array",
                description: "URLs publicas del video vertical para movil; vacio = se usa el de escritorio",
                items: { type: "string" },
                example: ["https://storage.example.com/video-1-mobile.mp4"],
              },
              portada: { type: "string", nullable: true, description: "URL de la imagen portada (imagen principal)", example: "https://storage.example.com/cover-main.jpg" },
              portadaMenu: { type: "string", nullable: true, description: "URL de la imagen para menu (portadaMenu)", example: "https://storage.example.com/cover-menu.jpg" },
              portada_video: { type: "string", nullable: true, description: "URL de la imagen portada del video (solo una)", example: "https://storage.example.com/cover-1.jpg" },
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
                  portada: { type: "string", nullable: true, example: "https://storage.example.com/cover-main.jpg" },
                example: ["https://storage.example.com/video-1.mp4"],
              },
              portada_video: { type: "string", nullable: true, example: "https://storage.example.com/cover-1.jpg" },
              portadaMenu: { type: "string", nullable: true, example: "https://storage.example.com/cover-menu.jpg" },
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
              portada: { type: "string", nullable: true, example: "https://storage.example.com/cover-main-2.jpg" },
              portada_video: { type: "string", nullable: true, example: "https://storage.example.com/cover-2.jpg" },
              portadaMenu: { type: "string", nullable: true, example: "https://storage.example.com/cover-menu-2.jpg" },
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
                description: "URLs del video de escritorio que se conservan",
                items: { type: "string" },
                example: ["https://storage.example.com/video-previo.mp4"],
              },
              video_url_mobile: {
                type: "array",
                description: "URLs del video de movil que se conservan",
                items: { type: "string" },
                example: ["https://storage.example.com/video-previo-mobile.mp4"],
              },
              portada: { type: "string", description: "URL de portada (imagen principal) que se conserva (si existe)", nullable: true, example: "https://storage.example.com/cover-previo.jpg" },
              portadaMenu: { type: "string", description: "URL de portadaMenu que se conserva (si existe)", nullable: true, example: "https://storage.example.com/cover-menu-previo.jpg" },
              portada_video: { type: "string", description: "URL de portada de video que se conserva (si existe)", nullable: true, example: "https://storage.example.com/cover-previo.jpg" },
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
              portadaImageFiles: {
                type: "array",
                description: "Imagen de portada principal (jpg/png). Se usará la primera imagen si se envían varias.",
                items: { type: "string", format: "binary" },
              },
              portadaMenuImageFiles: {
                type: "array",
                description: "Imagen para menu (jpg/png). Se usará la primera imagen si se envían varias.",
                items: { type: "string", format: "binary" },
              },
              videoFiles: {
                type: "array",
                description: "Videos nuevos (escritorio) para anexar a video_url",
                items: { type: "string", format: "binary" },
              },
              videoMobileFiles: {
                type: "array",
                description: "Videos nuevos (movil) para anexar a video_url_mobile",
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
            required: ["roomTypeID", "roomTypeName", "bedroomsCount", "bathroomsCount", "pricing"],
            properties: {
              roomTypeID: { type: "string" },
              roomTypeName: { type: "string" },
              portada: { type: "string", nullable: true, description: "URL de la imagen de portada (show-lite)", example: "https://storage.example.com/cover-main.jpg" },
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
