import { Card, CardContent } from "@/components/ui/card";
import { Mail, Image, FolderOpen, ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

const services = [
  { label: "Email Campaigns", description: "Compose and send email campaigns with WYSIWYG editor", icon: Mail, to: "/services/email", color: "bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400" },
  { label: "Image Studio", description: "Pick a template, shape the copy, render a PNG", icon: Image, to: "/app/services/images", color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400" },
  { label: "Asset Manager", description: "Upload, organise and manage your digital assets", icon: FolderOpen, to: "/app/services/assets", color: "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400" },
];

export default function Services() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Services</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Email campaigns, rendering studio, and asset management.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s) => (
          <Link key={s.to} to={s.to}>
            <Card className="notebook-card cursor-pointer transition-all hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm h-full">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${s.color}`}><s.icon className="h-6 w-6" /></div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2"><h3 className="font-semibold text-[var(--nb-ink)]">{s.label}</h3><ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" /></div>
                    <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
