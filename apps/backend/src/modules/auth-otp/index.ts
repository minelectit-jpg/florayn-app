import { Module } from "@medusajs/framework/utils"

import AuthOtpModuleService from "./service"

export const AUTH_OTP_MODULE = "auth_otp"

export default Module(AUTH_OTP_MODULE, {
  service: AuthOtpModuleService,
})
