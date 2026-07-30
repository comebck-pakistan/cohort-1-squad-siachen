import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2, CalendarX } from "lucide-react";
import { api, qk } from "@/lib/api";
import { useTenantBusinessId } from "@/lib/useTenantBusinessId";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

type ServiceRow = {
  id: string;
  name: string;
  duration: number;
  price: number;
  category: "Hair" | "Skin" | "Nails";
  active: boolean;
};

// Empty seed — services now come from GET /api/business/:id/services.
// Until the first row arrives the table renders an empty state.
const seedServices: ServiceRow[] = [];
const seedStaff: Array<{
  id: string;
  name: string;
  role: string;
  specs: string[];
  days: string;
}> = [];

export function TenantBusiness() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Business Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure hours, services, and staff — the AI uses these to book appointments.
        </p>
      </div>
      <Tabs defaultValue="hours">
        <TabsList>
          <TabsTrigger value="hours">Operating Hours</TabsTrigger>
          <TabsTrigger value="services">Services Catalog</TabsTrigger>
          <TabsTrigger value="staff">Staff Allocation</TabsTrigger>
        </TabsList>
        <TabsContent value="hours" className="mt-4">
          <HoursTab />
        </TabsContent>
        <TabsContent value="services" className="mt-4">
          <ServicesTab />
        </TabsContent>
        <TabsContent value="staff" className="mt-4">
          <StaffTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HoursTab() {
  const [days, setDays] = useState(
    DAYS.map((d) => ({
      day: d,
      open: d !== "Sunday",
      from: "10:00",
      to: "20:00",
    })),
  );
  const [buffer, setBuffer] = useState("15");
  const [closures, setClosures] = useState<{ date: string; reason: string }[]>([
    { date: "2026-08-14", reason: "Independence Day" },
  ]);
  const [newDate, setNewDate] = useState("");
  const [newReason, setNewReason] = useState("");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="border shadow-none bg-white lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Weekly Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {days.map((d, i) => (
            <div
              key={d.day}
              className="grid grid-cols-[110px_80px_1fr_1fr] items-center gap-3 py-2 border-b last:border-b-0"
            >
              <div className="text-sm font-medium">{d.day}</div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={d.open}
                  onCheckedChange={(v) =>
                    setDays((s) => s.map((x, j) => (i === j ? { ...x, open: v } : x)))
                  }
                />
                <span className="text-xs text-muted-foreground">{d.open ? "Open" : "Closed"}</span>
              </div>
              <TimeSelect
                value={d.from}
                disabled={!d.open}
                onChange={(v) => setDays((s) => s.map((x, j) => (i === j ? { ...x, from: v } : x)))}
              />
              <TimeSelect
                value={d.to}
                disabled={!d.open}
                onChange={(v) => setDays((s) => s.map((x, j) => (i === j ? { ...x, to: v } : x)))}
              />
            </div>
          ))}
          <div className="pt-4 border-t flex items-center gap-3">
            <Label className="text-sm">Buffer between appointments</Label>
            <Select value={buffer} onValueChange={setBuffer}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">No buffer</SelectItem>
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="45">45 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border shadow-none bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarX className="size-4" /> Holidays & Closures
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            {closures.map((c, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 bg-background"
              >
                <div>
                  <div className="text-sm font-medium">{c.date}</div>
                  <div className="text-xs text-muted-foreground">{c.reason}</div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setClosures((s) => s.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="space-y-2 pt-3 border-t">
            <Input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="bg-background"
            />
            <Input
              placeholder="Reason (e.g. Eid holiday)"
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              className="bg-background"
            />
            <Button
              size="sm"
              className="w-full"
              disabled={!newDate || !newReason}
              onClick={() => {
                setClosures((s) => [...s, { date: newDate, reason: newReason }]);
                setNewDate("");
                setNewReason("");
              }}
            >
              <Plus className="size-4" /> Add closure
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TimeSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="bg-background">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {HOURS.map((h) => (
          <SelectItem key={h} value={h}>
            {h}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ServicesTab() {
  const tenant = useTenantBusinessId();
  const businessId = tenant.data?.businessId ?? "";
  const servicesQ = useQuery({
    queryKey: businessId ? qk.services(businessId) : ["services", "none"],
    queryFn: () => api.services(businessId),
    enabled: !!businessId,
    staleTime: 60_000,
  });
  const [rows, setRows] = useState<ServiceRow[]>(seedServices);
  const [open, setOpen] = useState(false);

  // Sync API services into local state on first load. We keep local state so
  // the optimistic "Add" button keeps working without round-tripping each time.
  useEffect(() => {
    const list = servicesQ.data?.services;
    if (!list || list.length === 0) return;
    setRows(
      list.map((s) => ({
        id: s.id,
        name: s.name,
        duration: s.duration_minutes,
        price: s.price,
        category: ((s.category as ServiceRow["category"]) || "Hair"),
        active: true,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicesQ.data?.services?.length]);
  const [form, setForm] = useState({
    name: "",
    price: "",
    duration: "",
    category: "Hair" as ServiceRow["category"],
    description: "",
  });

  function add() {
    if (!form.name || !form.price || !form.duration) return;
    setRows((s) => [
      ...s,
      {
        id: crypto.randomUUID(),
        name: form.name,
        price: Number(form.price),
        duration: Number(form.duration),
        category: form.category,
        active: true,
      },
    ]);
    setForm({ name: "", price: "", duration: "", category: "Hair", description: "" });
    setOpen(false);
  }

  return (
    <Card className="border shadow-none bg-white">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Services Catalog</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-primary hover:bg-primary/90">
              <Plus className="size-4" /> Add New Service
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New service</DialogTitle>
              <DialogDescription>
                Add a service to your catalog. The AI description helps the agent explain what's
                included.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Service name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Bridal Makeup"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label>Price (PKR)</Label>
                  <Input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Duration (mins)</Label>
                  <Input
                    type="number"
                    value={form.duration}
                    onChange={(e) => setForm({ ...form, duration: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Category</Label>
                  <Select
                    value={form.category}
                    onValueChange={(v) =>
                      setForm({ ...form, category: v as ServiceRow["category"] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Hair">Hair</SelectItem>
                      <SelectItem value="Skin">Skin</SelectItem>
                      <SelectItem value="Nails">Nails</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>AI description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Explain what this service includes so the AI can describe it to customers…"
                  className="min-h-24"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={add} className="bg-primary hover:bg-primary/90">
                Add service
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Price</TableHead>
              <TableHead className="text-right">Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{r.category}</Badge>
                </TableCell>
                <TableCell>{r.duration} mins</TableCell>
                <TableCell>PKR {r.price.toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <Switch
                    checked={r.active}
                    onCheckedChange={(v) =>
                      setRows((s) => s.map((x) => (x.id === r.id ? { ...x, active: v } : x)))
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

type StaffRow = {
  id: string;
  name: string;
  role: string;
  specs: string[];
  days: string;
};

function StaffTab() {
  const tenant = useTenantBusinessId();
  const businessId = tenant.data?.businessId ?? "";
  const staffQ = useQuery({
    queryKey: businessId ? qk.staff(businessId) : ["staff", "none"],
    queryFn: () => api.staff(businessId),
    enabled: !!businessId,
    staleTime: 60_000,
  });
  const [rows, setRows] = useState<StaffRow[]>(seedStaff as StaffRow[]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", role: "", specs: "", days: "" });

  // Sync API staff into local state on first load.
  useEffect(() => {
    const list = staffQ.data?.staff;
    if (!list || list.length === 0) return;
    setRows(
      list.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role || "",
        specs: [],
        days: s.working_days || "",
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffQ.data?.staff?.length]);

  function add() {
    if (!form.name || !form.role) return;
    setRows((s) => [
      ...s,
      {
        id: crypto.randomUUID(),
        name: form.name,
        role: form.role,
        specs: form.specs
          .split(",")
          .map((sp) => sp.trim())
          .filter(Boolean),
        days: form.days || "—",
      },
    ]);
    setForm({ name: "", role: "", specs: "", days: "" });
    setOpen(false);
  }

  return (
    <Card className="border shadow-none bg-white">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Staff Allocation</CardTitle>
          <p className="text-xs text-muted-foreground">
            Specializations and working days the AI uses to route bookings.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-primary hover:bg-primary/90">
              <Plus className="size-4" /> Add Staff
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New staff member</DialogTitle>
              <DialogDescription>
                Add a team member with their profession so the AI can route bookings correctly.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Full name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Hina Malik"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Profession / Role</Label>
                <Input
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  placeholder="e.g. Senior Stylist, Esthetician, Nail Technician"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Specializations</Label>
                <Input
                  value={form.specs}
                  onChange={(e) => setForm({ ...form, specs: e.target.value })}
                  placeholder="Comma-separated, e.g. Hair, Color, Balayage"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Working days</Label>
                <Input
                  value={form.days}
                  onChange={(e) => setForm({ ...form, days: e.target.value })}
                  placeholder="e.g. Mon–Sat"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={add}
                disabled={!form.name || !form.role}
                className="bg-primary hover:bg-primary/90"
              >
                Add staff
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Specializations</TableHead>
              <TableHead>Working Days</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                  No staff added yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-full bg-primary/10 text-primary grid place-items-center text-xs font-semibold">
                        {s.name
                          .split(" ")
                          .map((p) => p[0])
                          .join("")}
                      </div>
                      {s.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.role}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {s.specs.map((sp) => (
                        <Badge key={sp} variant="outline" className="text-[10px]">
                          {sp}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{s.days}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
