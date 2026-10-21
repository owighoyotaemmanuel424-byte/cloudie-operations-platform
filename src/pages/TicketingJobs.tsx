import { useParams } from "react-router";
import { motion } from "framer-motion";
import {
  FileText,
  Download,
  RefreshCw,
  MessageCircle,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { JobProgress } from "@/components/JobProgress";
import { useAuth } from "@/hooks/use-auth";

export type JobStatus = "pending" | "success" | "failed";

interface JobDocument {
  _id: string;
  title: string;
  service: string;
  status: JobStatus;
  progress: number;
  currentStep: number;
  totalSteps: number;
  error?: string;
  errorRefId?: string;
  refId: string;
  pdfUrl?: string;
  paid: boolean;
  points: number;
  createdAt: string;
}

interface JobDetailProps {
  job: JobDocument;
  onRetry: (jobId: string) => void;
  onDownload: (jobId: string) => void;
  onCancel: (jobId: string) => void;
}

export function JobDetail({ job, onRetry, onDownload, onCancel }: JobDetailProps) {
  const { user } = useAuth();
  const { id } = useParams();
  const isOpen = Boolean(id) && id === job._id;

  if (!isOpen) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="min-h-screen flex items-center justify-center bg-background"
      >
        <Card className="w-full max-w-md border-border/80 p-6 shadow-sm">
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground">Job not found or expired.</p>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  const iconColor =
    job.status === "success"
      ? "bg-success/10 text-success"
      : job.status === "failed"
      ? "bg-error/10 text-error"
      : "bg-primary/10 text-primary";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="min-h-screen bg-background px-4 py-8"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Job <span className="text-primary">#{job._id.slice(0, 8)}</span>
          </h1>
          <p className="text-sm text-muted-foreground">{job.title}</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
          <div className="space-y-6">
            {job.status === "pending" && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <Card className="border-border/80 p-6">
                  <JobProgress
                    value={job.progress}
                    label={"Rendering page " + job.currentStep + " of " + job.totalSteps + "…"}
                    className="bg-background/80"
                  />
                </Card>
                <p className="text-center text-xs text-muted-foreground">
                  You will be charged 1 point only if generation succeeds.
                </p>
                <Button variant="secondary" onClick={() => onCancel(job._id)} className="w-full">
                  Cancel
                </Button>
              </motion.div>
            )}

            {job.status === "success" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              >
                <Card className="border-border/80 p-6">
                  <div className="flex items-center gap-3">
                    <span className={`flex size-11 items-center justify-center rounded-full ${iconColor}`}>
                      <CheckCircle className="size-5" />
                    </span>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">Your document is ready</h2>
                      <p className="text-sm text-muted-foreground">{job.title}</p>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <Button onClick={() => onDownload(job._id)} className="flex-1">
                      <Download className="mr-2 size-4" />
                      Download PDF
                    </Button>
                    <Button variant="outline" onClick={() => {}}>
                      Generate another
                    </Button>
                  </div>
                  <div className="mt-4 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground leading-5">
                    <div className="flex justify-between gap-2">
                      <span>Ref: <span className="font-mono">doc:{job.refId}</span></span>
                      <span>−{job.points} point</span>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}

            {job.status === "failed" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <Card className="border-error/30 bg-error/5 p-6">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-error/10 text-error">
                      <XCircle className="size-5" />
                    </span>
                    <div className="flex-1">
                      <h2 className="text-lg font-semibold text-foreground">Generation failed</h2>
                      <p className="mt-2 text-sm text-muted-foreground">{job.error || "The document could not be rendered."}</p>
                      <p className="mt-3 text-xs text-muted-foreground">You were not charged.</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Button variant="default" onClick={() => onRetry(job._id)} className="flex-1">
                      <RefreshCw className="mr-2 size-4" />
                      Retry (no charge)
                    </Button>
                    <Button variant="outline" onClick={() => {}}>
                      <MessageCircle className="mr-2 size-4" />
                      Contact support
                    </Button>
                  </div>
                </Card>
              </motion.div>
            )}
          </div>

          <div className="lg:sticky lg:top-8 lg:self-start">
            <JobTray status={job} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

interface JobTrayProps {
  status: JobDocument;
}

function JobTray({ status }: JobTrayProps) {
  return (
    <Card className="border-border/80 p-4">
      <CardContent className="p-0">
        <div className="flex items-center gap-3 border-b border-border/60 pb-3">
          {status.status === "success" ? (
            <CheckCircle className="size-5 text-success" />
          ) : status.status === "failed" ? (
            <XCircle className="size-5 text-error" />
          ) : (
            <Loader2 className="size-5 text-primary animate-spin" />
          )}
          <span className="min-w-0 text-xs font-medium text-foreground truncate">{status.title}</span>
        </div>
        <div className="p-3">
          <JobProgress
            value={status.progress}
            label={`${status.currentStep} / ${status.totalSteps}`}
            className="rounded-xl"
          />
        </div>
      </CardContent>
    </Card>
  );
}
