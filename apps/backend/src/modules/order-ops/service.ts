import { MedusaService } from "@medusajs/framework/utils"

import CourierSettings from "./models/courier-settings"
import ImportedOrder from "./models/imported-order"
import OrderImport from "./models/order-import"
import OrderOp from "./models/order-op"
import WhatsAppSettings from "./models/whatsapp-settings"

class OrderOpsModuleService extends MedusaService({
  OrderOp,
  CourierSettings,
  WhatsAppSettings,
  ImportedOrder,
  OrderImport,
}) {}

export default OrderOpsModuleService
