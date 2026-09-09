export function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export async function ensureUniqueSlug(source, existsFn) {
  const root = slugify(source)
  if (!root) return ""
  let slug = root
  let n = 2
  while (await existsFn(slug)) {
    slug = `${root}-${n++}`
  }
  return slug
}
