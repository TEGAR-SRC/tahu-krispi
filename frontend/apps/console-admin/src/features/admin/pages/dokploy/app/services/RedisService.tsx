// Redis service detail — no backups tab upstream; engine handles the kind flag.
import { DatabaseServicePage } from "./k4-dbEngine"

export default function DokployRedisServicePage() {
  return <DatabaseServicePage kind="redis" />
}
