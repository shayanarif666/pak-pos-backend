import { DataTypes } from "sequelize"
import { sequelize } from "../../db/sequelize.js"
import { modelOptions, uuidCol, uuidPk } from "../../db/columnTypes.js"

const text = { type: DataTypes.TEXT, allowNull: true }

export const WebsiteContent = sequelize.define(
  "WebsiteContent",
  {
    id: uuidPk(),
    store_id: uuidCol(false),
    store_id_int: { type: DataTypes.INTEGER, allowNull: false },
    homepage_headline: text,
    homepage_subheadline: text,
    about_title: text,
    about_body: text,
    about_mission: text,
    about_vision: text,
    contact_title: text,
    contact_body: text,
    faq_body: text,
    shipping_body: text,
    terms_body: text,
    privacy_body: text,
    footer_text: text,
  },
  {
    ...modelOptions,
    tableName: "website_content",
    indexes: [{ unique: true, fields: ["store_id"] }],
  }
)
