import CollectionsPage, { collectionsMetadata } from "@/components/pages/collections-page"

export const metadata = collectionsMetadata("women")

export default function WomenCollectionsPage() {
  return <CollectionsPage audience="women" />
}
