export const name = "20260830190000-pos-staff-role-manager"

export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    "ALTER TABLE pos_staff MODIFY COLUMN role ENUM('manager','cashier') NOT NULL"
  )
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    "ALTER TABLE pos_staff MODIFY COLUMN role ENUM('cashier') NOT NULL"
  )
}
