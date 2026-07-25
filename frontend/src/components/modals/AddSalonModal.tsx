import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { api, qk } from "@/lib/api";
import type { Tier } from "@/types";

interface Props { open: boolean; onOpenChange: (v: boolean) => void }

export function AddSalonModal({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>("basic");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [systemAccessToken, setSystemAccessToken] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [city, setCity] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.createSalon({ name, tier, phoneNumberId, systemAccessToken, whatsappNumber, city }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.salons });
      toast.success("Salon created");
      onOpenChange(false);
      setName(""); setPhoneNumberId(""); setSystemAccessToken("");
      setWhatsappNumber(""); setCity(""); setTier("basic");
    },
    onError: () => toast.error("Failed to create salon"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add salon instance</DialogTitle>
          <DialogDescription>
            Provisions a new tenant and prepares WhatsApp routing.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Business name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Glow Studio Karachi" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Tier</Label>
              <Select value={tier} onValueChange={(v) => setTier(v as Tier)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic">Basic</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Karachi" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>WhatsApp number</Label>
            <Input
              value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="923001234567" className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label>Meta phone_number_id (optional)</Label>
            <Input
              value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="1043221109888" className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label>System access token (optional)</Label>
            <Input
              type="password" value={systemAccessToken}
              onChange={(e) => setSystemAccessToken(e.target.value)}
              placeholder="EAAG…" className="font-mono"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!name || !whatsappNumber || create.isPending}
          >
            {create.isPending ? "Creating…" : "Create salon"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}