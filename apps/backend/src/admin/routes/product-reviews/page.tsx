import { defineRouteConfig } from "@medusajs/admin-sdk"
import ReviewsEditor from "../../components/product-manager/reviews-editor"

const ProductReviewsPage = () => <ReviewsEditor />
export default ProductReviewsPage
export const config = defineRouteConfig({ label: "Product reviews" })
