import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, UserCog, ArrowRight, CheckCircle2, Phone, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type Escalation = {
  id: string;
  customer: string;
  phone: string;
  reason: string;
  detail: string;
  age: string;
  severity: "high" | "medium" | "low";
};

const initial: Escalation[] = [
  {
    id: "e1",
    customer: "Hassan R.",
    phone: "+92 321 5551122",
    reason: "Complaint about last visit",
    detail: "Customer called service \"worst in Lahore\" after being quoted PKR 800 for beard trim.",
    age: "12m ago",
    severity: "high",
  },
  {
    id: "e2",
    customer: "Unknown",
    phone: "+92 300 7778899",
    reason: "Asked for owner's personal number",
    detail: "Customer insisting on speaking directly to the salon owner about a refund.",
    age: "38m ago",
    severity: "medium",
  },
  {
    id: "e3",
    customer: "Rida A.",
    phone: "+92 333 4441122",
    reason: "AI failed to understand 2× in a row",
    detail: "Slang / Roman-Urdu mixed message about bridal package pricing.",
    age: "1h ago",
    severity: "low",
  },
];

const sevStyle: Record<Escalation["severity"], string> = {
  high: "bg-danger-soft text-[oklch(0.4_0.18_27)] border-transparent",
  medium: "bg-warning-soft text-[oklch(0.35_0.1_70)] border-transparent",
  low: "bg-muted text-muted-foreground border-transparent",
};

export function TenantEscalations() {
  const [items, setItems] = useState(initial);

  function resolve(id: string) {
    setItems((s) => s.filter((e) => e.id !== id));
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Escalations & Edge Cases</h1>
        <p className="text-sm text-muted-foreground">
          Chats the AI flagged for human review. Handle these first.
        </p>
      </div>

      {items.length === 0 ? (
        <Card className="border shadow-none bg-white">
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="size-8 text-primary mx-auto" />
            <div className="mt-3 text-sm font-medium">All clear</div>
            <div className="text-xs text-muted-foreground">No pending escalations.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map((e) => (
            <Card key={e.id} className="border shadow-none bg-white">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="size-9 rounded-md bg-danger-soft text-[oklch(0.4_0.18_27)] grid place-items-center shrink-0">
                      <AlertTriangle className="size-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{e.customer}</div>
                      <div className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                        <Phone className="size-3" /> {e.phone}
                      </div>
                    </div>
                  </div>
                  <Badge className={cn("text-[10px]", sevStyle[e.severity])}>
                    {e.severity.toUpperCase()}
                  </Badge>
                </div>
                <div>
                  <div className="text-sm font-medium">{e.reason}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{e.detail}</p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="size-3" /> {e.age}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline">
                      <UserCog className="size-4" /> Take Over
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => resolve(e.id)}
                      className="bg-primary hover:bg-primary/90"
                    >
                      Resolve <ArrowRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}