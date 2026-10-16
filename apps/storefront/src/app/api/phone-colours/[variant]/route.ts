import { getVariantPhoneColours } from "@/lib/catalog"
import { VARIANT_ID } from "@/lib/phone-colours"

/**
 * GET /api/phone-colours/<variant id>/ - one variant's extra phone colour
 * pictures, { base, galleries: { <colour>: [URL tails] } } (PHONE_COLOURS.md).
 * The product page loads it when the shopper switches to a model whose
 * colours are not in the page, or shows intent on a colour dot; never on page
 * load. Same origin, so there is no CORS preflight.
 *
 * The body comes from the data cache (tags products, catalog,
 * catalog:phone-colours; 60 s). The browser and CDN may keep it a minute: a
 * stale minute still points at valid pictures, because picture URLs are never
 * reused. Only real variants of published products answer 200, so the cache
 * holds no entry per made-up ID.
 */
export const dynamic = "force-dynamic"

const MISSING = { headers: { "cache-control": "no-store" }, status: 404 } as const

export async function GET(_request: Request, { params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params
  if (!VARIANT_ID.test(variant)) return Response.json({ message: "Unknown variant." }, MISSING)
  const data = await getVariantPhoneColours(variant)
  if (!data) return Response.json({ message: "Unknown variant." }, MISSING)
  return Response.json(data, {
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=600" },
  })
}
