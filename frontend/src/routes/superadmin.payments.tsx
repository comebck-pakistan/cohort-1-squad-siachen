import { createFileRoute } from "@tanstack/react-router";
import { PaymentApprovalsTab } from "@/components/dashboard/PaymentApprovalsTab";

export const Route = createFileRoute("/superadmin/payments")({
  head: () => ({
    meta: [{ title: "Payment approvals · Recepta superadmin" }],
  }),
  component: PaymentApprovalsTab,
});
