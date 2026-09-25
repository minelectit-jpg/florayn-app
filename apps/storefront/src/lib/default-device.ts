import { compareModelNames } from "@/lib/device-order"

/**
 * The base product page's default device: the newest phone (iPhone before
 * Samsung, newest first by name), preferring one sold in every case type so
 * all the case-type tiles are enabled on first load. It never depends on the
 * order /store/devices happens to return.
 */
export function pickDefaultPhone(
  matrixDevices: string[],
  caseTypesByDevice: Record<string, string[]>,
  caseTypeCount: number,
  catalog: { name: string; family: string }[],
): string | undefined {
  const familyByName = new Map(catalog.map((d) => [d.name, d.family]))
  const rank = (name: string) => (familyByName.get(name) === "iphone" ? 0 : 1)
  const phones = matrixDevices
    .filter((d) => ["iphone", "samsung"].includes(familyByName.get(d) ?? ""))
    .sort((a, b) => rank(a) - rank(b) || compareModelNames(a, b))
  const inEveryCaseType = (d: string) => (caseTypesByDevice[d] ?? []).length === caseTypeCount
  return phones.find(inEveryCaseType) ?? phones[0] ?? matrixDevices[0]
}
