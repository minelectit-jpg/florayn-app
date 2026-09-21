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
  CONTACT_SETTINGS_ID,
  DEFAULT_CONTACT_SETTINGS,
  parseContactSettingsPatch,
  readContactSettings,
  type ContactSettings,
} from "../modules/content/contact-settings"
import type ContentModuleService from "../modules/content/service"

export const updateContactSettingsStep = createStep(
  "update-contact-settings",
  async (input: Partial<ContactSettings>, { container }) => {
    const parsed = parseContactSettingsPatch(input)
    if (!parsed.ok) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        Object.values(parsed.errors).join(" ")
      )
    }
    const service: ContentModuleService = container.resolve(CONTENT_MODULE)
    const [current] = await service.listContactSettings({ id: CONTACT_SETTINGS_ID }, { take: 1 })
    // A stable primary key makes the setting a singleton, including first save.
    if (current) {
      await service.updateContactSettings({ id: CONTACT_SETTINGS_ID, ...parsed.patch })
    } else {
      try {
        await service.createContactSettings({
          id: CONTACT_SETTINGS_ID,
          ...DEFAULT_CONTACT_SETTINGS,
          ...parsed.patch,
        })
      } catch (error) {
        // Another admin may have made the first save concurrently. Only retry
        // as an update when that singleton now exists; preserve all other errors.
        const [created] = await service.listContactSettings({ id: CONTACT_SETTINGS_ID }, { take: 1 })
        if (!created) throw error
        await service.updateContactSettings({ id: CONTACT_SETTINGS_ID, ...parsed.patch })
      }
    }
    const settings = await readContactSettings(service)
    // Saving content succeeds even if the bounded refresh delivery is offline.
    void queueStorefrontRevalidation({ tags: ["content:contact"] })
    return new StepResponse(settings)
  }
)

export const updateContactSettingsWorkflow = createWorkflow(
  "update-contact-settings",
  (input: Partial<ContactSettings>) => {
    const settings = updateContactSettingsStep(input)
    return new WorkflowResponse({ settings })
  }
)

