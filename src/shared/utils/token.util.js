import crypto from "crypto"

export function randomToken() {
  return crypto.randomBytes(32).toString("hex")
}

export function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex")
}
