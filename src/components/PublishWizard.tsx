"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import {
  ChangelogField,
  PublishErrorBanner,
  PublishForm,
  PublishSuccessBanner,
  submitPublishJson,
  type PublishSuccess,
} from "@/components/PublishForm";
import { ReadmeLintReport } from "@/components/ReadmeLintReport";
import { Markdown } from "@/components/Markdown";
import { formatPrice } from "@/lib/format";
import type { LintFinding } from "@/lib/readme-lint";
import type { Manifest } from "@/lib/types";

interface UploadedFile {
  path: string;
  content: string;
}

type DirInputProps = InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

function stripTopDir(path: string): string {
  const idx = path.indexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

type Mode = "directory" | "github";
type Step = 1 | 2 | 3;

interface ValidateResponse {
  ok: boolean;
  manifest?: Manifest;
  issues: string[];
  lint: LintFinding[];
}

/**
 * Directory-upload publish flow as a 3-step wizard: 1) pick a directory,
 * 2) "Check" against `POST /api/v1/validate` (manifest summary, blocking
 * issues, non-blocking README lint, a rendered README preview), 3) publish
 * with a changelog — the existing flow, unchanged. GitHub import stays a
 * single step (`PublishForm`, embedded here as the second tab) — see its
 * doc comment for why it doesn't join the "Check" step.
 */
export function PublishWizard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("directory");
  const [step, setStep] = useState<Step>(1);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [changelog, setChangelog] = useState("");

  const [checkStatus, setCheckStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [checkError, setCheckError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidateResponse | null>(null);

  const [publishStatus, setPublishStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [publishErrors, setPublishErrors] = useState<string[]>([]);
  const [published, setPublished] = useState<PublishSuccess | null>(null);

  function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setFileNames(Array.from(fileList).map((f) => f.webkitRelativePath || f.name));
  }

  async function goToCheck(e: FormEvent) {
    e.preventDefault();
    const fileList = inputRef.current?.files;
    if (!fileList || fileList.length === 0) {
      setCheckError("Choose a package directory to upload.");
      setCheckStatus("error");
      return;
    }

    setCheckStatus("loading");
    setCheckError(null);

    try {
      const collected: UploadedFile[] = await Promise.all(
        Array.from(fileList).map(async (file) => ({
          path: stripTopDir(file.webkitRelativePath || file.name),
          content: await file.text(),
        }))
      );
      setFiles(collected);

      const res = await fetch("/api/v1/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: collected }),
      });
      const data = (await res.json().catch(() => null)) as ValidateResponse | null;
      if (!res.ok || !data) {
        setCheckError("Could not check this upload. Try again.");
        setCheckStatus("error");
        return;
      }

      setValidation(data);
      setCheckStatus("done");
      setStep(2);
    } catch {
      setCheckError("Network error while checking. Try again.");
      setCheckStatus("error");
    }
  }

  async function handlePublish(e: FormEvent) {
    e.preventDefault();
    setPublishStatus("loading");
    setPublishErrors([]);
    try {
      const result = await submitPublishJson("/api/v1/publish", {
        files,
        ...(changelog.trim() ? { changelog: changelog.trim() } : {}),
      });
      if (result.ok) {
        if (result.data?.url) setPublished(result.data);
        setPublishStatus("success");
      } else {
        setPublishErrors(result.errors);
        setPublishStatus("error");
      }
    } catch {
      setPublishErrors(["Network error while publishing. Try again."]);
      setPublishStatus("error");
    }
  }

  if (publishStatus === "success") {
    return <PublishSuccessBanner published={published} />;
  }

  const dirProps: DirInputProps = { webkitdirectory: "", directory: "" };
  const readmeFile = files.find((f) => f.path.toLowerCase() === "readme.md");
  const blockingIssues = validation?.issues ?? [];
  const canProceedToPublish = checkStatus === "done" && blockingIssues.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-fit rounded-md border border-border p-0.5 text-sm">
        {(
          [
            { id: "directory" as const, label: "Upload a directory" },
            { id: "github" as const, label: "Import from GitHub" },
          ]
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setMode(tab.id);
              setStep(1);
            }}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${
              mode === tab.id ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === "github" ? (
        <PublishForm />
      ) : (
        <>
          <StepIndicator step={step} />

          {step === 1 && (
            <form onSubmit={goToCheck} className="flex flex-col gap-4">
              <div>
                <label htmlFor="oa-publish-files" className="mb-1.5 block text-sm font-medium text-fg">
                  Package directory
                </label>
                <input
                  id="oa-publish-files"
                  ref={inputRef}
                  type="file"
                  multiple
                  onChange={handleFiles}
                  {...dirProps}
                  className="block w-full text-sm text-fg-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg hover:file:border-border-strong"
                />
                <p className="mt-1.5 text-xs text-fg-subtle">
                  Select the folder containing <code className="font-mono">openagent.yaml</code>,{" "}
                  <code className="font-mono">README.md</code>, and your package files.
                </p>
              </div>

              {fileNames.length > 0 && (
                <ul className="max-h-40 overflow-y-auto rounded-md border border-border bg-bg-elevated p-3 text-xs font-mono text-fg-muted">
                  {fileNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              )}

              {checkError && <p className="text-sm text-danger">{checkError}</p>}

              <button
                type="submit"
                disabled={checkStatus === "loading"}
                className="inline-flex w-fit items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {checkStatus === "loading" ? "Checking…" : "Next: Check"}
              </button>
            </form>
          )}

          {step === 2 && validation && (
            <div className="flex flex-col gap-4">
              <ManifestSummaryCard manifest={validation.manifest} />

              {blockingIssues.length > 0 && (
                <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                  <p className="font-medium">Fix these before publishing:</p>
                  <ul className="mt-1 list-disc pl-4">
                    {blockingIssues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              <ReadmeLintReport lint={validation.lint} />

              {readmeFile && (
                <div>
                  <h3 className="mb-2 text-sm font-medium text-fg">README preview</h3>
                  <div className="max-h-96 overflow-y-auto rounded-md border border-border p-4">
                    <Markdown content={readmeFile.content} />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-fg hover:border-border-strong"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!canProceedToPublish}
                  onClick={() => setStep(3)}
                  title={!canProceedToPublish ? "Fix the blocking issues above first" : undefined}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
                >
                  Next: Publish
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <form onSubmit={handlePublish} className="flex flex-col gap-4">
              <ChangelogField value={changelog} onChange={setChangelog} />
              <PublishErrorBanner errors={publishErrors} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={publishStatus === "loading"}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-fg hover:border-border-strong disabled:opacity-60"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={publishStatus === "loading"}
                  className="inline-flex w-fit items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
                >
                  {publishStatus === "loading" ? "Publishing…" : "Publish package"}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 1, label: "Pick files" },
    { id: 2, label: "Check" },
    { id: 3, label: "Publish" },
  ];
  return (
    <ol className="flex items-center gap-2 text-xs text-fg-subtle">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-medium ${
              s.id === step
                ? "border-accent bg-accent text-accent-fg"
                : s.id < step
                  ? "border-accent-border bg-accent-muted text-accent"
                  : "border-border text-fg-subtle"
            }`}
          >
            {s.id}
          </span>
          <span className={s.id === step ? "font-medium text-fg" : ""}>{s.label}</span>
          {i < steps.length - 1 && <span className="text-fg-subtle">→</span>}
        </li>
      ))}
    </ol>
  );
}

function ManifestSummaryCard({ manifest }: { manifest?: Manifest }) {
  if (!manifest) {
    return (
      <div className="rounded-md border border-border bg-bg-elevated p-3 text-sm text-fg-muted">
        openagent.yaml could not be parsed — see the issues below.
      </div>
    );
  }

  const price =
    manifest.pricing.model === "free"
      ? "Free"
      : `${formatPrice(manifest.pricing.amountCents, manifest.pricing.currency)}${
          manifest.pricing.model === "subscription" ? `/${manifest.pricing.interval ?? "month"}` : ""
        }`;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border bg-bg-elevated p-4 text-sm sm:grid-cols-4">
      <SummaryField label="Package">
        <span className="font-mono text-fg">
          {manifest.owner}/{manifest.name}
        </span>
      </SummaryField>
      <SummaryField label="Version">
        <span className="font-mono text-fg">{manifest.version}</span>
      </SummaryField>
      <SummaryField label="Kind">
        <span className="text-fg">{manifest.kind}</span>
      </SummaryField>
      <SummaryField label="Price">
        <span className="text-fg">{price}</span>
      </SummaryField>
    </dl>
  );
}

function SummaryField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
