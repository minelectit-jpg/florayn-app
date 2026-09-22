# Product Manager

Admin > Product Manager is the shared entry point for case/design products,
regular ecommerce products, the existing bulk uploader, and case-type pricing.

## Owner workflow

- Create product > Case / design: choose a name, one or more actual model and
  case-type combinations, and a gallery for each. One combination is enough.
  Save as draft, review the images/details, then publish when ready.
- Add model / case type in the editor appends variants to the same design.
  Adding the first accessory form creates only its missing product.
- Create product > Regular product supports a single item (Option / Default)
  or up to three option dimensions. Generate combinations, remove unwanted
  variants, then enter each SKU, BDT price, stock and gallery.
- The editor updates name, description, collection and status. Select a variant
  to edit its SKU/gallery, or select several in the same form to bulk edit.
  Regular variants can have separate prices. Add variant accepts new values
  for existing option dimensions without recreating existing variants.
- Duplicate opens an editable copy, defaulting to draft. Regular stock starts
  at zero. Case variants reuse their existing shared blank inventory.
- Search and type/status filters include both regular products and designs.
  Bulk publish/draft reports partial progress and leaves failed rows selected.

## Invariants for future changes (including Claude Code)

1. The owner's policy is **one global price per case type across designs**.
   Preserve the existing device price groups managed in Case Types. Do not add
   per-design price overrides or allow the generic variant editor to override
   case prices. Regular products have normal per-variant BDT prices.
2. Case stock is shared by case type and device, not by design. A duplicate or
   new design must reuse blank inventory. Starting stock only applies to newly
   created blanks; never reset an existing blank's stock. Show reserved stock
   separately. Regular products use their own inventory.
3. Editing and expanding must preserve existing product/variant/option IDs,
   prices, links, carts and historical orders. Append missing combinations;
   never delete/recreate the design to expand it. Reject duplicate combinations
   and SKU collisions. Destructive deletion requires explicit admin confirmation.
4. Keep one storefront ProductView layout. Regular option combinations must map
   to their exact variant IDs (including multiple option dimensions). The
   published-product stock endpoint and cart validation remain authoritative.
5. Drafts stay private. An admin content preview is not a publicly accessible
   draft URL. Published variants need images and valid prices. Do not auto-
   publish copies or upload every possible Cartesian combination by default.
6. Use unique/versioned uploaded image URLs. Saving a gallery must update the
   variant, product gallery/cover and affected catalog cards together. Preserve
   unrelated metadata/galleries. Do not clear the entire Next image cache.
7. Keep the list lightweight: paginated backend reads of variant IDs for counts;
   load full galleries, inventory and prices only for the selected product.
   Preserve scoped invalidation and the budgets documented in PERFORMANCE.md.
8. New commerce mutations belong in Medusa workflows. Validate on the server,
   check variant ownership, preserve price-list rules and core compensation.
   Do not bypass failed checks or remove lint rules to make a build pass.
9. Keep upload/save progress, zero stock, error recovery, duplicate-click guards
   and unsaved-work warnings. API timeouts can mean a save completed: refresh
   before retrying rather than blindly creating the same product again.
10. Product Manager pickers use the shared Medusa `ManagerSelect`. Do not replace
    them with unthemed native select menus: Windows can paint white menus with
    inherited dark-theme text, making their options unreadable.

## Product and shop presentation

Keep the original product page layout, gallery, title, case-type tiles and
Device / More designs / Case type order. The **Product only / Bundle/pack**
control sits below the price in the original offer position. Product only is
the default. In bundle mode, hide the
base product's single-item purchase buttons so the customer cannot accidentally
buy one item while building a pack. Changing the base variant clears the pack.

Bundle headings, tier badges, discount rules and Matching Set content remain
editable in the existing Admin Bundles page. Render real configured badges;
never invent best-seller or percentage claims. Unfilled pack slots use the base
price and must be labelled estimates. Filled mixed-model/construction packs use
each selected variant's price and exact ID. The cart and checkout still own the
final promotion calculation. Preserve visible failure feedback and the duplicate
submission guard. A Matching Set can be available without any quantity tiers.

Keep the original shop filters, cards, spacing and sorting-menu appearance.
Sorting applies to the displayed page, described by the control label. Do not
label catalog order as newest without actual creation dates and global ordering.
Preserve the
first eight image preloads and bounded 32-product reads described in PERFORMANCE.md.

## Verification

`npm test` covers input validation, shared pricing protection, inventory,
bounded product reads, variant identity and storefront option selection.

The performance CI workflow runs `verify-product-manager-isolated.ts` after
the checkout fixture. It uses a disposable local PostgreSQL/Redis database,
guarded by PRODUCT_MANAGER_ISOLATED_TEST and the fixture database name. It
tests real Medusa creation, editing, option expansion, draft/publish, cart
variant pricing, new catalog entries, zero stock and shared-stock duplicates.
Never run this against the deployed database or create customer orders for QA.

Deploy only the new.florayn.com stack. This work does not authorize changes to
the live florayn.com store. No schema migration is required for this feature.
