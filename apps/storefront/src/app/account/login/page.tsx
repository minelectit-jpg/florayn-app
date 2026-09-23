import { redirect } from "next/navigation"

import LoginFlow from "@/components/account/login-flow"
import { getCurrentCustomer } from "@/lib/customer"

export const metadata = { title: "Sign in", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

export default async function AccountLoginPage() {
  // A valid session skips the form; a stale/expired cookie falls through so the
  // shopper can sign in again (avoids a redirect loop with /account).
  const customer = await getCurrentCustomer()
  if (customer) redirect("/account/")

  return (
    <div className="py-2 md:py-4">
      <LoginFlow />
    </div>
  )
}
