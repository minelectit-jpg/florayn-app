import { MedusaService } from "@medusajs/framework/utils"

import CourierSettings from "./models/courier-settings"
import OrderOp from "./models/order-op"

class OrderOpsModuleService extends MedusaService({
  OrderOp,
  CourierSettings,
}) {}

export default OrderOpsModuleService
