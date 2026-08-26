// Account settings shell: tabs, each wired to real endpoints.
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/shared/PageHeader"
import { AccountTab } from "../profile/AccountTab"
import { SecurityTab } from "../profile/SecurityTab"
import { AddressesTab } from "../profile/AddressesTab"
import { DeveloperTab } from "../profile/DeveloperTab"
import { NotificationsWebhooksTab } from "../profile/NotificationsWebhooksTab"

export default function CustomerProfilePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Profile & settings"
        description="Your identity, security posture and developer integrations."
      />
      <Tabs defaultValue="account">
        <TabsList className="flex-wrap">
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="addresses">Addresses</TabsTrigger>
          <TabsTrigger value="developer">SSH · Scripts · API keys</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
        </TabsList>
        <TabsContent value="account">
          <AccountTab />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>
        <TabsContent value="addresses">
          <AddressesTab />
        </TabsContent>
        <TabsContent value="developer">
          <DeveloperTab />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsWebhooksTab mode="notifications" />
        </TabsContent>
        <TabsContent value="webhooks">
          <NotificationsWebhooksTab mode="webhooks" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
