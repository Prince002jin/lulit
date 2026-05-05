import dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const jwtSecret = process.env.MESSAGING_JWT_SECRET || "";

if (isProduction) {
  if (!jwtSecret || jwtSecret.length < 32 || jwtSecret === "replace-me-before-production") {
    throw new Error(
      "MESSAGING_JWT_SECRET must be set to a strong value (>=32 chars) when NODE_ENV=production"
    );
  }
}

export const config = {
  port: Number(process.env.PORT || 8090),
  jwtSecret: jwtSecret || "dev-only-insecure-secret-change-me",
  corsOrigins: (process.env.MESSAGING_CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  pinataJwt: process.env.PINATA_JWT || "",
  pinataGatewayUrl: process.env.PINATA_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs",
  messageStoreFile: process.env.MESSAGE_STORE_FILE || "./data/messages-db.json",
  torSocksUrl: process.env.TOR_SOCKS_URL || ""
};
