import { lineDiscount, tierPricing } from "../pricing"

/** The two tiers running on florayn.com. */
const TWO_PACK = {
  quantity: 2,
  discount_amount: 300,
  min_pct: 8,
  max_pct: 12,
}
const THREE_PACK = {
  quantity: 3,
  discount_amount: 800,
  min_pct: 12,
  max_pct: 20,
}

describe("tierPricing", () => {
  it("lifts a flat discount up to the percentage floor", () => {
    // 300 off 3,900 is 7.7%, under the 8% floor, so the floor applies.
    expect(tierPricing(1950, TWO_PACK)).toEqual({
      quantity: 2,
      subtotal: 3900,
      discount: 312,
      total: 3588,
      discount_pct: 8,
      applied: "min_pct",
    })
  })

  it("leaves a flat discount alone inside the band", () => {
    // 800 off 5,850 is 13.7%, inside 12-20%.
    expect(tierPricing(1950, THREE_PACK)).toMatchObject({
      subtotal: 5850,
      discount: 800,
      total: 5050,
      applied: "flat",
    })
  })

  it("matches the live widget on a 1,400 case", () => {
    expect(tierPricing(1400, TWO_PACK)).toMatchObject({
      subtotal: 2800,
      discount: 300,
      total: 2500,
    })
    expect(tierPricing(1400, THREE_PACK)).toMatchObject({
      subtotal: 4200,
      discount: 800,
      total: 3400,
    })
  })

  it("pulls a flat discount down to the percentage ceiling", () => {
    // A deliberately huge flat amount is capped at 12% of 2,800.
    expect(
      tierPricing(1400, { ...TWO_PACK, discount_amount: 2000 })
    ).toMatchObject({ discount: 336, applied: "max_pct" })
  })

  it("treats a zero ceiling as uncapped", () => {
    expect(
      tierPricing(1400, { ...TWO_PACK, discount_amount: 2000, max_pct: 0 })
    ).toMatchObject({ discount: 2000, applied: "flat" })
  })

  it("never discounts past free", () => {
    expect(
      tierPricing(100, {
        quantity: 2,
        discount_amount: 5000,
        min_pct: 0,
        max_pct: 0,
      })
    ).toMatchObject({ subtotal: 200, discount: 200, total: 0 })
  })

  it("scales the floor with an expensive case type", () => {
    // Alcantara at 3,800: the flat 300 is far under 8%, so the floor governs.
    expect(tierPricing(3800, TWO_PACK)).toMatchObject({
      subtotal: 7600,
      discount: 608,
      applied: "min_pct",
    })
  })
})

describe("lineDiscount", () => {
  const tiers = [TWO_PACK, THREE_PACK]

  it("takes the largest tier that fits", () => {
    expect(lineDiscount(1950, 3, tiers)).toMatchObject({
      discount: 800,
      packs: 1,
    })
  })

  it("gives nothing below the smallest tier", () => {
    expect(lineDiscount(1950, 1, tiers)).toEqual({
      discount: 0,
      tier: null,
      packs: 0,
    })
  })

  it("repeats the discount per whole pack and ignores the remainder", () => {
    // Six is two 3-packs; the seventh item is at standard price.
    expect(lineDiscount(1950, 6, tiers)).toMatchObject({
      discount: 1600,
      packs: 2,
    })
    expect(lineDiscount(1950, 7, tiers)).toMatchObject({
      discount: 1600,
      packs: 2,
    })
  })

  it("clamps per pack, not against the whole line", () => {
    // Five items take one 3-pack at 800, not a percentage of all five.
    expect(lineDiscount(1950, 5, tiers)).toMatchObject({ discount: 800 })
  })
})
