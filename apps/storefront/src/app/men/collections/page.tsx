import CollectionsPage, { collectionsMetadata } from "@/components/pages/collections-page"

export const metadata = collectionsMetadata("men")

export default function MenCollectionsPage() {
  return <CollectionsPage audience="men" />
}
