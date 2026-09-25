/**
 * The FLORAYN wordmark with the four-point star in the O (the owner's logo,
 * traced from the 2000px artwork to one path). It inherits the text colour, so
 * it is ink on paper and white on a dark band. Size it by height; the width
 * follows (about 6.2:1). Plain SVG in the server HTML: no image request.
 *
 * width and height go on as attributes, so the logo keeps its box before any
 * CSS arrives (no layout shift); classes can still resize it per breakpoint.
 * title={null} hides it from screen readers, for when the link around it
 * already says "Florayn home".
 */
export const LOGO_VIEWBOX = "0 0 4000 648"

export default function FloraynLogo({ className, title = "Florayn", width, height }: { className?: string; title?: string | null; width?: number; height?: number }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} width={width} height={height} fill="currentColor" className={className} {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })} focusable="false">
      <path fillRule="evenodd" d="M1251 3a331 331 0 0 0-70 12c-41 11-88 37-121 68a314 314 0 0 0-88 148 379 379 0 0 0-2 178 330 330 0 0 0 42 100 299 299 0 0 0 223 136 370 370 0 0 0 169-22c86-38 140-97 171-186a394 394 0 0 0-11-253 308 308 0 0 0-123-139 336 336 0 0 0-123-41c-7-1-58-2-67-1M2 14c-2 0-3 5-1 5s10 12 14 20c7 13 10 24 12 45 2 12 3 446 1 468-2 35-8 54-23 73l-5 9 84 1c84 0 84 0 84-2l-4-6q-17-20-22-45c-4-19-5-32-5-125v-90h82c80 1 84 1 101 4q33 7 47 21l9 6h3v-68c-1-80 1-74-12-62-14 14-31 20-65 24l-87 2h-78V190l1-104 67-1a1136 1136 0 0 1 152 8q31 9 49 29 6 7 8 6h3V14l-207-1zm505 0q-2 3 1 8c8 11 17 35 20 52 4 26 4 27 5 238 0 227 0 238-6 269-4 16-11 34-18 44l-3 8 1 2h212l213-1 1-67v-66l-3-1q-3-1-6 5a99 99 0 0 1-64 51c-27 7-38 7-134 7l-84 1-1-221c0-224 0-240 4-263q4-34 19-57c7-10 14-9-77-10zm1179 0q-2 1 1 7c14 18 21 42 24 84v437c-3 39-9 61-23 84q-3 4-3 7v2h161v-2q0-3-3-7-15-24-20-60c-4-28-4-47-4-133l1-82 27-1h28l5 7 36 47 126 160 21 28 25 32 9 11h67l67-1-2-5-80-98-150-185q-9-12-4-11l26-8q118-48 115-154c-2-42-15-73-45-101-37-35-88-53-161-58zm813 1-7 14-104 267-13 35-59 149-36 90c-11 25-21 40-33 54l-7 9v2h72c83 0 75 1 69-11-12-22-12-45-3-84 5-18 26-76 29-80 2-2 249-1 250 1l22 56 11 38q11 42-2 68l-3 10c0 2 5 2 85 2 98 0 89 1 79-11a278 278 0 0 1-48-88l-2-5-4-8-11-29-23-58-31-76-20-51-50-124-65-160c-5-13 0-12-51-12-44 0-44 0-45 2m291-1q-4 2 5 11a572 572 0 0 1 102 146l119 203 7 11v72c0 111-3 132-22 166q-7 11-4 12h81c88 0 83 1 78-7a185 185 0 0 1-24-81l-2-84v-76l4-6 11-19 126-206a806 806 0 0 1 89-123c15-15 17-18 13-20h-72l-70 1-1 17c0 20-1 25-8 47a639 639 0 0 1-68 124l-5 8-39 66c-16 28-16 27-23 15l-88-154c-15-25-29-57-32-75-3-15-3-23 0-44l-1-4zm651 0c-1 2-1 3 13 24l8 12v240c0 233 0 250-3 273a149 149 0 0 1-24 69v3h68l69-1-4-9c-13-20-17-34-22-75l-2-213V133h2c3 0 4 1 19 25l41 68 35 58 38 62 77 127 4 6 25 41 65 106 5 9h114l1-249 1-267c3-48 9-74 23-95q6-9 2-10l-67-1c-76 0-72-1-66 8 17 26 23 51 25 102v360l-2 2q-2 2-11-13l-19-33-55-89-89-149-32-53-81-134c-2-2-156-2-158 0M1260 77c-95 6-163 80-178 193a415 415 0 0 0 8 151c10 38 32 77 57 101 24 23 49 36 84 45 19 5 48 6 72 3q59-7 102-49a229 229 0 0 0 38-52 278 278 0 0 0 30-144 318 318 0 0 0-12-99c-7-26-21-56-38-77a178 178 0 0 0-163-72m559 7v98l1 97h46a321 321 0 0 0 89-8l10-4c43-17 66-58 58-106q-11-63-92-75c-22-3-110-5-112-2m709 61-2 5-30 79-44 114-16 42c0 2 1 2 96 2 90 0 95 0 95-2l-7-18-36-93-47-121q-7-17-9-8m-1253 89-2 8a103 103 0 0 1-86 82q-12 0 11 5c37 8 71 43 77 81q1 9 4-4c6-39 42-74 81-80q11-3 1-4c-3 0-4 0-17-5-34-11-60-41-67-76z" />
    </svg>
  )
}
