import jwt from "jsonwebtoken";
import Types from "mongoose";

type UserPayload = {
  id: Types.ObjectId;
  rol: "admin" | "host" | "kitchen-admin" | "kitchen-host" | "delivery" | "chofer" | "marketing";
};

export const generateJWT = (payload: UserPayload) => {
  const token = jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: "180d",
  });
  return token;
};
