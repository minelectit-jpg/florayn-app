import { Module } from "@medusajs/framework/utils"

import OrderOpsModuleService from "./service"

export const ORDER_OPS_MODULE = "order_ops"

export default Module(ORDER_OPS_MODULE, {
  service: OrderOpsModuleService,
})
