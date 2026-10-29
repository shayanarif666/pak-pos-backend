export function validate(parseBody) {
  return (req, res, next) => {
    try {
      req.body = parseBody(req.body || {})
      next()
    } catch (err) {
      next(err)
    }
  }
}

/**
 * A route that takes one record or a POS offline batch ({ items: [...] }): a single body is
 * validated here; a batch is left to the controller, which validates each item on its own.
 */
export function validateOneOrBulk(parseBody) {
  const one = validate(parseBody)
  return (req, res, next) => (Array.isArray(req.body?.items) ? next() : one(req, res, next))
}
