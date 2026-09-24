import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Star } from "@medusajs/icons"
import { Button, Container, Heading, Text } from "@medusajs/ui"
import { useSearchParams } from "react-router-dom"

import ReviewsEditor from "../../components/product-manager/reviews-editor"
import { RequestsTab, RewardsTab, useReviewProgram } from "../../components/reviews/review-program"
import { useWhatsApp, WhatsAppTab } from "../../components/reviews/whatsapp-tab"

const TABS = [
  ["reviews", "All reviews"],
  ["requests", "Review requests"],
  ["rewards", "Coupon rewards"],
  ["whatsapp", "WhatsApp"],
] as const

/**
 * Reviews: moderation, the "How is your Florayn order?" requests (email, and
 * WhatsApp for phone-only orders) and the discount codes reviews earn
 * (florayn.com's florayn-core review hub, rebuilt).
 */
const ProductReviewsPage = () => {
  const [params, setParams] = useSearchParams()
  const tab = params.get("tab") ?? "reviews"
  const program = useReviewProgram()
  const whatsapp = useWhatsApp()
  return <div className="grid gap-3">
    <Container className="grid gap-3">
      <div><Heading level="h1">Reviews</Heading><Text size="small" className="text-ui-fg-subtle">Moderate reviews, ask customers for one after delivery by email or WhatsApp, and reward them with a discount code.</Text></div>
      <nav aria-label="Reviews" className="flex flex-wrap gap-2">
        {TABS.map(([value, label]) => <Button key={value} size="small" variant={tab === value ? "primary" : "secondary"} onClick={() => setParams(value === "reviews" ? {} : { tab: value })}>
          {label}{value === "reviews" && program.stats?.pending ? ` (${program.stats.pending})` : ""}
        </Button>)}
      </nav>
    </Container>
    {tab === "requests" ? <RequestsTab program={program} whatsapp={whatsapp.info} />
      : tab === "rewards" ? <RewardsTab program={program} whatsapp={whatsapp.info} />
        : tab === "whatsapp" ? <WhatsAppTab whatsapp={whatsapp} />
          : <ReviewsEditor />}
  </div>
}

export default ProductReviewsPage
export const config = defineRouteConfig({ label: "Reviews", icon: Star })
