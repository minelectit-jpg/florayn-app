import type { Metadata } from "next"
import { redirect } from "next/navigation"

import ShopView, { shopMetadata } from "@/components/shop-view"
import { withAudience } from "@/lib/audience"

type Params = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

export async function generateMetadata(): Promise<Metadata> {
  return shopMetadata({})
}

/**
 * /shop is the bare landing (everything). Old links used
 * ?filter_device=&filter_case-type= (and florayn.com's Men links add
 * &filter_gender=men); those now 301 to the clean path in the right mode so no
 * bookmark or copied florayn.com link breaks.
 */
export default async function ShopPage({ searchParams }: Params) {
  const query = await searchParams
  const deviceSlug = first(query.filter_device)
  const caseTypeSlug = first(query["filter_case-type"])
  const audience = first(query.filter_gender) === "men" ? "men" : "women"
  if (deviceSlug) {
    redirect(withAudience(
      caseTypeSlug ? `/shop/${deviceSlug}/${caseTypeSlug}/` : `/shop/${deviceSlug}/`,
      audience
    ))
  }
  if (audience === "men") redirect("/men/shop/")
  return <ShopView />
}
