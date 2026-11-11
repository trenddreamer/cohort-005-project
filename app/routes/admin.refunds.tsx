import { useEffect } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { eq } from "drizzle-orm";
import { toast } from "sonner";
import { z } from "zod";
import { AlertTriangle, ReceiptText } from "lucide-react";
import type { Route } from "./+types/admin.refunds";
import { db } from "~/db";
import { RefundStatus, UserRole, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import {
  declineRefundRequest,
  listRefundRequests,
  type RefundRequestListItem,
  type ResolveRefundRequestResult,
} from "~/lib/refunds.server";
import { parseFormData } from "~/lib/validation";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { cn, formatPrice } from "~/lib/utils";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";

export function meta() {
  return [
    { title: "Refund requests — Cadence" },
    { name: "description", content: "Open refund requests" },
  ];
}

// Throws 401/403 unless the current user is an admin; returns their id.
async function requireAdminUserId(request: Request): Promise<number> {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view refund requests.", {
      status: 401,
    });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can access this page.", { status: 403 });
  }

  return currentUser.id;
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminUserId(request);
  return { refundRequests: listRefundRequests(db, RefundStatus.Requested) };
}

// Each intent resolves one Refund Request. Approve (#7) adds an `approve`
// member here and a branch below.
const resolveActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("decline"),
    refundRequestId: z.coerce.number().int(),
  }),
]);

type ResolveIntent = z.infer<typeof resolveActionSchema>["intent"];

function resolve(
  intent: ResolveIntent,
  refundRequestId: number,
  adminUserId: number,
  now: Date
): ResolveRefundRequestResult {
  switch (intent) {
    case "decline":
      return declineRefundRequest(db, refundRequestId, adminUserId, now);
  }
}

const ALREADY_RESOLVED_MESSAGE = "This refund request was already resolved";

const RESOLVED_MESSAGES: Record<ResolveIntent, string> = {
  decline: "Refund declined.",
};

export async function action({ request }: Route.ActionArgs) {
  const adminUserId = await requireAdminUserId(request);

  const parsed = parseFormData(await request.formData(), resolveActionSchema);
  if (!parsed.success) {
    throw data("Invalid refund request action.", { status: 400 });
  }

  const { intent, refundRequestId } = parsed.data;
  const result = resolve(intent, refundRequestId, adminUserId, new Date());
  if (result.ok) return { resolved: intent };

  switch (result.error) {
    case "not-an-admin":
      throw data("Only admins can resolve refund requests.", { status: 403 });
    case "not-found":
      throw data("Refund request not found.", { status: 404 });
    case "already-resolved":
      // Another admin got there first. Returned (not thrown) so the screen
      // stays up and shows a toast, and with a 2xx so the loader revalidates
      // and the resolved row leaves the Open list.
      return { error: ALREADY_RESOLVED_MESSAGE };
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatWatchedHours(seconds: number) {
  return `${(seconds / 3600).toFixed(1)} h`;
}

// Floor so a learner just under the Completion Limit never reads as 50%.
function formatCompletion(fraction: number) {
  return `${Math.floor(fraction * 100)}%`;
}

const headerCellClass =
  "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground";

const columns = [
  "Learner",
  "Course",
  "Requested",
  "Reason",
  "Refundable amount",
  "Watched",
  "Completion",
  "Actions",
];

function TableHead() {
  return (
    <thead>
      <tr className="border-b border-border bg-muted/50">
        {columns.map((column) => (
          <th key={column} className={headerCellClass}>
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function UsageCell({
  value,
  isOverLimit,
  limitName,
}: {
  value: string;
  isOverLimit: boolean;
  limitName: string;
}) {
  return (
    <td className="px-4 py-3 text-sm whitespace-nowrap">
      <span
        className={cn(
          "inline-flex items-center gap-1",
          isOverLimit && "font-medium text-amber-600 dark:text-amber-400"
        )}
        title={isOverLimit ? `At or over the ${limitName}` : undefined}
      >
        {isOverLimit && <AlertTriangle className="size-3.5" />}
        {value}
      </span>
    </td>
  );
}

function ResolveActions({ request }: { request: RefundRequestListItem }) {
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if ("error" in fetcher.data) toast.error(fetcher.data.error);
    else toast.success(RESOLVED_MESSAGES[fetcher.data.resolved]);
  }, [fetcher.state, fetcher.data]);

  // A resolved request is final, so it gets no buttons.
  if (request.status !== RefundStatus.Requested) return null;

  function submit(intent: ResolveIntent) {
    fetcher.submit(
      { intent, refundRequestId: String(request.id) },
      { method: "post" }
    );
  }

  return (
    <ConfirmDialog
      trigger={
        <Button
          variant="outline"
          size="sm"
          disabled={fetcher.state !== "idle"}
        >
          Decline
        </Button>
      }
      title="Decline this refund request?"
      description={
        <>
          <p>
            {request.learner.name} keeps access to {request.course.title} and
            no refund is recorded.
          </p>
          <p>A resolved refund request is final.</p>
        </>
      }
      confirmLabel="Decline"
      confirmVariant="destructive"
      onConfirm={() => submit("decline")}
    />
  );
}

function RefundRequestRow({ request }: { request: RefundRequestListItem }) {
  return (
    <tr className="border-b border-border last:border-0 align-top">
      <td className="px-4 py-3">
        <div className="text-sm font-medium">{request.learner.name}</div>
        <div className="text-xs text-muted-foreground">
          {request.learner.email}
        </div>
      </td>
      <td className="px-4 py-3 text-sm">{request.course.title}</td>
      <td className="px-4 py-3 text-sm whitespace-nowrap text-muted-foreground">
        {formatDate(request.requestedAt)}
      </td>
      <td className="max-w-xs px-4 py-3 text-sm whitespace-pre-wrap">
        {request.reason}
      </td>
      <td className="px-4 py-3 text-sm whitespace-nowrap">
        {formatPrice(request.refundableAmount)}
      </td>
      <UsageCell
        value={formatWatchedHours(request.watchedSeconds)}
        isOverLimit={request.isOverWatchLimit}
        limitName="Watch Limit"
      />
      <UsageCell
        value={formatCompletion(request.completionFraction)}
        isOverLimit={request.isOverCompletionLimit}
        limitName="Completion Limit"
      />
      <td className="px-4 py-3 text-right whitespace-nowrap">
        <ResolveActions request={request} />
      </td>
    </tr>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-2 h-5 w-80" />
      </div>
      <Skeleton className="mb-4 h-5 w-40" />
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <TableHead />
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {columns.map((column) => (
                      <td key={column} className="px-4 py-3">
                        <Skeleton className="h-4 w-20" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { refundRequests } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund requests</h1>
        <p className="mt-1 text-muted-foreground">
          Open refund requests, oldest first. Watched time and completion are
          the learner's progress now.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <ReceiptText className="size-4" />
        <span>
          {refundRequests.length} open{" "}
          {refundRequests.length === 1 ? "refund request" : "refund requests"}
        </span>
      </div>

      {refundRequests.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <ReceiptText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">No open refund requests.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <TableHead />
                <tbody>
                  {refundRequests.map((request) => (
                    <RefundRequestRow key={request.id} request={request} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refund requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only admins can access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
