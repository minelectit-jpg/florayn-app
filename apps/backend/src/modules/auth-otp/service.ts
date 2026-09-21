import { MedusaService } from "@medusajs/framework/utils"

import OtpCode from "./models/otp-code"

class AuthOtpModuleService extends MedusaService({
  OtpCode,
}) {}

export default AuthOtpModuleService
