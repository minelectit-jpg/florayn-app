import Link from "@/components/audience-link"
import { shopPath, shopRowColours, type ShopPhoneColours } from "@/lib/phone-colours"

/**
 * The shop's Phone color row, under the Model / Case type / Sort toolbar
 * (PHONE_COLOURS.md 7.2). A server component made of plain links, so it adds
 * no client code: each dot opens /shop/<device>/<case type>/<colour>/, and the
 * model's default colour opens the colour-less (canonical) page. Page 1
 * always: a colour only changes the pictures, not which designs are listed.
 *
 * Shown only with 2 or more colours that a published design has pictures in,
 * so AirPods, watch bands, wallets, models without a Mockup set and other
 * case types never show it.
 */
export default function ShopColourRow({
  palette,
  current,
  deviceSlug,
  caseTypeSlug,
  pageCaseTypeSlug,
}: {
  palette: ShopPhoneColours
  /** The colour of this page, or null on the colour-less page (the default). */
  current: string | null
  deviceSlug: string
  /** The case type in view, for the colour links. */
  caseTypeSlug: string
  /** The case type in this page's path, for the default colour's link. */
  pageCaseTypeSlug: string | null
}) {
  const colours = shopRowColours(palette)
  if (colours.length < 2) return null
  const selected = current ?? palette.default
  const name = colours.find((c) => c[0] === selected)?.[1]
  return (
    <div className="fl-shop-colours">
      <p className="fl-shop-colours__label">
        Phone color{name ? <span className="fl-shop-colours__name">{name}</span> : null}
      </p>
      <ul className="fl-colour-dots" aria-label="Phone color">
        {colours.map(([slug, label, hex]) => (
          <li key={slug}>
            <Link
              href={slug === palette.default
                ? shopPath(deviceSlug, pageCaseTypeSlug)
                : shopPath(deviceSlug, caseTypeSlug, slug)}
              prefetch={false}
              aria-current={slug === selected ? "true" : undefined}
              aria-label={label}
              title={label}
              className="fl-colour-dot"
            >
              <span style={{ backgroundColor: hex }} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
