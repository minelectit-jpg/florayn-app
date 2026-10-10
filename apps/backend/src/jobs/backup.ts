import type { MedusaContainer } from "@medusajs/framework/types"

import { runBackupPass } from "../lib/backup/run"

/**
 * Hourly encrypted database backup (BACKUP.md), at :07 so it does not start
 * with the :00/:20/:40 storefront warm pass. Does nothing until Admin >
 * Backups has an encryption key and backups are on. runBackupPass guards
 * against overlapping itself (scheduled jobs run side by side).
 */
export default async function backupJob(container: MedusaContainer) {
  await runBackupPass(container, { trigger: "schedule" })
}

export const config = {
  name: "backup-hourly",
  schedule: "7 * * * *",
}
