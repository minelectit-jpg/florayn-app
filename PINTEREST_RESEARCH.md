# Pinterest research (home, search, design feed)

Research done on 2026-09-26 at the owner's request, before the one-row phone
header shipped. Four researchers (Pinterest search, Pinterest home, Florayn
today, what helps a shop sell), one proposal, one skeptic who checked every
claim against the code. **The owner parked this until the mockup system /
custom-case option is built**; then the Pinterest-style design feed comes
first (see "Design feed" below). Nothing here is built yet except what is
marked done.

## Done already

- One-row phone header (Menu, wordmark left, search field, Bag; Account in the
  menu on phones), no scroll tuck. See HEADER_SEARCH.md.
- Image sizes capped from measured bytes: home collection rail
  `(max-width: 767px) 213px` (3x phone: 828w 158 KB -> 640w 111 KB) and the
  menu's collections grid `(max-width:454px) 128px` (640w 93 KB -> 384w 41 KB).
- Tap feedback (`:active`) on menu rows, search rows and chips, header icons
  and product cards; Tailwind's reset hides the phone tap highlight.

## Zero-code fixes for the owner (Admin)

- **"flower" finds nothing today.** Admin > Search synonym row:
  `flower, flowers, floral, bloom, blossom, ফুল` -> `blooms`. Synonyms rewrite
  both the catalogue text and the query, so every design in Florayn Blooms then
  matches. Check the flower designs are in that collection.
- **Designs appear 2.3 screens down on phones.** Admin > Home page: move New
  Releases right after the delivery/COD marquee and drop one of the two tile
  grids that repeat the category circles. First design then needs one short
  scroll instead of 2.3 screens (not "the first screen": the FB in-app browser
  leaves about 640px).

## Search (to build later)

1. **/search refinement chips** (Pinterest "SearchGuide"): one no-wrap row under
   the field, text only, at most 8, built from the hits in a pure
   `lib/search/refine.ts` imported only by the /search client.
   - Phone chip first and exempt from the count rule (most designs fit every
     phone): "Your phone: iPhone 16" when remembered and q names no model.
   - Style chips "Elite Clear · from ৳1,600" (drop "from" only when a model
     fixes the price) and collection chips, shown only when
     `1 <= count < total`; none when `result.close`.
   - Tap = `setValue(next)` and `go(next)` together (go() alone leaves the
     field stale). A chip is pressed/removable only when its label text is
     literally in q.
   - Replace the 20px heading with a 13px aria-live count line.
   - Keep Show-more depth in `&n=` with replaceState AND keep the prepared
     index at module level so the first render after Back has all cards.
   - Admin > Search: one on/off switch; merge nested defaults so an old saved
     blob never resets the owner's synonyms (readPresentation merges one level).
2. **Explore tiles** (honest "Ideas for you"): only on the empty /search page
   and its zero-result state (not in the sheet: the keyboard covers them and
   they would cost header bytes). Automatic from Show-in-menu collections and
   style photos, 4:3 boxes on bg-field, `sizes="128px"`. Admin: on/off,
   heading ("Explore", never "Popular"/"Ideas for you"), count.
3. **Typing caps on phones** (sheet): Models 2, Designs 6, Collections 2,
   Styles 2, Categories 1, then "See all N designs". First add an engine size
   test: engine.ts is 3,848 B gzip against a 3,072 B budget no test enforces.
4. **Anonymous search counts** (owner's OK needed): beacon to a same-origin
   Next route (sendBeacon cannot send the publishable key), daily totals only;
   Admin > Search "Top searches" and "No results" with "Add synonym"; then a
   truthful "Popular searches" block.

## Home (to build later)

- product_carousel `layout: "grid"`, 8 cards on phones, reuse cta_label with a
  real `{n}` from the same filter as the target page. Price cards from
  `metadata.card.pairs[].price` (the pool path misprices Alcantara); scale the
  candidate pool with the limit.
- Hero: per-section `autoplay` (always / desktop only / off) and, if the owner
  uploads square phone images into `mobile_image`, a 1:1 phone ratio. With
  autoplay off, load later slides only on the first swipe.
- Paint check in headless Chrome on a local production build with the fixture
  API (median of 5, fail at +10% or +250ms); perf:check is curl and cannot see
  paint.

## What not to copy from Pinterest (for the shop's pages)

- Masonry product grids: every render is 1:1, masonry needs measuring JS and
  risks layout shift and hydration errors.
- Infinite scroll: hides the COD/delivery/contact footer, loses the place on
  Back.
- Tabs that swap content in place; text collection tabs as a third row.
- Lens/camera, login walls, "..." card menus, dark theme.
- A floating bottom nav bar **now**: it collides with the product page's
  quick-buy bar, the checkout bar and bottom sheets, stacks on the FB in-app
  browser's and iOS 26 Safari's bottom bars, and duplicates the header. The
  owner wants one; it comes **with the design feed**, where it earns a
  "Designs" button. Rule when built: it gives way to the quick-buy bar on
  product pages (never both), none on checkout/cart, header becomes wordmark +
  wider search (no duplicate Menu/Bag). A mock is in the session notes.

## Design feed (after the mockup system)

The owner's plan: 20+ images per category; shopper picks an image, chooses a
customised case (model, style), adds to bag, orders. Layout the owner wants:
category list on top, then a search bar, then a Pinterest-style masonry of
images (2 columns on phones, many on desktop). Two looks shown: rounded cards
with gaps and a one-line title, or a tight image-only mosaic; ask which. Here
masonry and topic tabs fit (inspiration, not priced products). Needs an admin
screen (categories, images, order, on/off), images on R2 through the
optimizer, lazy loading. Image rights: only the owner's own, licensed or
generated images, never images taken from Pinterest or the web.

## Open owner questions

1. Home order: move New Releases up as an 8-design grid; which repeated
   category block goes (2-tile Phone Case/Earbuds or 4-tile accessories)?
2. Hero on phones: stop auto-rotating? Square phone images?
3. Anonymous search counts: allowed?
4. Should every flower design be in Florayn Blooms?

Sources are in the research run (Gestalt SearchField / SearchGuide / Masonry /
Tabs docs, Pinterest Engineering posts on search guides, hybrid search and
performance, Baymard on autocomplete and return-to-place, NN/g on mobile
navigation, Apple HIG tab bars).
