export const name = "20261127120000-variant-parent-low-stock-zero"

/*
 * A product with variants keeps low_stock_threshold 0: each variant has its own level (it was copied
 * from the product when the variant was made, so nothing is lost).
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    "UPDATE products SET low_stock_threshold = 0 WHERE has_variants = 1 AND parent_product_id IS NULL AND low_stock_threshold <> 0"
  )
}

export async function down() {}
