import { useState, useEffect } from "react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ArrowLeft, Ticket } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface Show {
  id: string;
  artist_name: string;
  venue_name: string;
  city: string;
  lat: number;
  lng: number;
  show_date: string;
  ticket_url: string | null;
  ticket_status: string | null;
  image_url: string | null;
}

const EMPTY_FORM = {
  artist_name: "",
  venue_name: "",
  city: "",
  lat: "",
  lng: "",
  show_date: "",
  ticket_url: "",
  ticket_status: "available",
  image_url: "",
};

export default function AdminShows() {
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchShows();
  }, []);

  const fetchShows = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("upcoming_shows")
      .select("*")
      .order("show_date", { ascending: false });
    if (error) {
      toast.error("Failed to load shows: " + error.message);
    } else {
      setShows((data as Show[]) || []);
    }
    setLoading(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (show: Show) => {
    setEditingId(show.id);
    setForm({
      artist_name: show.artist_name,
      venue_name: show.venue_name,
      city: show.city,
      lat: String(show.lat),
      lng: String(show.lng),
      show_date: show.show_date ? show.show_date.slice(0, 16) : "",
      ticket_url: show.ticket_url || "",
      ticket_status: show.ticket_status || "available",
      image_url: show.image_url || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.artist_name || !form.venue_name || !form.city || !form.show_date) {
      toast.error("Artist, venue, city, and date are required");
      return;
    }
    const lat = parseFloat(form.lat);
    const lng = parseFloat(form.lng);
    if (isNaN(lat) || isNaN(lng)) {
      toast.error("Lat/Lng must be valid numbers");
      return;
    }

    setSaving(true);
    const payload = {
      artist_name: form.artist_name,
      venue_name: form.venue_name,
      city: form.city,
      lat,
      lng,
      show_date: new Date(form.show_date).toISOString(),
      ticket_url: form.ticket_url || null,
      ticket_status: form.ticket_status,
      image_url: form.image_url || null,
    };

    const { error } = editingId
      ? await supabase.from("upcoming_shows").update(payload).eq("id", editingId)
      : await supabase.from("upcoming_shows").insert(payload);

    setSaving(false);
    if (error) {
      toast.error("Save failed: " + error.message);
      return;
    }
    toast.success(editingId ? "Show updated" : "Show created");
    setDialogOpen(false);
    fetchShows();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this show? This cannot be undone.")) return;
    const { error } = await supabase.from("upcoming_shows").delete().eq("id", id);
    if (error) {
      toast.error("Delete failed: " + error.message);
      return;
    }
    toast.success("Show deleted");
    fetchShows();
  };

  const statusBadge = (status: string | null) => {
    const map: Record<string, string> = {
      available: "bg-primary/20 text-primary border-primary/30",
      "few left": "bg-accent text-foreground border-border",
      "resale only": "bg-destructive/20 text-destructive border-destructive/30",
    };
    const cls = status ? map[status.toLowerCase()] || "" : "";
    return <Badge variant="outline" className={cls}>{status || "unset"}</Badge>;
  };

  return (
    <ProtectedRoute requireAdmin>
      <div className="page-container">
        <div className="max-w-6xl mx-auto section-spacing">
          <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground mb-6">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </Link>

          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-4xl font-bold mb-1 flex items-center gap-3">
                <Ticket className="w-8 h-8 text-primary" /> Shows & Tickets
              </h1>
              <p className="text-muted">Manage venue shows shown on the listener map</p>
            </div>
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" /> Add Show
            </Button>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artist</TableHead>
                  <TableHead>Venue / City</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted py-8">Loading...</TableCell></TableRow>
                ) : shows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted py-8">No shows yet</TableCell></TableRow>
                ) : (
                  shows.map((show) => (
                    <TableRow key={show.id}>
                      <TableCell className="font-medium">{show.artist_name}</TableCell>
                      <TableCell>
                        <div>{show.venue_name}</div>
                        <div className="text-sm text-muted">{show.city}</div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {new Date(show.show_date).toLocaleString("en-US", {
                          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell>{statusBadge(show.ticket_status)}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(show)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(show.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Show" : "Add Show"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Artist Name</Label>
              <Input value={form.artist_name} onChange={(e) => setForm({ ...form, artist_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Venue Name</Label>
              <Input value={form.venue_name} onChange={(e) => setForm({ ...form, venue_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Latitude</Label>
              <Input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="34.0522" />
            </div>
            <div className="space-y-1.5">
              <Label>Longitude</Label>
              <Input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="-118.2437" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Show Date & Time</Label>
              <Input type="datetime-local" value={form.show_date} onChange={(e) => setForm({ ...form, show_date: e.target.value })} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Ticket URL</Label>
              <Input value={form.ticket_url} onChange={(e) => setForm({ ...form, ticket_url: e.target.value })} placeholder="https://ticketmaster.com/..." />
            </div>
            <div className="space-y-1.5">
              <Label>Ticket Status</Label>
              <Select value={form.ticket_status} onValueChange={(v) => setForm({ ...form, ticket_status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="few left">Few Left</SelectItem>
                  <SelectItem value="resale only">Resale Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Image URL (optional)</Label>
              <Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProtectedRoute>
  );
}