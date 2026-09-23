import type { Metadata } from "next"

import CollectionPage, { collectionMetadata, type CollectionRouteParams } from "@/components/pages/collection-page"

export async function generateMetadata(props: CollectionRouteParams): Promise<Metadata> {
  return collectionMetadata(props, "men")
}

export default function MenCollectionPage(props: CollectionRouteParams) {
  return <CollectionPage {...props} audience="men" />
}
