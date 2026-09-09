import { apiResponse } from "../../shared/utils/apiResponse.js"
import { asyncHandler } from "../../shared/utils/asyncHandler.js"
import * as adminService from "./admin.service.js"
import * as adminDataService from "./adminData.service.js"
import * as licenseService from "../stores/license.service.js"
import * as deviceService from "../pos/posDevice.service.js"

export const registerSuperAdmin = asyncHandler(async (req, res) => {
  const data = await adminService.registerSuperAdmin(req.body)
  return apiResponse(res, 201, "Super Admin created", data)
})

export const listDataModules = asyncHandler(async (_req, res) => {
  const data = adminDataService.listDataModules()
  return apiResponse(res, 200, "OK", data)
})

export const deleteAllDbData = asyncHandler(async (_req, res) => {
  const data = await adminDataService.deleteAllDbData()
  return apiResponse(res, 200, "All database rows deleted", data)
})

export const deleteModuleAll = asyncHandler(async (req, res) => {
  const data = await adminDataService.deleteModuleAll(req.params.module)
  return apiResponse(res, 200, `${req.params.module} rows deleted`, data)
})

export const deleteModuleById = asyncHandler(async (req, res) => {
  const data = await adminDataService.deleteModuleById(req.params.module, req.params.id)
  return apiResponse(res, 200, "Row deleted", data)
})

export const bulkDeleteModule = asyncHandler(async (req, res) => {
  const data = await adminDataService.bulkDeleteModule(
    req.params.module,
    req.body.ids
  )
  return apiResponse(res, 200, "Rows deleted", data)
})

export const registerStore = asyncHandler(async (req, res) => {
  const data = await adminService.registerStore(req.body, req.user)
  return apiResponse(res, 201, "Store registered", data)
})

export const listStores = asyncHandler(async (req, res) => {
  const data = await adminService.listStores()
  return apiResponse(res, 200, "OK", data)
})

export const getStore = asyncHandler(async (req, res) => {
  const data = await adminService.getStore(req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const patchStore = asyncHandler(async (req, res) => {
  const data = await adminService.patchStore(req.params.id, req.body)
  return apiResponse(res, 200, "Store updated", data)
})

export const createLicense = asyncHandler(async (req, res) => {
  const data = await licenseService.createLicense(req.body)
  return apiResponse(res, 201, "License created", data)
})

export const listLicenses = asyncHandler(async (req, res) => {
  const data = await licenseService.listAllLicenses()
  return apiResponse(res, 200, "OK", data)
})

export const getLicense = asyncHandler(async (req, res) => {
  const data = await licenseService.getAdminLicense(req.params.id)
  return apiResponse(res, 200, "OK", data)
})

export const patchLicense = asyncHandler(async (req, res) => {
  const data = await licenseService.updateLicense(req.params.id, req.body)
  return apiResponse(res, 200, "License updated", data)
})

export const listDevices = asyncHandler(async (req, res) => {
  const data = await deviceService.listAllDevices()
  return apiResponse(res, 200, "OK", data)
})

export const createDevice = asyncHandler(async (req, res) => {
  const data = await deviceService.adminCreateDevice(req.body)
  return apiResponse(res, 201, "Device registered", data)
})

export const revokeLicense = asyncHandler(async (req, res) => {
  const data = await licenseService.revokeLicense(
    req.params.id,
    req.body.revoked_reason
  )
  return apiResponse(res, 200, "License revoked", data)
})

export const renewLicense = asyncHandler(async (req, res) => {
  const data = await licenseService.renewLicense(req.params.id)
  return apiResponse(res, 200, "License renewed", data)
})
