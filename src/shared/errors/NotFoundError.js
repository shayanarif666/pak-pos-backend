import { AppError } from "./AppError.js"

export class NotFoundError extends AppError {
  constructor(message = "Route not found") {
    super(message, 404)
  }
}
