import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useState } from "react"

/**
 * "Change password" card on the admin Settings -> Profile page. The default
 * Medusa profile has no password field, so this adds one that POSTs to
 * /admin/account/password to reset the signed-in admin's own login password.
 */
const AccountPasswordWidget = () => {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [saving, setSaving] = useState(false)

  const mismatch = confirm.length > 0 && password !== confirm
  const canSave = password.length >= 8 && password === confirm && !saving

  const onSave = async () => {
    setSaving(true)
    try {
      const res = await fetch("/admin/account/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || "Could not update the password.")
      }
      toast.success("Password updated")
      setPassword("")
      setConfirm("")
    } catch (e: any) {
      toast.error(e?.message || "Could not update the password.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Change password</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Set the password you use to sign in to this admin.
        </Text>
      </div>
      <div className="flex max-w-sm flex-col gap-3 px-6 py-4">
        <div className="flex flex-col gap-1">
          <Label size="small">New password</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label size="small">Confirm password</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {mismatch ? (
          <Text size="xsmall" className="text-ui-fg-error">
            Passwords do not match.
          </Text>
        ) : null}
        <div>
          <Button
            size="small"
            variant="primary"
            disabled={!canSave}
            isLoading={saving}
            onClick={onSave}
          >
            Update password
          </Button>
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "profile.details.after",
})

export default AccountPasswordWidget
