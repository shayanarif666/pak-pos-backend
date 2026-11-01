export const name = "20261104120000-offer-apply-mixed"

// An offer may now target several products and several categories at once (one offer_targets row
// each); offers.apply_to gains "mixed" for an offer that has both. Existing values stay valid.
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    "ALTER TABLE offers MODIFY apply_to ENUM('product','category','mixed') NOT NULL"
  )
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query("UPDATE offers SET apply_to = 'product' WHERE apply_to = 'mixed'")
  await queryInterface.sequelize.query("ALTER TABLE offers MODIFY apply_to ENUM('product','category') NOT NULL")
}
