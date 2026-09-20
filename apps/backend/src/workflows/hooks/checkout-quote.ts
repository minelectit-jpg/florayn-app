import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { MedusaError } from "@medusajs/framework/utils"
import { quoteFromCart, quoteVersionsMatch } from "../checkout-service"

/** Runs after Medusa acquires its cart lock, before it creates the order. */
export function validateAcceptedQuote(cart: any) {
  const expected = cart.metadata?.checkout_quote_version
  if (!expected) throw new MedusaError(MedusaError.Types.INVALID_DATA, "CHECKOUT_QUOTE_REQUIRED")
  const methods = cart.shipping_methods ?? []
  const shipping = methods[0]
  if (methods.length !== 1 || !shipping) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "CHECKOUT_QUOTE_CHANGED")
  }
  const quote = quoteFromCart(cart, cart.shipping_address?.province ?? "",
    { id: shipping.shipping_option_id, name: shipping.name }, 0)
  const payment = cart.payment_collection
  if (!quoteVersionsMatch(expected, quote.version) || Number(payment?.amount) !== quote.total || payment?.currency_code !== quote.currency_code) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "CHECKOUT_QUOTE_CHANGED")
  }
}

completeCartWorkflow.hooks.validate(async ({ cart }) => {
  validateAcceptedQuote(cart)
})
