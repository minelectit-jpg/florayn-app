import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * The storefront needs the publishable key and the seed only prints it once.
 * Run: npx medusa exec ./src/migration-scripts/print-publishable-key.ts
 */
export default async function printPublishableKey({
  container,
}: {
  container: MedusaContainer
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const apiKeyModuleService: any = container.resolve(Modules.API_KEY)

  const keys = await apiKeyModuleService.listApiKeys({ type: "publishable" })

  if (!keys.length) {
    logger.warn("No publishable API key found. Has the seed been run?")
    return
  }

  for (const key of keys) {
    logger.info(`${key.title}: ${key.token}`)
  }
}
