import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { queueStorefrontRevalidation } from "../lib/revalidate-storefront"
import {
  ensureTrackingSettingsRow,
  invalidateTrackingSettings,
  parseTrackingConfig,
  TRACKING_SETTINGS_ID,
  type TrackingConfig,
} from "../lib/tracking/settings"
import { TRACKING_MODULE } from "../modules/tracking"
import type TrackingModuleService from "../modules/tracking/service"

export type UpdateTrackingSettingsInput = { config: TrackingConfig }

/**
 * Saves the non-secret tracking config. The admin route has already validated
 * the patch (that needs the Privacy page state); this only normalises types.
 * Tokens never pass through a workflow: the engine can checkpoint its input to
 * Redis and workflow_execution (TRACKING.md 3.3).
 */
export const updateTrackingSettingsStep = createStep(
  "update-tracking-settings",
  async (input: UpdateTrackingSettingsInput, { container }) => {
    const config = parseTrackingConfig(input.config)
    // Fixed id with the concurrent-create retry: a singleton even on first save.
    await ensureTrackingSettingsRow(container)
    const service: TrackingModuleService = container.resolve(TRACKING_MODULE)
    await service.updateTrackingSettings({ id: TRACKING_SETTINGS_ID, config })
    invalidateTrackingSettings()
    // Saving succeeds even if the bounded storefront refresh is offline.
    void queueStorefrontRevalidation({ tags: ["content:tracking"] })
    return new StepResponse(config)
  }
)

export const updateTrackingSettingsWorkflow = createWorkflow(
  "update-tracking-settings",
  (input: UpdateTrackingSettingsInput) => {
    const config = updateTrackingSettingsStep(input)
    return new WorkflowResponse({ config })
  }
)
