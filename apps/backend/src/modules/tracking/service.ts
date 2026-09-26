import { MedusaService } from "@medusajs/framework/utils"

import TrackingSettings from "./models/tracking-settings"

/**
 * Only the settings row is a data model. The outbox, contexts, dashboard and
 * catalog tables are raw tables reached through lib/tracking/db.ts.
 */
class TrackingModuleService extends MedusaService({
  TrackingSettings,
}) {}

export default TrackingModuleService
