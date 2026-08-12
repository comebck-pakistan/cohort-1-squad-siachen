import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  CheckCircle2, Clock, X, CalendarDays, CalendarX, Phone, Pencil, User as UserIcon, Bot, ShieldCheck, AlertOctagon, Sparkles, BarChart3, Plus, Save, X as XIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlaceholderBadge } from "./ProductModuleShowcase";
import { DURATION, EASE } from "./tokens";

// ---------------------------------------------------------------------------
// ProductModulePreviews
//
// Each preview renders the REAL Recepta dashboard UI for one module. The
// 5 interactive previews (services, hours, bookings, escalations, aiRules)
// accept { phase, reduced } and animate real dashboard state transitions
// — row insertions, badge swaps, toggle flips, button highlights, modal
// open/close, etc. — without any chat-bubble narration overlay.
//
// The 2 static previews (overview, staff) ignore the phase prop and render
// the dashboard state as-is.
//
// All preview data is hand-picked to be plausible (PKR currency, Roman
// Urdu + English, Asia/Karachi timezone). Visitors will recognize the
// locale from the actual product.
// ---------------------------------------------------------------------------

const MODULE_SERVICES = [
  { name: "Hair Cut & Style", price: "PKR 1,800", duration: "45 min", category: "Hair" as const, on: true },
  { name: "HydraFacial", price: "PKR 6,500", duration: "60 min", category: "Skin" as const, on: true },
  { name: "Hair Colour", price: "PKR 9,500", duration: "120 min", category: "Hair" as const, on: true },
  { name: "Gel Manicure", price: "PKR 2,800", duration: "45 min", category: "Nails" as const, on: true },
];

// Real PREDEFINED_RULES from backend/src/lib/predefined-rules.ts.
const MODULE_RULES = [
  { on: true, label: "Honor refund requests fully" },
  { on: true, label: "30-minute late tolerance" },
  { on: true, label: "Strictly decline discount requests" },
  { on: true, label: "Require 24h advance booking" },
  { on: false, label: "Offer WELCOME10 to new customers" },
];

const MODULE_TRIGGERS = [
  { on: true, label: "Customer requests a refund" },
  { on: true, label: "Customer mentions a complaint" },
  { on: true, label: "AI fails to understand 2 turns in a row" },
  { on: false, label: "Booking requested outside operating hours" },
];

const MODULE_HOURS = [
  { day: "Monday", open: false, from: "—", to: "—" },
  { day: "Tuesday", open: true, from: "11:00", to: "20:00" },
  { day: "Wednesday", open: true, from: "11:00", to: "20:00" },
  { day: "Thursday", open: true, from: "11:00", to: "20:00" },
  { day: "Friday", open: true, from: "11:00", to: "20:00" },
  { day: "Saturday", open: true, from: "11:00", to: "21:00" },
  { day: "Sunday", open: true, from: "12:00", to: "19:00" },
];

const MODULE_HOLIDAYS = [
  { date: "14 Aug 2026", reason: "Independence Day" },
  { date: "7 Oct 2026", reason: "Eid holiday" },
];

const MODULE_STAFF = [
  { name: "Ayesha Siddiqui", role: "Senior Stylist", specs: ["Hair", "Color"], days: "Mon–Sat" },
  { name: "Hira Khan", role: "Esthetician", specs: ["Skin", "Facial"], days: "Tue–Sun" },
  { name: "Sana Malik", role: "Nail Technician", specs: ["Nails", "Manicure"], days: "Wed–Sun" },
  { name: "Maira Aslam", role: "Stylist", specs: ["Hair", "Bridal"], days: "Thu–Sat" },
];

type ModuleBooking = {
  time: string;
  customer: string;
  service: string;
  staff: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
};

const MODULE_BOOKINGS: ModuleBooking[] = [
  { time: "11:00 AM", customer: "Sana K.", service: "Hair Cut & Style", staff: "Hira", status: "confirmed" },
  { time: "12:30 PM", customer: "Ayesha M.", service: "HydraFacial", staff: "Hina", status: "pending" },
  { time: "3:00 PM", customer: "Mahnoor R.", service: "Hair Colour", staff: "Sana", status: "confirmed" },
  { time: "4:30 PM", customer: "Iqra T.", service: "Gel Manicure", staff: "—", status: "confirmed" },
  { time: "6:00 PM", customer: "Fatima S.", service: "Hair Cut & Style", staff: "Hira", status: "cancelled" },
];

const MODULE_ESCALATIONS = [
  { name: "Iqra T.", phone: "+92 345 5566778", snippet: "Mujhe owner se baat karni hai.", reason: "Wants human", time: "12m" },
  { name: "Areeba F.", phone: "+92 311 4477889", snippet: "Service se mujhe allergy ho gayi.", reason: "Medical concern", time: "1h" },
  { name: "Sana A.", phone: "+92 322 1199008", snippet: "Refund kab milega?", reason: "Refund", time: "3h" },
];

const STATUS_TONE: Record<string, string> = {
  pending: "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent",
  confirmed: "bg-success-soft text-[oklch(0.42_0.10_195)] border-transparent",
  cancelled: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
  completed: "bg-muted text-muted-foreground border-transparent",
};

const REASON_TONE = "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent";

// ---------------------------------------------------------------------------
// Module 1 — Services Catalog
//
// Animates the real dashboard UI:
//   Phase 0: baseline (4 services)
//   Phase 1: "Add New Service" button pulses
//   Phase 2: form modal opens above the table with fields populated
//            (Blow-dry / Hair / 30 min / PKR 1,200)
//   Phase 3: "Save" button highlights
//   Phase 4: modal closes, new row slides into the table
//   Phase 5: Active toggle pulse
//   Phase 6: hold
// ---------------------------------------------------------------------------

function ServicesCatalogPreview({ phase, reduced }: { phase: number; reduced: boolean }) {
  // Whether the add-service modal is open.
  const modalOpen = phase >= 2 && phase <= 3;
  // Whether the new row is in the table (added after save).
  const showNewRow = phase >= 4;
  // Whether the Add New Service button should pulse.
  const buttonPulse = phase === 1;
  // Whether the Save button should pulse.
  const savePulse = phase === 3;
  // Whether the new row's toggle should pulse.
  const togglePulse = phase === 5;

  const newRow = { name: "Blow-dry", price: "PKR 1,200", duration: "30 min", category: "Hair" as const, on: true };

  return (
    <div className="absolute inset-0 p-4">
      <PlaceholderBadge label="Live product demo · loops 9s" />
      <Card className="h-full border shadow-none bg-white overflow-hidden">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Services Catalog</CardTitle>
          <motion.div
            animate={
              buttonPulse && !reduced
                ? { scale: [1, 1.04, 1], boxShadow: ["0 0 0 0 rgba(10,133,140,0)", "0 0 0 6px rgba(10,133,140,0.18)", "0 0 0 0 rgba(10,133,140,0)"] }
                : { scale: 1 }
            }
            transition={{ duration: 1.2, ease: EASE.standard }}
            className="rounded-md"
          >
            <Button size="sm" className="h-7 bg-primary text-[11px] hover:bg-primary/90">
              <Plus className="size-3" /> Add New Service
            </Button>
          </motion.div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Modal panel — slides open between phase 2 and 3, closes at phase 4 */}
          <AnimatePresence>
            {modalOpen && (
              <motion.div
                key="modal"
                initial={reduced ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: 0.35, ease: EASE.standard }}
                className="overflow-hidden border-b bg-accent/40"
              >
                <div className="grid gap-2 px-4 py-3">
                  <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                    <div>
                      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Service</div>
                      <div className="mt-0.5 rounded border border-primary/40 bg-white px-2 py-1 text-[11px] font-medium">
                        {newRow.name}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Category</div>
                      <div className="mt-0.5 rounded border bg-white px-2 py-1 text-[11px]">
                        {newRow.category}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Duration · Price</div>
                      <div className="mt-0.5 rounded border bg-white px-2 py-1 text-[11px] tabular-nums">
                        {newRow.duration} · {newRow.price}
                      </div>
                    </div>
                    <motion.div
                      animate={
                        savePulse && !reduced
                          ? { scale: [1, 1.06, 1], boxShadow: ["0 0 0 0 rgba(10,133,140,0)", "0 0 0 6px rgba(10,133,140,0.22)", "0 0 0 0 rgba(10,133,140,0)"] }
                          : { scale: 1 }
                      }
                      transition={{ duration: 1.0, ease: EASE.standard }}
                      className="rounded-md"
                    >
                      <Button size="sm" className="h-7 bg-primary text-[11px] hover:bg-primary/90">
                        <Save className="size-3" /> Save
                      </Button>
                    </motion.div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Service</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Category</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Duration</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Price</TableHead>
                <TableHead className="text-right text-[10px] uppercase tracking-wide text-muted-foreground">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* New row slides in at phase 4 */}
              <AnimatePresence>
                {showNewRow && (
                  <motion.tr
                    key="new-row"
                    initial={reduced ? false : { opacity: 0, y: -8, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto" }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    transition={{ duration: 0.4, ease: EASE.out }}
                    className={cn(
                      "border-b transition-colors",
                      phase === 5 && !reduced && "bg-primary/5",
                    )}
                  >
                    <TableCell className="text-xs font-medium">
                      <div className="flex items-center gap-1.5">
                        {newRow.name}
                        {phase === 5 && (
                          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[8px] font-semibold text-primary">
                            NEW
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[9px]">{newRow.category}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{newRow.duration}</TableCell>
                    <TableCell className="text-xs font-medium">{newRow.price}</TableCell>
                    <TableCell className="text-right">
                      <motion.div
                        className="inline-flex justify-end"
                        animate={
                          togglePulse && !reduced
                            ? { scale: [1, 1.18, 1] }
                            : { scale: 1 }
                        }
                        transition={{ duration: 1.0, ease: EASE.standard }}
                      >
                        <Switch checked={newRow.on} />
                      </motion.div>
                    </TableCell>
                  </motion.tr>
                )}
              </AnimatePresence>
              {MODULE_SERVICES.map((s) => (
                <TableRow key={s.name}>
                  <TableCell className="text-xs font-medium">{s.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[9px]">{s.category}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{s.duration}</TableCell>
                  <TableCell className="text-xs font-medium">{s.price}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex justify-end">
                      <Switch checked={s.on} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module 2 — Operating Hours
//
// Animates the real dashboard UI:
//   Phase 0: baseline schedule + holidays
//   Phase 1: Tuesday row highlight (open toggle)
//   Phase 2: Tuesday from/to swap (11:00→20:00 to 12:00→21:00)
//   Phase 3: Holiday panel "Independence Day" row slides in (was missing)
//   Phase 4: Save button highlights
//   Phase 5: hold (read)
// ---------------------------------------------------------------------------

function OperatingHoursPreview({ phase, reduced }: { phase: number; reduced: boolean }) {
  const tuesdayHighlight = phase === 1;
  const tuesdayUpdated = phase >= 2;
  const showNewHoliday = phase >= 3;
  const savePulse = phase === 4;

  return (
    <div className="absolute inset-0 grid grid-cols-[1.5fr_1fr] gap-3 p-4">
      <PlaceholderBadge label="Live product demo · loops 9s" />
      {/* Weekly schedule card */}
      <Card className="h-full border shadow-none bg-white">
        <CardHeader className="pb-1.5">
          <CardTitle className="text-sm">Weekly Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {MODULE_HOURS.map((d, i) => {
            const isTuesday = d.day === "Tuesday";
            const updated = isTuesday && tuesdayUpdated;
            return (
              <motion.div
                key={d.day}
                animate={
                  tuesdayHighlight && isTuesday && !reduced
                    ? { backgroundColor: ["rgba(10,133,140,0)", "rgba(10,133,140,0.08)", "rgba(10,133,140,0)"] }
                    : { backgroundColor: "rgba(10,133,140,0)" }
                }
                transition={{ duration: 1.0, ease: EASE.standard }}
                className={cn(
                  "grid grid-cols-[70px_44px_1fr_1fr] items-center gap-2 rounded border-b py-1.5 text-[11px] last:border-b-0",
                  tuesdayHighlight && isTuesday && "border-primary/40",
                )}
              >
                <span className="font-medium">{d.day}</span>
                <Switch checked={d.open} />
                <span className={cn(
                  "rounded-md border bg-background px-2 py-0.5 text-center font-mono text-[10px]",
                  d.open ? "" : "opacity-40",
                )}>
                  {updated && isTuesday ? "12:00" : d.open ? d.from : "—"}
                </span>
                <span className={cn(
                  "rounded-md border bg-background px-2 py-0.5 text-center font-mono text-[10px]",
                  d.open ? "" : "opacity-40",
                )}>
                  {updated && isTuesday ? "21:00" : d.open ? d.to : "—"}
                </span>
              </motion.div>
            );
          })}
          <div className="pt-2 text-[10px] text-muted-foreground">
            Buffer between appointments: <span className="font-mono font-medium">15 min</span>
          </div>
          <motion.div
            className="pt-2"
            animate={
              savePulse && !reduced
                ? { opacity: [0.7, 1, 0.7] }
                : { opacity: 0.85 }
            }
            transition={{ duration: 1.0, ease: EASE.standard }}
          >
            <Button size="sm" className="h-6 bg-primary text-[10px] hover:bg-primary/90">
              <Save className="size-3" /> Save Changes
            </Button>
          </motion.div>
        </CardContent>
      </Card>

      {/* Holidays & Closures card */}
      <Card className="h-full border shadow-none bg-white">
        <CardHeader className="pb-1.5">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarX className="size-3.5" /> Holidays & Closures
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {MODULE_HOLIDAYS.map((h) => (
            <div key={h.date} className="flex items-center justify-between rounded-md border bg-background px-3 py-1.5">
              <div>
                <div className="text-[11px] font-medium">{h.date}</div>
                <div className="text-[10px] text-muted-foreground">{h.reason}</div>
              </div>
            </div>
          ))}
          {/* New holiday row slides in at phase 3 */}
          <AnimatePresence>
            {showNewHoliday && (
              <motion.div
                key="new-holiday"
                initial={reduced ? false : { opacity: 0, height: 0, y: -6 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: 0.4, ease: EASE.out }}
                className={cn(
                  "overflow-hidden rounded-md border bg-background px-3 py-1.5",
                  phase === 3 && !reduced && "border-primary/40 bg-primary/5",
                )}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-medium">14 Aug 2026</div>
                    <div className="text-[10px] text-muted-foreground">Independence Day</div>
                  </div>
                  {phase === 3 && (
                    <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[8px] font-semibold text-primary">
                      NEW
                    </span>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="rounded-md border border-dashed px-3 py-2 text-[10px] text-muted-foreground">
            Recepta won't offer appointments on closure dates.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module 3 — Staff Allocation
//
// Animates the real dashboard UI:
//   Phase 0: baseline roster (4 staff)
//   Phase 1: "Add Staff" button pulses
//   Phase 2: form panel slides open with new staff data filled in
//            (Ayesha Siddiqui / Nail Artist / Gel Manicure, Nail Art /
//             Mon-Fri)
//   Phase 3: Save button highlights
//   Phase 4: form closes, new row appears in table
//   Phase 5: Edit pencil icon pulse
//   Phase 6: hold
// ---------------------------------------------------------------------------

function StaffAllocationPreview({ phase, reduced }: { phase: number; reduced: boolean }) {
  const buttonPulse = phase === 1;
  const formOpen = phase >= 2 && phase <= 3;
  const showNewRow = phase >= 4;
  const savePulse = phase === 3;
  const editPulse = phase === 5;

  const newStaff = {
    name: "Ayesha Siddiqui",
    role: "Nail Artist",
    specs: ["Gel Manicure", "Nail Art"],
    days: "Mon–Fri",
  };

  return (
    <div className="absolute inset-0 p-4">
      <PlaceholderBadge label="Live product demo · loops 9s" />
      <Card className="h-full border shadow-none bg-white overflow-hidden">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm">Staff Allocation</CardTitle>
            <p className="text-[10px] text-muted-foreground">
              Specializations and working days the AI uses to route bookings.
            </p>
          </div>
          <motion.div
            animate={
              buttonPulse && !reduced
                ? { scale: [1, 1.04, 1], boxShadow: ["0 0 0 0 rgba(10,133,140,0)", "0 0 0 6px rgba(10,133,140,0.18)", "0 0 0 0 rgba(10,133,140,0)"] }
                : { scale: 1 }
            }
            transition={{ duration: 1.2, ease: EASE.standard }}
            className="rounded-md"
          >
            <Button size="sm" className="h-7 bg-primary text-[11px] hover:bg-primary/90">
              <Plus className="size-3" /> Add Staff
            </Button>
          </motion.div>
        </CardHeader>
        <CardContent className="p-0">
          <AnimatePresence>
            {formOpen && (
              <motion.div
                key="form"
                initial={reduced ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: 0.35, ease: EASE.standard }}
                className="overflow-hidden border-b bg-accent/40"
              >
                <div className="grid gap-2 px-4 py-3">
                  <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <div>
                      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Name · Role</div>
                      <div className="mt-0.5 rounded border border-primary/40 bg-white px-2 py-1 text-[11px] font-medium">
                        {newStaff.name} · {newStaff.role}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Specializations · Days</div>
                      <div className="mt-0.5 rounded border bg-white px-2 py-1 text-[11px]">
                        {newStaff.specs.join(", ")} · {newStaff.days}
                      </div>
                    </div>
                    <motion.div
                      animate={
                        savePulse && !reduced
                          ? { scale: [1, 1.06, 1], boxShadow: ["0 0 0 0 rgba(10,133,140,0)", "0 0 0 6px rgba(10,133,140,0.22)", "0 0 0 0 rgba(10,133,140,0)"] }
                          : { scale: 1 }
                      }
                      transition={{ duration: 1.0, ease: EASE.standard }}
                      className="rounded-md"
                    >
                      <Button size="sm" className="h-7 bg-primary text-[11px] hover:bg-primary/90">
                        <Save className="size-3" /> Save
                      </Button>
                    </motion.div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Staff</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Role</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Specializations</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Working Days</TableHead>
                <TableHead className="text-right text-[10px] uppercase tracking-wide text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* New row slides in at phase 4 */}
              <AnimatePresence>
                {showNewRow && (
                  <motion.tr
                    key="new-staff"
                    initial={reduced ? false : { opacity: 0, y: -8, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto" }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    transition={{ duration: 0.4, ease: EASE.out }}
                    className={cn(
                      "border-b transition-colors",
                      (phase === 4 || phase === 5) && !reduced && "bg-primary/5",
                    )}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="grid size-6 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                          {newStaff.name.split(" ").map((p) => p[0]).join("")}
                        </div>
                        <span className="text-[11px] font-medium">
                          {newStaff.name}
                          {phase === 4 && (
                            <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[8px] font-semibold text-primary">
                              NEW
                            </span>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{newStaff.role}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {newStaff.specs.map((sp) => (
                          <Badge key={sp} variant="outline" className="text-[9px]">{sp}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-[11px]">{newStaff.days}</TableCell>
                    <TableCell className="text-right">
                      <motion.div
                        className="ml-auto inline-block"
                        animate={
                          editPulse && !reduced
                            ? { rotate: [0, -8, 8, 0] }
                            : { rotate: 0 }
                        }
                        transition={{ duration: 0.6, ease: EASE.standard }}
                      >
                        <Pencil className="size-3.5 text-muted-foreground" />
                      </motion.div>
                    </TableCell>
                  </motion.tr>
                )}
              </AnimatePresence>
              {MODULE_STAFF.map((s) => (
                <TableRow key={s.name}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="grid size-6 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                        {s.name.split(" ").map((p) => p[0]).join("")}
                      </div>
                      <span className="text-[11px] font-medium">{s.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">{s.role}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {s.specs.map((sp) => (
                        <Badge key={sp} variant="outline" className="text-[9px]">{sp}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-[11px]">{s.days}</TableCell>
                  <TableCell className="text-right">
                    <Pencil className="ml-auto size-3.5 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module 4 — AI Rules
//
// Animates the real dashboard UI:
//   Phase 0: baseline (4/5 rules enabled)
//   Phase 1: WELCOME10 row highlight
//   Phase 2: WELCOME10 toggle flips OFF → ON
//   Phase 3: "5/5 enabled" badge updates with subtle pulse
//   Phase 4: hold (read)
// ---------------------------------------------------------------------------

function AIRulesPreview({ phase, reduced }: { phase: number; reduced: boolean }) {
  // WELCOME10 is the 5th rule — phase 2 flips it ON
  const welcomeOn = phase >= 2;
  const rowHighlight = phase === 1;
  const badgePulse = phase === 3;
  const enabledCount = welcomeOn ? 5 : 4;

  return (
    <div className="absolute inset-0 grid grid-cols-2 gap-3 p-4">
      <PlaceholderBadge label="Live product demo · loops 9s" />
      {/* Rules column */}
      <Card className="h-full border shadow-none bg-white">
        <CardHeader className="pb-1.5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Active Rules</CardTitle>
            <motion.div
              animate={
                badgePulse && !reduced
                  ? { scale: [1, 1.12, 1] }
                  : { scale: 1 }
              }
              transition={{ duration: 0.9, ease: EASE.standard }}
            >
              <Badge variant="secondary" className="font-mono text-[9px]">
                {enabledCount} / 5 enabled
              </Badge>
            </motion.div>
          </div>
        </CardHeader>
        <CardContent className="p-0 divide-y">
          {MODULE_RULES.map((r, i) => {
            const isWelcome = i === 4;
            const on = isWelcome ? welcomeOn : r.on;
            return (
              <motion.div
                key={r.label}
                animate={
                  rowHighlight && isWelcome && !reduced
                    ? { backgroundColor: ["rgba(10,133,140,0)", "rgba(10,133,140,0.10)", "rgba(10,133,140,0)"] }
                    : { backgroundColor: "rgba(10,133,140,0)" }
                }
                transition={{ duration: 1.0, ease: EASE.standard }}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldCheck
                    className={
                      on
                        ? "size-3.5 shrink-0 text-primary"
                        : "size-3.5 shrink-0 text-muted-foreground"
                    }
                  />
                  <span className="truncate text-[11px] font-medium">{r.label}</span>
                  {isWelcome && welcomeOn && phase >= 2 && (
                    <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[8px] font-semibold text-primary">
                      NEW
                    </span>
                  )}
                </div>
                <motion.div
                  animate={
                    // Phase 2: animate the toggle knob sliding
                    isWelcome && phase >= 2 && !reduced
                      ? { scale: [1, 1.18, 1] }
                      : { scale: 1 }
                  }
                  transition={{ duration: 0.6, ease: EASE.standard, delay: isWelcome && phase === 2 ? 0.05 : 0 }}
                >
                  <Switch checked={on} />
                </motion.div>
              </motion.div>
            );
          })}
        </CardContent>
      </Card>

      {/* Triggers column */}
      <Card className="h-full border shadow-none bg-white">
        <CardHeader className="pb-1.5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Escalation Triggers</CardTitle>
            <Badge variant="secondary" className="font-mono text-[9px]">
              3 / 4 enabled
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0 divide-y">
          {MODULE_TRIGGERS.map((t) => (
            <div key={t.label} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertOctagon
                  className={
                    t.on
                      ? "size-3.5 shrink-0 text-destructive"
                      : "size-3.5 shrink-0 text-muted-foreground"
                  }
                />
                <span className="truncate text-[11px] font-medium">{t.label}</span>
              </div>
              <Switch checked={t.on} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module 5 — Bookings
//
// Animates the real dashboard UI:
//   Phase 0: baseline (today's 5 bookings, stats strip)
//   Phase 1: date pill highlight
//   Phase 2: date swaps Today → Tomorrow (14 Aug 2026 — but Independence
//            Day, so shows as "Closed" instead of bookings)
//   Phase 3: date resets to Today; new booking row slides in at top
//            (5:00 PM · Hira M. · Hair Cut & Style · Pending)
//   Phase 4: status badge Pending → Confirmed with color transition
//   Phase 5: hold
// ---------------------------------------------------------------------------

function BookingsPreview({ phase, reduced }: { phase: number; reduced: boolean }) {
  const counts = {
    pending: MODULE_BOOKINGS.filter((b) => b.status === "pending").length,
    confirmed: MODULE_BOOKINGS.filter((b) => b.status === "confirmed").length,
    completed: MODULE_BOOKINGS.filter((b) => b.status === "completed").length,
    cancelled: MODULE_BOOKINGS.filter((b) => b.status === "cancelled").length,
  };

  // Date pill states
  const datePill = phase === 1 ? "highlight" : phase === 2 ? "tomorrow-closed" : "today";
  const newRowVisible = phase >= 3;
  const newRowConfirmed = phase >= 4;

  return (
    <div className="absolute inset-0 p-3">
      <PlaceholderBadge label="Live product demo · loops 9s" />
      <div className="mb-2 grid grid-cols-4 gap-2">
        <StatChip icon={<Clock className="size-3" />} label="Pending" value={newRowVisible ? counts.pending + 1 : counts.pending} tone="warning" />
        <StatChip icon={<CheckCircle2 className="size-3" />} label="Confirmed" value={newRowConfirmed ? counts.confirmed + 1 : counts.confirmed} tone="success" />
        <StatChip icon={<CheckCircle2 className="size-3" />} label="Completed" value={counts.completed} tone="muted" />
        <StatChip icon={<X className="size-3" />} label="Cancelled" value={counts.cancelled} tone="danger" />
      </div>

      <Card className="border shadow-none bg-white">
        <CardHeader className="pb-1.5 flex flex-row items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-2">
            <CalendarDays className="size-3.5 text-muted-foreground" />
            <AnimatePresence mode="wait">
              {datePill === "tomorrow-closed" ? (
                <motion.span
                  key="closed"
                  initial={reduced ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-center gap-2"
                >
                  Tomorrow
                  <span className="text-[10px] font-normal text-muted-foreground">
                    · 14 Aug 2026 · Closed (Independence Day)
                  </span>
                </motion.span>
              ) : (
                <motion.span
                  key="today"
                  initial={reduced ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-center gap-2"
                >
                  Today
                  <span className="text-[10px] font-normal text-muted-foreground">
                    · {MODULE_BOOKINGS.length + (newRowVisible ? 1 : 0)} bookings
                  </span>
                </motion.span>
              )}
            </AnimatePresence>
          </CardTitle>
          <motion.div
            animate={
              datePill === "highlight" && !reduced
                ? { scale: [1, 1.06, 1], backgroundColor: ["rgba(10,133,140,0)", "rgba(10,133,140,0.18)", "rgba(10,133,140,0)"] }
                : { scale: 1, backgroundColor: "rgba(10,133,140,0)" }
            }
            transition={{ duration: 1.0, ease: EASE.standard }}
            className="grid size-7 place-items-center rounded-md bg-background"
          >
            <CalendarDays className="size-3.5 text-muted-foreground" />
          </motion.div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Time</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Customer</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Service</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide text-muted-foreground">Stylist</TableHead>
                <TableHead className="text-right text-[10px] uppercase tracking-wide text-muted-foreground">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* New booking row slides in at phase 3 */}
              <AnimatePresence>
                {newRowVisible && (
                  <motion.tr
                    key="new-booking"
                    initial={reduced ? false : { opacity: 0, y: -10, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto" }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    transition={{ duration: 0.4, ease: EASE.out }}
                    className={cn(
                      "border-b transition-colors",
                      phase === 3 && !reduced && "bg-primary/5",
                    )}
                  >
                    <TableCell className="text-[11px] font-medium tabular-nums">5:00 PM</TableCell>
                    <TableCell className="text-[11px] font-medium">
                      Hira M.
                      {phase === 3 && (
                        <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[8px] font-semibold text-primary">
                          NEW
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-[11px]">Hair Cut & Style</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-[11px]">
                        <UserIcon className="size-3 text-muted-foreground" />
                        Hira
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <AnimatePresence mode="wait">
                        {newRowConfirmed ? (
                          <motion.div
                            key="confirmed"
                            initial={reduced ? false : { opacity: 0, scale: 0.85 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
                            transition={{ duration: 0.3, ease: EASE.standard }}
                            className="inline-block"
                          >
                            <Badge className={cn("text-[9px] capitalize", STATUS_TONE.confirmed)}>
                              confirmed
                            </Badge>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="pending"
                            initial={reduced ? false : { opacity: 0, scale: 0.85 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
                            transition={{ duration: 0.3, ease: EASE.standard }}
                            className="inline-block"
                          >
                            <Badge className={cn("text-[9px] capitalize", STATUS_TONE.pending)}>
                              pending
                            </Badge>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </TableCell>
                  </motion.tr>
                )}
              </AnimatePresence>
              {MODULE_BOOKINGS.slice(0, 4).map((b) => (
                <TableRow key={b.customer}>
                  <TableCell className="text-[11px] font-medium tabular-nums">{b.time}</TableCell>
                  <TableCell className="text-[11px] font-medium">{b.customer}</TableCell>
                  <TableCell className="text-[11px]">{b.service}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-[11px]">
                      <UserIcon className="size-3 text-muted-foreground" />
                      {b.staff}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge className={`text-[9px] capitalize ${STATUS_TONE[b.status]}`}>
                      {b.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatChip({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "warning" | "success" | "muted" | "danger";
}) {
  const toneClass: Record<typeof tone, string> = {
    warning: "bg-warning-soft text-[oklch(0.35_0.1_70)]",
    success: "bg-success-soft text-[oklch(0.42_0.10_195)]",
    muted: "bg-muted text-muted-foreground",
    danger: "bg-danger-soft text-[oklch(0.4_0.18_27)]",
  };
  return (
    <Card className="border shadow-none bg-white">
      <CardContent className="p-2.5 flex items-center gap-2">
        <div className={`grid size-7 shrink-0 place-items-center rounded-md ${toneClass[tone]}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-base font-semibold tabular-nums leading-tight">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Module 6 — Escalations
//
// The ONE module where conversation content lives inside the dashboard UI
// itself. We animate the existing right-pane conversation thread:
//   Phase 0: baseline — escalation list + thread
//   Phase 1: Areeba F. row highlights in the list (medical concern)
//   Phase 2: Right pane thread header swaps to Areeba F.
//   Phase 3: New customer message animates into the thread
//            ("Service se mujhe allergy ho gayi.")
//   Phase 4: AI reply animates into the thread
//            ("Let me connect you with a team member who can help…")
//   Phase 5: "Take Over Chat" button pulses
//   Phase 6: hold
// ---------------------------------------------------------------------------

function EscalationsPreview({ phase, reduced }: { phase: number; reduced: boolean }) {
  // selected escalation index: 0 = Iqra, 1 = Areeba
  const selected = phase >= 2 ? 1 : 0;
  const showCustomerMsg = phase >= 3;
  const showAiReply = phase >= 4;
  const takeoverPulse = phase === 5;
  const current = MODULE_ESCALATIONS[selected];

  return (
    <div className="absolute inset-0 grid grid-cols-2 gap-3 p-4">
      <PlaceholderBadge label="Live product demo · loops 9s" />
      {/* Left: list */}
      <Card className="h-full border shadow-none bg-white">
        <CardHeader className="pb-1.5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Active</CardTitle>
            <div className="inline-flex rounded border bg-background p-0.5 text-[9px]">
              <span className="rounded-sm bg-primary px-1.5 py-0.5 text-primary-foreground">Active</span>
              <span className="px-1.5 py-0.5 text-muted-foreground">Resolved</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {MODULE_ESCALATIONS.map((e, i) => {
              const isSelected = i === selected;
              return (
                <motion.li
                  key={e.phone}
                  animate={
                    isSelected && !reduced
                      ? { backgroundColor: ["rgba(10,133,140,0)", "rgba(10,133,140,0.08)", "rgba(10,133,140,0.05)"] }
                      : { backgroundColor: i === 0 ? "rgba(10,133,140,0.05)" : "rgba(10,133,140,0)" }
                  }
                  transition={{ duration: 0.6, ease: EASE.standard }}
                  className={cn(
                    "border-l-2 px-3 py-2",
                    isSelected ? "border-primary bg-primary/5" : "border-transparent",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold">{e.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{e.time}</span>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">{e.phone}</div>
                  <div className="mt-1 truncate text-[11px] text-foreground/80">{e.snippet}</div>
                  <div className="mt-1.5">
                    <Badge className={cn("text-[9px]", REASON_TONE)}>{e.reason}</Badge>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Right: thread — animates the existing conversation content */}
      <Card className="h-full border shadow-none bg-white">
        <CardHeader className="pb-1.5">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xs flex items-center gap-1.5">
                <Phone className="size-3 text-muted-foreground" />
                <AnimatePresence mode="wait">
                  <motion.span
                    key={current.phone}
                    initial={reduced ? false : { opacity: 0, y: -3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, y: 3 }}
                    transition={{ duration: 0.25 }}
                  >
                    {current.phone}
                  </motion.span>
                </AnimatePresence>
              </CardTitle>
              <AnimatePresence mode="wait">
                <motion.p
                  key={current.name}
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="text-[10px] text-muted-foreground"
                >
                  {current.name}
                </motion.p>
              </AnimatePresence>
            </div>
            <motion.div
              animate={
                takeoverPulse && !reduced
                  ? { scale: [1, 1.06, 1], boxShadow: ["0 0 0 0 rgba(10,133,140,0)", "0 0 0 6px rgba(10,133,140,0.22)", "0 0 0 0 rgba(10,133,140,0)"] }
                  : { scale: 1 }
              }
              transition={{ duration: 1.0, ease: EASE.standard }}
              className="rounded-md"
            >
              <Button size="sm" className="h-6 bg-primary text-[10px] hover:bg-primary/90">
                Take Over Chat
              </Button>
            </motion.div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 p-3">
          {/* Existing thread content (Iqra's conversation) */}
          {selected === 0 && (
            <>
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-1.5 text-[11px]">
                  Mujhe owner se baat karni hai.
                </div>
              </div>
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-1.5 text-[11px]">
                  Please — a refund ki bhi baat karni hai.
                </div>
              </div>
              <div className="flex justify-end">
                <div className="max-w-[85%]">
                  <div className="rounded-2xl rounded-tr-sm bg-primary px-3 py-1.5 text-[11px] text-primary-foreground">
                    Let me connect you with a team member who can help with that.
                  </div>
                  <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-muted-foreground">
                    <Bot className="size-2" /> AI · just now
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Areeba's conversation — builds up over phases 3-5 */}
          {selected === 1 && (
            <>
              <AnimatePresence>
                {showCustomerMsg && (
                  <motion.div
                    key="customer"
                    initial={reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
                    transition={{ duration: 0.35, ease: EASE.out }}
                    className="flex justify-start"
                  >
                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-1.5 text-[11px]">
                      Service se mujhe allergy ho gayi.
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {showAiReply && (
                  <motion.div
                    key="ai"
                    initial={reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
                    transition={{ duration: 0.35, ease: EASE.out }}
                    className="flex justify-end"
                  >
                    <div className="max-w-[85%]">
                      <div className="rounded-2xl rounded-tr-sm bg-primary px-3 py-1.5 text-[11px] text-primary-foreground">
                        Let me connect you with a team member who can help with the refund.
                      </div>
                      <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-muted-foreground">
                        <Bot className="size-2" /> AI · just now
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module 7 — Overview / Analytics
//
// Per brief: "Keep the main dashboard preview alive, but make the animation
// subtle." KPI numbers tick up subtly, activity feed rows stagger in, intent
// donut rebalances, Agent Live indicator pulses. No fake bubbles.
// ---------------------------------------------------------------------------

function OverviewPreview({ phase, reduced }: { phase: number; reduced: boolean }) {
  // Bookings KPI ticks subtly across phases (128 → 131)
  const bookingKpi = 128 + Math.floor(phase / 2);
  return (
    <div className="absolute inset-0 p-4">
      <PlaceholderBadge label="Live product demo · loops 9s" />
      <div className="mb-2 grid grid-cols-4 gap-2">
        <KpiMini label="Bookings handled" value={`${bookingKpi}`} sub="this month" highlight={phase >= 4} />
        <KpiMini label="Conversations" value="342" sub="this month" />
        <KpiMini label="AI resolution" value="87%" sub="of bookings" />
        <KpiMini label="Revenue" value="PKR 214k" sub="completed" />
      </div>

      <div className="mb-2 grid grid-cols-3 gap-2">
        <Card className="col-span-2 border shadow-none bg-white">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <BarChart3 className="size-3.5 text-muted-foreground" />
              Daily Conversation Volume
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <div className="flex h-16 items-end gap-1">
              {[18, 32, 24, 40, 55, 42, 28, 48, 60, 38, 26, 22, 30, 44, 36, 26, 18, 12].map((h, i) => (
                <motion.div
                  key={i}
                  className="flex-1 rounded-t bg-primary/80"
                  style={{ height: `${Math.max(8, (h / 60) * 100)}%` }}
                  initial={reduced ? false : { height: 0 }}
                  animate={{ height: `${Math.max(8, (h / 60) * 100)}%` }}
                  transition={{ duration: 0.7, ease: EASE.out, delay: reduced ? 0 : i * 0.02 }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
              <span>9a</span><span>12p</span><span>3p</span><span>6p</span><span>9p</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-none bg-white">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs">Intent Mix</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center p-2">
            <svg viewBox="0 0 36 36" className="size-14 -rotate-90">
              <circle cx="18" cy="18" r="14" fill="none" stroke="oklch(0.94 0.04 195)" strokeWidth="6" />
              <circle cx="18" cy="18" r="14" fill="none" stroke="oklch(0.55 0.11 195)" strokeWidth="6"
                strokeDasharray="55 100" strokeLinecap="butt" />
              <circle cx="18" cy="18" r="14" fill="none" stroke="oklch(0.72 0.15 70)" strokeWidth="6"
                strokeDasharray="25 100" strokeDashoffset="-55" strokeLinecap="butt" />
              <circle cx="18" cy="18" r="14" fill="none" stroke="oklch(0.6 0.22 27)" strokeWidth="6"
                strokeDasharray="15 100" strokeDashoffset="-80" strokeLinecap="butt" />
            </svg>
          </CardContent>
        </Card>
      </div>

      <Card className="border shadow-none bg-white">
        <CardHeader className="pb-1">
          <CardTitle className="text-xs">Recent AI Actions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <motion.ul
            className="divide-y"
            initial={reduced ? false : "hidden"}
            animate={reduced ? undefined : "visible"}
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
            }}
          >
            {[
              { tone: "success" as const, text: "Booked · Sana K. — Hair Cut & Style — tomorrow 3:00 PM", time: "2m" },
              { tone: "success" as const, text: "Replied · Ayesha M. — HydraFacial price quoted (PKR 6,500)", time: "5m" },
              { tone: "warn" as const, text: "Escalated · Iqra T. — customer_request_human", time: "12m" },
            ].map((f) => (
              <motion.li
                key={f.text}
                variants={{
                  hidden: { opacity: 0, y: -4 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE.out } },
                }}
                className="flex items-start gap-2 px-3 py-1.5"
              >
                <div
                  className={
                    f.tone === "success"
                      ? "size-6 shrink-0 grid place-items-center rounded-md bg-success-soft text-[oklch(0.42_0.10_195)]"
                      : "size-6 shrink-0 grid place-items-center rounded-md bg-warning-soft text-[oklch(0.35_0.1_70)]"
                  }
                >
                  <Sparkles className="size-3" />
                </div>
                <div className="min-w-0 flex-1 text-[11px]">{f.text}</div>
                <div className="shrink-0 text-[9px] text-muted-foreground">{f.time} ago</div>
              </motion.li>
            ))}
          </motion.ul>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiMini({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <Card className={cn("border shadow-none bg-white transition-colors", highlight && "border-primary/40")}>
      <CardContent className="p-2.5">
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <Sparkles className="size-2.5 text-primary" />
          <span className="text-sm font-semibold tabular-nums tracking-tight">{value}</span>
        </div>
        <div className="text-[9px] text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Public registry — array used by routes/index.tsx to build the section.
// Each entry maps to one ProductModuleShowcase. The consumer in ProductTour
// decides whether to wrap each preview in a ProductDemoSequence (interactive)
// or a plain ProductDemoFrame (static).
//
// Preview components accept { phase, reduced } and use phase to drive real
// dashboard UI state changes — no chat narration overlay.
// ---------------------------------------------------------------------------

export const PRODUCT_MODULE_PREVIEWS = {
  overview: OverviewPreview,
  bookings: BookingsPreview,
  hours: OperatingHoursPreview,
  services: ServicesCatalogPreview,
  staff: StaffAllocationPreview,
  escalations: EscalationsPreview,
  aiRules: AIRulesPreview,
} as const;

export type ProductModuleId = keyof typeof PRODUCT_MODULE_PREVIEWS;

// ---------------------------------------------------------------------------
// PRODUCT_MODULE_DEMOS — phase data for the 5 interactive modules.
//
// Phase data is intentionally minimal — just an id + duration. The preview
// decides what UI change happens at each phase. This keeps the phase
// machine a pure scheduler and the UI changes declarative inside each
// preview component.
// ---------------------------------------------------------------------------

export interface ProductModuleDemo {
  /** Frame props — channel + page title match the dashboard's real route. */
  moduleLabel: string;
  pageTitle: string;
  pageDescription?: string;
  /** Phased loop — drives UI state changes inside the preview. */
  phases: Array<{ id: string; durationMs: number }>;
}

export const PRODUCT_MODULE_DEMOS: Partial<Record<ProductModuleId, ProductModuleDemo>> = {
  // Services — "owner adds service → catalog updates → AI can quote it"
  services: {
    moduleLabel: "Business Settings",
    pageTitle: "Services Catalog",
    pageDescription: "Add services, set prices and durations, and toggle them on or off.",
    phases: [
      { id: "baseline", durationMs: 1100 },
      { id: "highlight-add-btn", durationMs: 1100 },
      { id: "modal-open", durationMs: 1500 },
      { id: "save-pulse", durationMs: 1100 },
      { id: "row-added", durationMs: 1400 },
      { id: "toggle-pulse", durationMs: 1100 },
      { id: "hold", durationMs: 1800 },
    ],
  },

  // Operating Hours — "owner edits hours + holiday → schedule updates"
  hours: {
    moduleLabel: "Business Settings",
    pageTitle: "Operating Hours",
    pageDescription: "Set when your salon is open — weekly hours, appointment buffer, and holidays.",
    phases: [
      { id: "baseline", durationMs: 1100 },
      { id: "tuesday-highlight", durationMs: 1100 },
      { id: "tuesday-updated", durationMs: 1300 },
      { id: "holiday-added", durationMs: 1400 },
      { id: "save-pulse", durationMs: 1100 },
      { id: "hold", durationMs: 1800 },
    ],
  },

  // Bookings — "owner checks tomorrow's date → new booking appears in today"
  bookings: {
    moduleLabel: "Bookings",
    pageTitle: "Today's Appointments",
    pageDescription: "All appointments for today, in Asia/Karachi time.",
    phases: [
      { id: "baseline", durationMs: 1100 },
      { id: "date-pulse", durationMs: 1100 },
      { id: "date-tomorrow", durationMs: 1400 },
      { id: "row-added", durationMs: 1300 },
      { id: "status-confirmed", durationMs: 1300 },
      { id: "hold", durationMs: 1800 },
    ],
  },

  // Escalations — "AI escalates a conversation → owner takes over"
  escalations: {
    moduleLabel: "Escalations",
    pageTitle: "Conversations that need your attention",
    pageDescription: "Take over manually or mark resolved.",
    phases: [
      { id: "baseline", durationMs: 1100 },
      { id: "row-highlight", durationMs: 1100 },
      { id: "thread-swap", durationMs: 1300 },
      { id: "customer-msg", durationMs: 1400 },
      { id: "ai-reply", durationMs: 1300 },
      { id: "takeover-pulse", durationMs: 1100 },
      { id: "hold", durationMs: 1800 },
    ],
  },

  // AI Rules — "owner toggles a rule on → AI gains new behavior"
  aiRules: {
    moduleLabel: "Agent Rules",
    pageTitle: "AI Agent Rules & Guardrails",
    pageDescription: "Toggle which predefined rules and escalation triggers apply to this salon.",
    phases: [
      { id: "baseline", durationMs: 1100 },
      { id: "row-highlight", durationMs: 1200 },
      { id: "toggle-on", durationMs: 1300 },
      { id: "badge-pulse", durationMs: 1200 },
      { id: "hold", durationMs: 1800 },
    ],
  },
};