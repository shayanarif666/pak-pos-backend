export function addOneMonth(from) {
  const src = new Date(from)
  const year = src.getFullYear()
  const month = src.getMonth() + 1
  const lastDay = new Date(year, month + 1, 0).getDate()
  const day = Math.min(src.getDate(), lastDay)
  const out = new Date(src.getTime())
  out.setFullYear(year, month, day)
  return out
}

export function isExpired(expiresAt, now = new Date()) {
  return new Date(expiresAt).getTime() <= now.getTime()
}
