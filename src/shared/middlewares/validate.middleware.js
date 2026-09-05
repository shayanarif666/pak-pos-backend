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
