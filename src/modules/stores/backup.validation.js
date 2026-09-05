import { AppError } from "../../shared/errors/AppError.js"

export function parseCreateBackup(body) {
  if (body.note === undefined || body.note === null || body.note === "") {
    return { note: null }
  }
  const note = String(body.note).trim()
  if (note.length > 2000) throw new AppError("note is too long", 400)
  return { note }
}
