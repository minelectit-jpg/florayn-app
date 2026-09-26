import { Module } from "@medusajs/framework/utils"

import TrackingModuleService from "./service"

export const TRACKING_MODULE = "tracking"

export default Module(TRACKING_MODULE, {
  service: TrackingModuleService,
})
