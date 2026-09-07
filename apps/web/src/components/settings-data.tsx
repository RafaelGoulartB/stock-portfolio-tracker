import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  AlertTriangle,
  Database,
  Download,
  FileArchive,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { DevSeedSection } from "@/components/dev-seed-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { trpc } from "@/lib/api";

const BACKUP_MEDIA_TYPE = "application/x-portifolio-backup+gzip";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsData() {
  const { i18n } = useLingui();
  const utils = trpc.useUtils();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [showImportConfirmation, setShowImportConfirmation] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const summary = trpc.data.summary.useQuery();

  const discardImport = () => {
    setShowImportConfirmation(false);
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const closeDeleteConfirmation = () => {
    setShowDeleteConfirmation(false);
    setDeleteConfirmation("");
  };

  const refreshApplicationData = async () => {
    await utils.invalidate();
  };

  const deleteAll = trpc.data.deleteAll.useMutation({
    onSuccess: async () => {
      await refreshApplicationData();
      closeDeleteConfirmation();
      toast.success(
        i18n._(
          msg({
            id: "settings.data.deleteSuccess",
            message: "All portfolio data was deleted. Your account was kept.",
          }),
        ),
      );
    },
    onError: () =>
      toast.error(
        i18n._(
          msg({
            id: "settings.data.deleteError",
            message: "Could not delete the application data.",
          }),
        ),
      ),
  });

  const importFile = async () => {
    if (!file) return;
    setIsImporting(true);
    try {
      const response = await fetch("/api/data/import", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": BACKUP_MEDIA_TYPE,
          "X-Backup-Confirmation": "REPLACE",
        },
        body: file,
      });
      const result = (await response.json()) as {
        error?: string;
        imported?: Record<string, number>;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Import failed");
      }

      await refreshApplicationData();
      discardImport();
      toast.success(
        i18n._(
          msg({
            id: "settings.data.importSuccess",
            message: "Backup imported successfully.",
          }),
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : i18n._(
              msg({
                id: "settings.data.importError",
                message: "Could not import this backup.",
              }),
            ),
      );
    } finally {
      setIsImporting(false);
    }
  };

  const totalRows = summary.data
    ? Object.values(summary.data).reduce((total, value) => total + value, 0)
    : null;

  return (
    <div className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted">
              <FileArchive className="size-4" aria-hidden="true" />
            </div>
            <div className="grid gap-1">
              <CardTitle>
                <Trans id="settings.data.backupTitle">Backup</Trans>
              </CardTitle>
              <CardDescription>
                <Trans id="settings.data.backupDescription">
                  Export a portable, compressed copy of all portfolio data in
                  this account.
                </Trans>
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Alert>
            <Database aria-hidden="true" />
            <AlertTitle>
              <Trans id="settings.data.scopeTitle">Account data</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans id="settings.data.scopeDescription">
                Includes transactions, allocation assets, cash balance, reviews,
                categories, assignments, and contribution-score settings.
                Passwords and active sessions are excluded.
              </Trans>
              {totalRows !== null ? (
                <span>
                  <Trans id="settings.data.rowCount">{totalRows} rows</Trans>
                </span>
              ) : null}
            </AlertDescription>
          </Alert>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" asChild>
              <a href="/api/data/export" download>
                <Download className="size-4" aria-hidden="true" />
                <Trans id="settings.data.export">Export backup</Trans>
              </a>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="size-4" aria-hidden="true" />
              <Trans id="settings.data.chooseImport">Choose backup</Trans>
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".jsonl.gz,application/gzip"
              className="sr-only"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setFile(nextFile);
                if (nextFile) setShowImportConfirmation(true);
              }}
            />
          </div>
          {file ? (
            <p className="text-xs text-muted-foreground">
              {file.name} · {formatFileSize(file.size)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {import.meta.env.DEV ? <DevSeedSection /> : null}

      <Card className="border-destructive/40">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 text-destructive">
              <Trash2 className="size-4" aria-hidden="true" />
            </div>
            <div className="grid gap-1">
              <CardTitle>
                <Trans id="settings.data.dangerTitle">Danger zone</Trans>
              </CardTitle>
              <CardDescription>
                <Trans id="settings.data.dangerDescription">
                  Permanently delete every portfolio row in this account. Your
                  login account remains available.
                </Trans>
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setShowDeleteConfirmation(true)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            <Trans id="settings.data.deleteAll">
              Delete all application data
            </Trans>
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={showImportConfirmation}
        onOpenChange={(open) => {
          if (isImporting) return;
          if (open) setShowImportConfirmation(true);
          else discardImport();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans id="settings.data.importTitle">
                Replace account data?
              </Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans id="settings.data.importDescription">
                Importing replaces all current portfolio data with this backup.
                The operation is atomic: an invalid or incomplete file leaves
                current data unchanged.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          {file ? (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="truncate font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(file.size)}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isImporting}
              onClick={discardImport}
            >
              <Trans id="common.cancel">Cancel</Trans>
            </Button>
            <Button type="button" disabled={isImporting} onClick={importFile}>
              {isImporting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="size-4" aria-hidden="true" />
              )}
              <Trans id="settings.data.importConfirm">Replace and import</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showDeleteConfirmation}
        onOpenChange={(open) => {
          if (deleteAll.isPending) return;
          if (open) setShowDeleteConfirmation(true);
          else closeDeleteConfirmation();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans id="settings.data.deleteTitle">Delete all data?</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans id="settings.data.deleteDescription">
                This cannot be undone. Export a backup first if you may need
                this data again.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>
              <Trans id="settings.data.deleteWarning">Permanent deletion</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans id="settings.data.deleteInstruction">
                Type DELETE below to confirm.
              </Trans>
            </AlertDescription>
          </Alert>
          <div className="grid gap-2">
            <Label htmlFor="delete-all-confirmation">DELETE</Label>
            <Input
              id="delete-all-confirmation"
              value={deleteConfirmation}
              autoComplete="off"
              onChange={(event) => setDeleteConfirmation(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleteAll.isPending}
              onClick={closeDeleteConfirmation}
            >
              <Trans id="common.cancel">Cancel</Trans>
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteConfirmation !== "DELETE" || deleteAll.isPending}
              onClick={() => deleteAll.mutate({ confirmation: "DELETE" })}
            >
              {deleteAll.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              <Trans id="settings.data.deleteConfirm">Delete everything</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
