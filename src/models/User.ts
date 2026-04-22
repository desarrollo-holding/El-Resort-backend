import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  email: string;
  password: string;
  name: string;
  confirmed: boolean;
  rol: "admin" | "host" | "kitchen-admin" | "kitchen-host" | "delivery" | "chofer" | "marketing";
}

const userSchema: Schema = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  confirmed: {
    type: Boolean,
    default: false,
  },
  rol: {
    type: String,
    enum: ["admin", "host", "kitchen-admin", "kitchen-host", "delivery", "chofer", "marketing"],
    default: "host",
  },
});

const User = mongoose.model<IUser>("User", userSchema);

export default User;