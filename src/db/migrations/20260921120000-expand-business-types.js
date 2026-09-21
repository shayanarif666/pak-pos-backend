export const name = "20260921120000-expand-business-types"

const BUSINESS_TYPES =
  "ENUM('grocery','boutique','retail','pharmacy','restaurant','cafe','bakery','electronics','fashion','clothing','beauty','furniture','hardware','sports','books','jewelry','supermarket','convenience','wholesale','other')"

export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    `ALTER TABLE stores MODIFY COLUMN business_type ${BUSINESS_TYPES} NOT NULL`
  )
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(`
    UPDATE stores
    SET business_type = 'retail'
    WHERE business_type NOT IN ('grocery','boutique','retail','pharmacy')
  `)
  await queryInterface.sequelize.query(
    "ALTER TABLE stores MODIFY COLUMN business_type ENUM('grocery','boutique','retail','pharmacy') NOT NULL"
  )
}
