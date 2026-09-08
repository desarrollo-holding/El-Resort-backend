import type { ClaimAttachment, ClaimType } from "../models/Claim";

const REPORT_TYPE_LABEL: Record<string, string> = {
  RECLAMO: "Reclamo",
  QUEJA: "Queja",
};

const CONTRACTED_GOOD_LABEL: Record<string, string> = {
  VENTA_INMUEBLE: "Venta de inmueble",
  HOSPEDAJE: "Hospedaje",
};

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  DNI: "DNI",
  CE: "CE",
  PASAPORTE: "Pasaporte",
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const nl2br = (value: string): string => escapeHtml(value).replace(/\n/g, "<br/>");

const formatDateEsPE = (date: Date): string =>
  new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "long", year: "numeric" }).format(date);

export type ClaimEmailData = Pick<
  ClaimType,
  | "code"
  | "fullName"
  | "representativeName"
  | "documentType"
  | "documentNumber"
  | "email"
  | "phone"
  | "reportType"
  | "summary"
  | "amountClaimed"
  | "contractedGood"
  | "contractedGoodDetail"
  | "detail"
  | "request"
  | "attachments"
  | "createdAt"
>;

export const ClaimEmailService = {
  /** Correo al consumidor: tono cercano, solo lo que le interesa a él. */
  buildConsumerConfirmationEmail(claim: ClaimEmailData): { subject: string; htmlContent: string } {
    const reportLabel = REPORT_TYPE_LABEL[claim.reportType] ?? claim.reportType;
    const goodLabel = CONTRACTED_GOOD_LABEL[claim.contractedGood] ?? claim.contractedGood;
    const fecha = formatDateEsPE(claim.createdAt ?? new Date());

    const amountRow =
      claim.amountClaimed != null
        ? `<tr><td style="padding:4px 0; color:#6b7280;">Monto reclamado:</td><td style="padding:4px 0; text-align:right;"><strong>S/ ${claim.amountClaimed}</strong></td></tr>`
        : "";

    const htmlContent = `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden;">
        <div style="background:#16a34a; padding:28px 24px; text-align:center;">
          <div style="font-size:34px; line-height:1;">&#9989;</div>
          <h1 style="color:#ffffff; font-size:21px; margin:10px 0 4px; font-weight:bold;">${escapeHtml(reportLabel)} Recibido</h1>
          <p style="color:#dcfce7; font-size:14px; margin:0;">Hemos registrado tu solicitud exitosamente</p>
        </div>

        <div style="padding:26px 24px; color:#1f2937;">
          <p style="font-size:15px; margin:0 0 12px;">Estimado/a <strong>${escapeHtml(claim.fullName)}</strong>,</p>
          <p style="font-size:15px; line-height:1.5; margin:0 0 16px;">
            Hemos recibido tu <strong>${escapeHtml(reportLabel)}</strong> y queremos confirmarte que ha sido
            registrada correctamente en nuestro sistema con el siguiente número de seguimiento:
          </p>

          <div style="border:2px dashed #86efac; background:#f0fdf4; border-radius:8px; text-align:center; padding:18px; margin:0 0 20px;">
            <div style="font-size:24px; font-weight:bold; color:#16a34a; letter-spacing:0.02em;">${escapeHtml(claim.code)}</div>
            <div style="font-size:12px; color:#4b5563; margin-top:6px; text-transform:uppercase; letter-spacing:0.06em;">Número de seguimiento</div>
          </div>

          <div style="background:#f9fafb; border-radius:8px; padding:16px; margin:0 0 16px;">
            <p style="font-weight:bold; margin:0 0 10px; font-size:14px;">&#128203; Resumen de tu solicitud:</p>
            <table style="width:100%; font-size:14px; border-collapse:collapse;">
              <tr><td style="padding:4px 0; color:#6b7280;">Fecha:</td><td style="padding:4px 0; text-align:right;"><strong>${escapeHtml(fecha)}</strong></td></tr>
              <tr><td style="padding:4px 0; color:#6b7280;">Servicio:</td><td style="padding:4px 0; text-align:right;"><strong>${escapeHtml(goodLabel)}</strong></td></tr>
              ${amountRow}
            </table>
          </div>

          <div style="background:#fffbeb; border-left:4px solid #f59e0b; border-radius:6px; padding:16px; margin:0 0 20px;">
            <p style="font-weight:bold; color:#92400e; margin:0 0 8px; font-size:14px;">&#9200; ¿Qué sigue ahora?</p>
            <ul style="margin:0; padding-left:18px; color:#78350f; font-size:13px; line-height:1.7;">
              <li>Tu ${escapeHtml(reportLabel.toLowerCase())} será evaluado por nuestro equipo especializado.</li>
              <li>El plazo máximo de atención es de 15 días hábiles desde su presentación, según el artículo 24 de la Ley 29571 Código de Protección y Defensa del Consumidor.</li>
              <li>Te notificaremos la respuesta a este mismo correo electrónico.</li>
            </ul>
          </div>

          <p style="font-size:12px; color:#9ca3af; line-height:1.5; margin:0;">
            La formulación de este ${escapeHtml(reportLabel.toLowerCase())} no impide acudir a otras vías de solución
            de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI.
          </p>
        </div>

        <div style="background:#f9fafb; padding:16px 24px; text-align:center; border-top:1px solid #e5e7eb;">
          <p style="font-size:12px; color:#9ca3af; margin:0;">MALON S.A.C. — RUC 20610176322</p>
          <p style="font-size:12px; color:#9ca3af; margin:2px 0 0;">MZA. . LOTE. 01 SECTOR YANASHPA. (ALT. YANASHPA VILLAGE) SAN MARTIN - SAN MARTIN - TARAPOTO</p>
        </div>
      </div>
    `;

    return { subject: `${reportLabel} registrado — ${claim.code}`, htmlContent };
  },

  /** Correo interno (equipo): todo el detalle técnico + urgencia del plazo INDECOPI. */
  buildInternalNotificationEmail(claim: ClaimEmailData): { subject: string; htmlContent: string } {
    const reportLabel = REPORT_TYPE_LABEL[claim.reportType] ?? claim.reportType;
    const goodLabel = CONTRACTED_GOOD_LABEL[claim.contractedGood] ?? claim.contractedGood;
    const docLabel = DOCUMENT_TYPE_LABEL[claim.documentType] ?? claim.documentType;
    const fecha = formatDateEsPE(claim.createdAt ?? new Date());

    const representativeRow = claim.representativeName
      ? `<tr><td style="padding:5px 0; color:#6b7280;">Representante:</td><td style="padding:5px 0;">${escapeHtml(claim.representativeName)}</td></tr>`
      : "";

    const amountLine =
      claim.amountClaimed != null ? `<br/><strong>Monto reclamado:</strong> S/ ${claim.amountClaimed}` : "";

    const attachmentsHtml =
      claim.attachments && claim.attachments.length > 0
        ? `<ul style="margin:0; padding-left:18px; font-size:13px;">${claim.attachments
            .map(
              (a: ClaimAttachment) =>
                `<li><a href="${escapeHtml(a.url)}" style="color:#f3602d;">${escapeHtml(a.originalName)}</a></li>`
            )
            .join("")}</ul>`
        : `<p style="margin:0; font-size:13px; color:#6b7280;">Sin archivos adjuntos.</p>`;

    const htmlContent = `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; background:#ffffff; border-radius:10px; overflow:hidden; border:1px solid #e5e7eb;">
        <div style="background:#f3f4f6; border-left:4px solid #dc2626; padding:16px 20px;">
          <p style="margin:0; font-size:18px; font-weight:bold; color:#1f2937;">&#128203; NUEVO ${escapeHtml(reportLabel.toUpperCase())} RECIBIDO</p>
          <p style="margin:4px 0 0; font-size:13px; color:#6b7280;">ID: ${escapeHtml(claim.code)} | ${escapeHtml(fecha)}</p>
        </div>

        <div style="padding:20px;">
          <div style="border:1px solid #e5e7eb; border-radius:8px; padding:16px; margin-bottom:16px;">
            <p style="font-weight:bold; margin:0 0 10px; font-size:14px;">&#128100; DATOS DEL USUARIO</p>
            <table style="width:100%; font-size:14px; border-collapse:collapse;">
              <tr><td style="padding:5px 0; color:#6b7280; width:35%;">Nombre:</td><td style="padding:5px 0;"><strong>${escapeHtml(claim.fullName)}</strong></td></tr>
              <tr><td style="padding:5px 0; color:#6b7280;">Documento:</td><td style="padding:5px 0;">${escapeHtml(docLabel)} ${escapeHtml(claim.documentNumber)}</td></tr>
              <tr><td style="padding:5px 0; color:#6b7280;">Email:</td><td style="padding:5px 0;"><a href="mailto:${escapeHtml(claim.email)}" style="color:#f3602d;">${escapeHtml(claim.email)}</a></td></tr>
              <tr><td style="padding:5px 0; color:#6b7280;">Teléfono:</td><td style="padding:5px 0;">${escapeHtml(claim.phone)}</td></tr>
              ${representativeRow}
            </table>
          </div>

          <div style="border-radius:8px; padding:16px; margin-bottom:16px; background:#fffbeb;">
            <p style="font-weight:bold; margin:0 0 8px; font-size:14px; color:#92400e;">&#9888; DETALLE DEL ${escapeHtml(reportLabel.toUpperCase())}</p>
            <p style="margin:0; font-size:14px; color:#78350f; line-height:1.7;">
              <strong>Tipo:</strong> ${escapeHtml(reportLabel)}<br/>
              <strong>Servicio:</strong> ${escapeHtml(goodLabel)} — ${escapeHtml(claim.contractedGoodDetail)}${amountLine}
            </p>
          </div>

          <p style="font-weight:bold; margin:16px 0 6px; font-size:14px;">&#128221; Resumen del problema:</p>
          <div style="background:#f9fafb; border-radius:6px; padding:12px; font-size:14px; color:#374151;">${nl2br(claim.summary)}</div>

          <p style="font-weight:bold; margin:16px 0 6px; font-size:14px;">&#128196; Detalle:</p>
          <div style="background:#f9fafb; border-radius:6px; padding:12px; font-size:14px; color:#374151;">${nl2br(claim.detail)}</div>

          <p style="font-weight:bold; margin:16px 0 6px; font-size:14px;">&#127919; Lo que solicita:</p>
          <div style="background:#f9fafb; border-radius:6px; padding:12px; font-size:14px; color:#374151;">${nl2br(claim.request)}</div>

          <p style="font-weight:bold; margin:16px 0 6px; font-size:14px;">&#128206; Archivos adjuntos:</p>
          ${attachmentsHtml}

          <div style="background:#dc2626; color:#ffffff; text-align:center; border-radius:6px; padding:14px; margin-top:20px;">
            <p style="margin:0; font-weight:bold; font-size:14px;">&#9888; ATENCIÓN REQUERIDA</p>
            <p style="margin:4px 0 0; font-size:12px;">
              Este ${escapeHtml(reportLabel.toLowerCase())} debe ser procesado dentro de los 15 días hábiles establecidos por la Ley 29571 (INDECOPI).
            </p>
          </div>
        </div>
      </div>
    `;

    return {
      subject: `Nuevo ${reportLabel.toLowerCase()} de ${claim.fullName} | Código: ${claim.code}`,
      htmlContent,
    };
  },
};
