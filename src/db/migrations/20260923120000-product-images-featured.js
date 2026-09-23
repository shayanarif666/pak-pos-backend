export const name = "20260923120000-product-images-featured"

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  const [imagesCol] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'images'`
  )
  if (!imagesCol.length) {
    await sequelize.query(
      "ALTER TABLE products ADD COLUMN images JSON NULL AFTER image_url"
    )
  }

  const [featuredCol] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'featured_image'`
  )
  if (!featuredCol.length) {
    await sequelize.query(
      "ALTER TABLE products ADD COLUMN featured_image TEXT NULL AFTER images"
    )
  }

  await sequelize.query(`
    UPDATE products
    SET
      featured_image = COALESCE(featured_image, image_url),
      images = CASE
        WHEN images IS NULL AND image_url IS NOT NULL AND image_url != ''
          THEN JSON_ARRAY(JSON_OBJECT('url', image_url))
        WHEN images IS NULL THEN JSON_ARRAY()
        ELSE images
      END
  `)
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  const [featuredCol] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'featured_image'`
  )
  if (featuredCol.length) {
    await sequelize.query("ALTER TABLE products DROP COLUMN featured_image")
  }
  const [imagesCol] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'images'`
  )
  if (imagesCol.length) {
    await sequelize.query("ALTER TABLE products DROP COLUMN images")
  }
}
