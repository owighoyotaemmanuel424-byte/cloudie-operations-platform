import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/admin/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Users } from "lucide-react";

const MONEY = (minor: number) => `₦${(minor / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

type UserRow = {
  _id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  balanceNgn: number;
  points: number;
  workspaces: number;
  createdAt: number;
};

export default function AdminUsers() {
  const rows = useQuery(api.adminOverview.userRows) as UserRow[] | undefined;
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [balanceSel, setBalanceSel] = useState<"all" | "has" | "zero">("all");
  const [busyId, setBusyId] = useState<Id<"users"> | null>(null);
  const navigate = useNavigate();

  const filtered = rows
    ? ([] as typeof rows)
        .slice(0)
        .concat(rows)
        .filter((u: any) => {
          if (search.trim()) {
            const q = search.toLowerCase();
            if (!(u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))) return false;
          }
          if (role !== "all" && u.role !== role) return false;
          if (status !== "all" && u.status !== status) return false;
          if (balanceSel === "has" && u.points <= 0 && u.balanceNgn <= 0) return false;
          if (balanceSel === "zero" && (u.points !== 0 || u.balanceNgn !== 0)) return false;
          return true;
        })
        .sort((a: any, b: any) => Number(b.createdAt) - Number(a.createdAt))
    : undefined;

  async function toggleUser(id: Id<"users">, suspended: boolean, reason: string) {
    setBusyId(id);
    try {
      await toggleSuspend({ userId: id as never, suspend: !suspended, reason });
      toast.success(suspended ? "User reactivated" : "User suspended");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Operation failed");
    } finally {
      setBusyId(null);
    }
  }
  const navigate = useNavigate();

  const filtered = rows
    ?.filter((user) => {
      if (search.trim()) {
        const query = search.toLowerCase();
        if (!(user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query))) return false;
      }
      if (role !== "all" && user.role !== role) return false;
      if (status !== "all" && user.status !== status) return false;
      if (balanceSel === "has" && user.points <= 0 && user.balanceNgn <= 0) return false;
      if (balanceSel === "zero" && (user.points !== 0 || user.balanceNgn !== 0)) return false;
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search, filter and manage platform users.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled
          >
            Bulk
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email"
          className="max-w-[220px]"
          aria-label="Search users"
        />
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="max-w-[130px]"><SelectValue placeholder="Any role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any role</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="vendor">Vendor</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="max-w-[130px]"><SelectValue placeholder="Any status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="terminated">Terminated</SelectItem>
          </SelectContent>
        </Select>
        <Select value={balanceSel} onValueChange={(value) => setBalanceSel(value as "all" | "has" | "zero")}>
          <SelectTrigger className="max-w-[140px]"><SelectValue placeholder="Any balance" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any balance</SelectItem>
            <SelectItem value="has">Has balance</SelectItem>
            <SelectItem value="zero">Zero balance</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered === undefined ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Users className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">No users match those filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <Card>
            <div className="overflow-hidden border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-3">User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Active workspaces</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead className="pr-3 w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((user: any) => (
                    <TableRow key={user._id}>
                      <TableCell className="pl-3">
                        <div className="min-w-0">
                          <Link to={`/admin/users/${user._id}`} className="block truncate text-sm font-medium hover:text-primary">
                            {user.name || user.email}
                          </Link>
                          <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={user.role} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={user.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        <span className="text-foreground">{MONEY(user.balanceNgn || user.points * 100)}</span>
                        {user.points > 0 && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {user.points.toLocaleString()} pts
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {user.workspaces}
                      </TableCell>
                      <TableCell className="text-right text-[11px] text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="pr-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => void navigate(`/admin/users/${user._id}`)}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Balances are shown in NGN; point holdings are shown where larger than zero.
      </p>
    </div>
  );
}
