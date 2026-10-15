import path from "node:path"

/**
 * Where the built Florayn Console lives (CONSOLE.md): apps/backend/console-dist
 * in development, /app/server/console-dist in the image. CONSOLE_DIR overrides.
 */
export function consoleDir(): string {
  return path.resolve(process.env.CONSOLE_DIR || path.join(process.cwd(), "console-dist"))
}

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
}

/** A built asset's path and type, or null for anything that is not a plain file name we serve. */
export function consoleAsset(name: string): { file: string; type: string } | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null
  const type = TYPES[path.extname(name).toLowerCase()]
  if (!type) return null
  return { file: path.join(consoleDir(), "assets", name), type }
}
