"use client"

import { Component, type ReactNode } from "react"

/*
 * Loading the header's heavier parts (the menu levels, the desktop panels and
 * the search results) on intent, and surviving a failed load. Shared by
 * header-dialogs.tsx, desktop-nav.tsx and search-sheet.tsx.
 */

const RELOAD_KEY = "fl-chunk-reload"
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev"

/**
 * A lazy import that survives a network blip: one retry after 400ms. If that
 * fails too, the tab is most likely on an old build whose files are gone, so
 * it reloads, at most once per build; after that the error reaches LoadBoundary.
 * `reload: false` is for loads the shopper did not ask for yet (a hover, an
 * idle moment): those never reload the page under them.
 */
export function retryImport<T>(load: () => Promise<T>, reload = true): Promise<T> {
  return load().catch(
    () =>
      new Promise<T>((resolve, reject) => {
        window.setTimeout(() => {
          load().then(resolve, (error) => {
            try {
              if (reload && window.sessionStorage.getItem(RELOAD_KEY) !== BUILD_ID) {
                window.sessionStorage.setItem(RELOAD_KEY, BUILD_ID)
                window.location.reload()
                return // The page is going away; leave the promise pending.
              }
            } catch {
              // Storage blocked: never risk a reload loop.
            }
            reject(error)
          })
        }, 400)
      })
  )
}

/**
 * A part of the header that loads on intent. `preload` keeps one quiet import
 * in flight (and forgets a failed one, so the next intent tries again);
 * `render` is what React.lazy calls once the part is actually needed, and may
 * reload the page; `loaded` is the module once it has arrived, so a part
 * preloaded before it is needed renders at once, with no skeleton.
 */
export function loadable<T>(load: () => Promise<T>) {
  let pending: Promise<T> | null = null
  let arrived: T | null = null
  const keep = (part: T) => (arrived = part)
  const preload = () =>
    (pending ??= retryImport(load, false).then(keep, (error) => {
      pending = null
      throw error
    }))
  const render = () => preload().catch(() => retryImport(load).then(keep))
  return { preload, render, loaded: () => arrived }
}

/** A part that could not load: say so and offer a reload, never a blank space. */
export class LoadBoundary extends Component<{ children: ReactNode; className?: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <p role="status" className={this.props.className ?? "px-4 py-6 text-[14px] text-ink-muted"}>
        Could not load.{" "}
        <button type="button" onClick={() => window.location.reload()} className="font-medium text-purple underline underline-offset-4">
          Reload
        </button>
      </p>
    )
  }
}
