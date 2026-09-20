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
  CHECKOUT_SETTINGS_ID,
  DEFAULT_CHECKOUT_SETTINGS,
  parseCheckoutSettingsPatch,
  readCheckoutSettings,
  type CheckoutSettings,
} from "../modules/content/checkout-settings"
import type ContentModuleService from "../modules/content/service"

export const updateCheckoutSettingsStep = createStep(
  "update-checkout-settings",
  async (input: Partial<CheckoutSettings>, { container }) => {
    const parsed = parseCheckoutSettingsPatch(input)
    if (!parsed.ok) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        Object.values(parsed.errors).join(" ")
      )
    }
    const service: ContentModuleService = container.resolve(CONTENT_MODULE)
    const [current] = await service.listCheckoutSettings({ id: CHECKOUT_SETTINGS_ID }, { take: 1 })
    // A stable primary key makes the setting a singleton, including first save.
    if (current) {
      await service.updateCheckoutSettings({ id: CHECKOUT_SETTINGS_ID, ...parsed.patch })
    } else {
      try {
        await service.createCheckoutSettings({
          id: CHECKOUT_SETTINGS_ID,
          ...DEFAULT_CHECKOUT_SETTINGS,
          ...parsed.patch,
        })
      } catch (error) {
        // Another admin may have made the first save concurrently. Only retry
        // as an update when that singleton now exists; preserve all other errors.
        const [created] = await service.listCheckoutSettings({ id: CHECKOUT_SETTINGS_ID }, { take: 1 })
        if (!created) throw error
        await service.updateCheckoutSettings({ id: CHECKOUT_SETTINGS_ID, ...parsed.patch })
      }
    }
    const settings = await readCheckoutSettings(service)
    // Saving content succeeds even if the bounded refresh delivery is offline.
    void queueStorefrontRevalidation({ tags: ["content:checkout"] })
    return new StepResponse(settings)
  }
)

export const updateCheckoutSettingsWorkflow = createWorkflow(
  "update-checkout-settings",
  (input: Partial<CheckoutSettings>) => {
    const settings = updateCheckoutSettingsStep(input)
    return new WorkflowResponse({ settings })
  }
)
