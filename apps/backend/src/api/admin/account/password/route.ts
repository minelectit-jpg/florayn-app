import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * POST /admin/account/password { password } - the signed-in admin sets a new
 * password for their own login. Backs the "Change password" card on the admin
 * Settings -> Profile screen (every feature gets an admin screen).
 *
 * Customers are passwordless (their sessions are minted directly), so the
 * emailpass password is meaningful only for admin users; changing it here is
 * safe even when the same identity is shared with a customer record.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const password = (req.body as { password?: unknown } | undefined)?.password
  if (typeof password !== "string" || password.length < 8) {
    return res
      .status(400)
      .json({ message: "Password must be at least 8 characters." })
  }

  const actorId = (req as any).auth_context?.actor_id
  if (!actorId) {
    return res.status(401).json({ message: "Not signed in." })
  }

  const userModule: any = req.scope.resolve(Modules.USER)
  const authModule: any = req.scope.resolve(Modules.AUTH)

  const user = await userModule.retrieveUser(actorId).catch(() => null)
  const email = user?.email
  if (!email) {
    return res
      .status(400)
      .json({ message: "Could not resolve your account email." })
  }

  const result = await authModule.updateProvider("emailpass", {
    entity_id: email,
    password,
  })
  if (!result?.success) {
    return res
      .status(400)
      .json({ message: result?.error ?? "Could not update the password." })
  }

  return res.json({ success: true })
}
