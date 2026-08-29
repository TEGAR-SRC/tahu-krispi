// LibSQL service detail — plural saveExternalPorts, no changePassword; the
// engine's kind config carries both differences.
import { DatabaseServicePage } from "./k4-dbEngine"

export default function DokployLibsqlServicePage() {
  return <DatabaseServicePage kind="libsql" />
}
