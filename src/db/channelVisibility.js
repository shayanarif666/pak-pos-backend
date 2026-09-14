import { DataTypes } from "sequelize"
import { AppError } from "../shared/errors/AppError.js"
import { ORDER_CHANNEL, RECORD_CHANNEL } from "./enums.js"

export function visibilityFlagFields() {
  return {
    is_pos_visible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    is_web_visible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }
}

export function catalogChannelVisibilityFields() {
  return {
    ...visibilityFlagFields(),
    channel: {
      type: DataTypes.ENUM(...RECORD_CHANNEL),
      allowNull: false,
      defaultValue: "both",
    },
  }
}

export function saleChannelVisibilityFields() {
  return {
    ...visibilityFlagFields(),
    channel: {
      type: DataTypes.ENUM(...ORDER_CHANNEL),
      allowNull: false,
      defaultValue: "pos",
    },
  }
}

export function visibilityFromRecordChannel(channel) {
  if (channel === "web") {
    return { channel: "web", is_web_visible: true, is_pos_visible: false }
  }
  if (channel === "pos") {
    return { channel: "pos", is_web_visible: false, is_pos_visible: true }
  }
  return { channel: "both", is_web_visible: true, is_pos_visible: true }
}

export function visibilityFromOrderChannel(channel) {
  if (channel === "web") {
    return { channel: "web", is_web_visible: true, is_pos_visible: false }
  }
  return { channel: "pos", is_web_visible: false, is_pos_visible: true }
}

export function copyVisibility(row) {
  if (!row) {
    return visibilityFromRecordChannel("both")
  }
  const json = row.toJSON ? row.toJSON() : row
  return {
    is_pos_visible: json.is_pos_visible !== false,
    is_web_visible: json.is_web_visible !== false,
    channel: json.channel || "both",
  }
}

export function publicVisibility(json) {
  return {
    is_pos_visible: Boolean(json.is_pos_visible),
    is_web_visible: Boolean(json.is_web_visible),
    channel: json.channel ?? null,
  }
}

function readBool(body, keys) {
  for (const key of keys) {
    if (body[key] !== undefined) return Boolean(body[key])
  }
  return undefined
}

export function parseCatalogVisibility(body, { patch = false } = {}) {
  const pos = readBool(body, ["is_pos_visible", "pos_visible"])
  const web = readBool(body, ["is_web_visible", "web_visible"])
  let channel
  if (body.channel !== undefined && body.channel !== null && body.channel !== "") {
    channel = String(body.channel).trim()
    if (!RECORD_CHANNEL.includes(channel)) {
      throw new AppError("channel must be web, pos, or both", 400)
    }
  }

  if (patch && channel === undefined && pos === undefined && web === undefined) {
    return {}
  }

  if (channel && pos === undefined && web === undefined) {
    return visibilityFromRecordChannel(channel)
  }

  if (!channel && (pos !== undefined || web !== undefined)) {
    const is_pos_visible = pos ?? true
    const is_web_visible = web ?? true
    const derived =
      is_pos_visible && is_web_visible
        ? "both"
        : is_pos_visible
          ? "pos"
          : "web"
    return { channel: derived, is_pos_visible, is_web_visible }
  }

  if (patch) {
    const out = {}
    if (channel !== undefined) Object.assign(out, visibilityFromRecordChannel(channel))
    if (pos !== undefined) out.is_pos_visible = pos
    if (web !== undefined) out.is_web_visible = web
    if (pos !== undefined || web !== undefined) {
      const is_pos_visible = pos ?? true
      const is_web_visible = web ?? true
      out.channel =
        channel ||
        (is_pos_visible && is_web_visible ? "both" : is_pos_visible ? "pos" : "web")
    }
    return out
  }

  return {
    channel: channel || "both",
    is_pos_visible: pos ?? true,
    is_web_visible: web ?? true,
  }
}
