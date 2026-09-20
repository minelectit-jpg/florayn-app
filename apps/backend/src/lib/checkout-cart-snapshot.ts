/** Detect standard cart mutations while bundle workflows release their locks. */
export function checkoutCartSnapshot(cart: any): string {
  return JSON.stringify((cart.items ?? []).map((item: any) => [
    item.id, item.variant_title, Number(item.quantity), Number(item.unit_price),
  ]).sort((a: any[], b: any[]) => String(a[0]).localeCompare(String(b[0]))))
}
