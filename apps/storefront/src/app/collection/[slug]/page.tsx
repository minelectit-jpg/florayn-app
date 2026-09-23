import type { Metadata } from "next"

import CollectionPage, { collectionMetadata, type CollectionRouteParams } from "@/components/pages/collection-page"

export async function generateMetadata(props: CollectionRouteParams): Promise<Metadata> {
  return collectionMetadata(props, "women")
}

export default function WomenCollectionPage(props: CollectionRouteParams) {
  return <CollectionPage {...props} audience="women" />
}
