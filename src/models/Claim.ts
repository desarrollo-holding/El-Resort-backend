import mongoose, { Schema, Document } from "mongoose";

export type ClaimAttachment = {
  url: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

export type ClaimDocumentType = "DNI" | "CE" | "PASAPORTE";
export type ClaimReportType = "RECLAMO" | "QUEJA";
export type ClaimContractedGood = "VENTA_INMUEBLE" | "HOSPEDAJE";

export type ClaimType = Document & {
  code: string;
  fullName: string;
  representativeName?: string;
  documentType: ClaimDocumentType;
  documentNumber: string;
  email: string;
  phone: string;
  reportType: ClaimReportType;
  summary: string;
  amountClaimed?: number | null;
  contractedGood: ClaimContractedGood;
  contractedGoodDetail: string;
  detail: string;
  request: string;
  acceptedTerms: boolean;
  attachments: ClaimAttachment[];
  consumerEmailSentAt?: Date | null;
  internalEmailSentAt?: Date | null;
  submittedIp?: string;
  submittedUserAgent?: string;
  createdAt: Date;
  updatedAt: Date;
};

const claimAttachmentSchema = new Schema<ClaimAttachment>(
  {
    url: { type: String, required: true },
    fileId: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
  },
  { _id: false }
);

const claimSchema: Schema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, index: true },
    fullName: { type: String, required: true, trim: true },
    representativeName: { type: String, required: false, trim: true },
    documentType: { type: String, required: true, enum: ["DNI", "CE", "PASAPORTE"] },
    documentNumber: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    reportType: { type: String, required: true, enum: ["RECLAMO", "QUEJA"] },
    summary: { type: String, required: true, trim: true },
    amountClaimed: { type: Number, required: false, default: null, min: 0 },
    contractedGood: {
      type: String,
      required: true,
      enum: ["VENTA_INMUEBLE", "HOSPEDAJE"],
    },
    contractedGoodDetail: { type: String, required: true, trim: true },
    detail: { type: String, required: true, trim: true },
    request: { type: String, required: true, trim: true },
    acceptedTerms: { type: Boolean, required: true },
    attachments: { type: [claimAttachmentSchema], required: true, default: [] },
    consumerEmailSentAt: { type: Date, required: false, default: null },
    internalEmailSentAt: { type: Date, required: false, default: null },
    submittedIp: { type: String, required: false },
    submittedUserAgent: { type: String, required: false },
  },
  { timestamps: true }
);

const Claim = mongoose.model<ClaimType>("Claim", claimSchema);

export default Claim;
