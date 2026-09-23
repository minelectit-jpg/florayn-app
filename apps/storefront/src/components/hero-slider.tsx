"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "@/components/audience-link"
import { useEffect, useRef, useState } from "react"

import ArtImage from "@/components/art-image"

export type HeroSlide = {
  eyebrow: string | null
  heading: string | null
  href: string
  cta_label: string | null
  image: string | null
  mobile_image: string | null
}

const INTERVAL_MS = 7000
/** Later slides' pictures wait this long so the first one owns the network. */
const DEFER_MS = 2500

/**
 * The home hero: florayn.com's fading slideshow, rebuilt without a carousel
 * library. The first slide is plain server-rendered markup with a priority
 * image, so the page's largest paint never waits for JavaScript. Every slide's
 * copy and link are in the HTML; only the later slides' pictures are deferred.
 *
 * Autoplay pauses on hover, focus and a hidden tab, and is off entirely for
 * reduced motion. Inactive slides are inert, so keyboard focus only ever lands
 * on the slide that is showing.
 */
export default function HeroSlider({
  slides,
  ctaLabel,
}: {
  slides: HeroSlide[]
  ctaLabel: string
}) {
  const count = slides.length
  const [index, setIndex] = useState(0)
  const [ready, setReady] = useState(false)
  const [paused, setPaused] = useState(false)
  const touchX = useRef<number | null>(null)

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), DEFER_MS)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    if (count < 2 || paused || !ready) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const id = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % count)
    }, INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [count, paused, ready])

  function go(next: number) {
    setReady(true)
    setIndex(((next % count) + count) % count)
  }

  return (
    <section
      className="fl-hero"
      aria-roledescription="carousel"
      aria-label="Featured"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null
      }}
      onTouchEnd={(e) => {
        const start = touchX.current
        touchX.current = null
        const end = e.changedTouches[0]?.clientX
        if (start == null || end == null || count < 2) return
        if (Math.abs(end - start) > 40) go(index + (end < start ? 1 : -1))
      }}
    >
      <div className="fl-hero__viewport">
        {slides.map((slide, i) => {
          const active = i === index
          const Heading = i === 0 ? "h1" : "h2"
          const label = slide.cta_label || ctaLabel
          return (
            <div
              key={`${slide.href}-${i}`}
              className={`fl-hero__slide${active ? " is-active" : ""}`}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={!active}
              inert={!active}
            >
              {slide.image && (i === 0 || ready) ? (
                <ArtImage
                  src={slide.image}
                  mobileSrc={slide.mobile_image}
                  alt={slide.heading ?? ""}
                  priority={i === 0}
                  sizes="(max-width: 1470px) 100vw, 1410px"
                  className="fl-hero__img"
                />
              ) : null}
              <span className="fl-hero__shade" aria-hidden="true" />
              {/* The whole slide opens its link; the button is the focusable one. */}
              <Link href={slide.href} className="absolute inset-0 z-[1]" tabIndex={-1} aria-hidden="true" />
              <div className="fl-hero__copy">
                {slide.eyebrow ? <p className="fl-hero__eyebrow">{slide.eyebrow}</p> : null}
                {slide.heading ? <Heading className="fl-hero__title">{slide.heading}</Heading> : null}
                <Link href={slide.href} className="fl-hero__cta">
                  {label}
                </Link>
              </div>
            </div>
          )
        })}

        {count > 1 ? (
          <>
            <button type="button" className="fl-hero__arrow fl-hero__arrow--prev" aria-label="Previous slide" onClick={() => go(index - 1)}>
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button type="button" className="fl-hero__arrow fl-hero__arrow--next" aria-label="Next slide" onClick={() => go(index + 1)}>
              <ChevronRight size={20} aria-hidden="true" />
            </button>
            <div className="fl-hero__dots">
              {slides.map((slide, i) => (
                <button
                  key={`dot-${i}`}
                  type="button"
                  className={`fl-hero__dot${i === index ? " is-active" : ""}`}
                  aria-label={`Show slide ${i + 1}${slide.heading ? `: ${slide.heading}` : ""}`}
                  aria-current={i === index}
                  onClick={() => go(i)}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}
