import { redirect } from "next/navigation"

import AccountDashboard from "@/components/account/account-dashboard"
import { getAccountOrders, getCurrentCustomer, listAddresses } from "@/lib/customer"

export const metadata = { title: "My account" }
export const dynamic = "force-dynamic"

export default async function AccountPage() {
  const customer = await getCurrentCustomer()
  if (!customer) redirect("/account/login")

  const [orders, addresses] = await Promise.all([getAccountOrders(), listAddresses()])

  return (
    <div className="py-8 md:py-12">
      <AccountDashboard customer={customer} orders={orders} addresses={addresses} />
    </div>
  )
}
