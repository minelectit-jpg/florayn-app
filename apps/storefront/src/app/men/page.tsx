import type { Metadata } from "next"

import HomePage from "@/components/pages/home-page"

export const metadata: Metadata = {
  title: "Men",
  description: "Florayn for men: printed phone cases, AirPods cases, watch bands and wallets.",
  alternates: { canonical: "/men/" },
}

/** The Men home page: its own sections, edited under Home page > Men in the admin. */
export default function MenHomePage() {
  return <HomePage audience="men" />
}
