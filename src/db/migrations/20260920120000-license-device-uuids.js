export const name = "20260920120000-license-device-uuids"

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize

  const [cols] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'store_licenses'
       AND COLUMN_NAME = 'device_uuids'`
  )
  if (!cols.length) {
    await sequelize.query(
      "ALTER TABLE store_licenses ADD COLUMN device_uuids JSON NULL AFTER device_id"
    )
  }

  await sequelize.query(`
    UPDATE store_licenses
    SET device_uuids = JSON_ARRAY()
    WHERE device_uuids IS NULL
  `)

  await sequelize.query(`
    UPDATE store_licenses sl
    INNER JOIN pos_devices pd ON pd.id = sl.device_id
    SET sl.device_uuids = JSON_ARRAY(
      JSON_OBJECT(
        'device_uid', pd.device_uid,
        'device_id', pd.id,
        'name', pd.name,
        'location_id', pd.location_id,
        'activated_at', DATE_FORMAT(COALESCE(sl.updated_at, sl.created_at), '%Y-%m-%dT%H:%i:%s.000Z')
      )
    )
    WHERE sl.device_id IS NOT NULL
      AND (
        sl.device_uuids IS NULL
        OR JSON_LENGTH(sl.device_uuids) = 0
      )
  `)

  await sequelize.query(`
    ALTER TABLE store_licenses
      MODIFY COLUMN device_uuids JSON NOT NULL
  `)
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize
  await sequelize.query("ALTER TABLE store_licenses DROP COLUMN device_uuids")
}
