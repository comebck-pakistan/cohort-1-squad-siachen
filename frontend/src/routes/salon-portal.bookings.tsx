import { createFileRoute } from "@tanstack/react-router";
import { TenantBookingsList } from "@/components/tenant/TenantBookingsList";

export const Route = createFileRoute("/salon-portal/bookings")({
  head: () => ({
    meta: [
      { title: "Bookings — Salon Admin Portal" },
      {
        name: "description",
        content:
          "Today's and recent bookings, with manual confirm/cancel for any appointment.",
      },
    ],
  }),
  component: TenantBookingsList,
});
