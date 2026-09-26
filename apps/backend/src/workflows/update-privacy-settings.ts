// Saves the Privacy page (Admin > Privacy) and refreshes only /privacy/.
import { MedusaError } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { queueStorefrontRevalidation } from "../lib/revalidate-storefront"
import { CONTENT_MODULE } from "../modules/content"
import {
  DEFAULT_PRIVACY_SETTINGS,
  parsePrivacyPatch,
  present,
  PRIVACY_SETTINGS_ID,
  readPrivacySettings,
  type PrivacyPatch,
} from "../modules/content/privacy-settings"
import type ContentModuleService from "../modules/content/service"

// Checked against the saved row, so "publishing needs text" also holds for a
// caller that skipped the admin route's own check.
function validPatch(input: PrivacyPatch, saved: unknown): PrivacyPatch {
  const parsed = parsePrivacyPatch(input, present(saved))
  if (!parsed.ok) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      Object.values(parsed.errors).join(" ")
    )
  }
  return parsed.patch
}

export const updatePrivacySettingsStep = createStep(
  "update-privacy-settings",
  async (input: PrivacyPatch, { container }) => {
    const service: ContentModuleService = container.resolve(CONTENT_MODULE)
    const [current] = await service.listPrivacySettings({ id: PRIVACY_SETTINGS_ID }, { take: 1 })
    const patch = validPatch(input, current)
    // A stable primary key makes the setting a singleton, including first save.
    if (current) {
      await service.updatePrivacySettings({ id: PRIVACY_SETTINGS_ID, ...patch })
    } else {
      try {
        await service.createPrivacySettings({
          id: PRIVACY_SETTINGS_ID,
          ...DEFAULT_PRIVACY_SETTINGS,
          ...patch,
        })
      } catch (error) {
        // Another admin may have made the first save concurrently. Only retry
        // as an update when that singleton now exists, checked against what
        // they saved; preserve all other errors.
        const [created] = await service.listPrivacySettings({ id: PRIVACY_SETTINGS_ID }, { take: 1 })
        if (!created) throw error
        await service.updatePrivacySettings({ id: PRIVACY_SETTINGS_ID, ...validPatch(input, created) })
      }
    }
    const settings = await readPrivacySettings(container)
    // Saving content succeeds even if the bounded refresh delivery is offline.
    void queueStorefrontRevalidation({ tags: ["content:privacy"] })
    return new StepResponse(settings)
  }
)

export const updatePrivacySettingsWorkflow = createWorkflow(
  "update-privacy-settings",
  (input: PrivacyPatch) => {
    const settings = updatePrivacySettingsStep(input)
    return new WorkflowResponse({ settings })
  }
)
