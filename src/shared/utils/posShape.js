/**
 * Whether a reply uses the POS / endpoint-documentation shape (short numbers, reference summaries).
 * The POS always does; the dashboard does too for every staff member (store admin, manager, cashier),
 * so the dashboard and the POS read the same structure. A web shop customer keeps the older shape.
 */
const STAFF = new Set(["store_admin", "manager", "cashier"])

export function posShape(req) {
  return req.auth?.channel === "pos" || STAFF.has(req.user?.role)
}
