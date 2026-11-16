import { useRef, useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/settings";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  UserRole,
  RefundStatus,
  users,
  courses,
  purchases,
  refunds,
} from "~/db/schema";
import { AlertTriangle } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";
import { db } from "~/db";
import { and, eq } from "drizzle-orm";
import { formatPrice } from "~/lib/utils";
import { Switch } from "radix-ui";
import { getNotifier } from "~/lib/notifier.server";
import {
  loadSwitches,
  preferenceKindsFor,
  savePreference,
  type PreferenceKind,
  type PreferenceSwitch,
} from "~/lib/notification-preferences";
import { getPreferenceAudience } from "~/lib/notification-preferences.server";

const actionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("profile"),
    name: z.string().trim().min(1, "Name cannot be empty."),
    bio: z.string().trim().optional(),
  }),
  z.object({
    intent: z.literal("preference"),
    kind: z.string(),
    enabled: z.enum(["true", "false"]),
  }),
]);

const KIND_LABELS: Record<PreferenceKind, string> = {
  "comment-reply": "Replies to your comments",
  "refund-request-approved": "Refund request approved",
  "refund-request-declined": "Refund request declined",
  "lesson-comment": "New comments on your lessons",
  "new-enrollment": "New enrollments",
  "open-refund-request": "Open refund requests",
  "seat-claimed": "Seats claimed on your team",
};

export function meta() {
  return [
    { title: "Settings — Cadence" },
    { name: "description", content: "Edit your profile details" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to edit your details.", {
      status: 401,
    });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser) {
    throw data("User not found.", { status: 404 });
  }

  const openRefundRequests = db
    .select({
      id: refunds.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      amountPaid: purchases.amountPaid,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(
      and(
        eq(purchases.userId, currentUserId),
        eq(refunds.status, RefundStatus.Requested)
      )
    )
    .all();

  const audience = getPreferenceAudience(db, currentUser);
  let switches: PreferenceSwitch[];
  try {
    switches = await loadSwitches(getNotifier(), currentUser.id, audience);
  } catch (error) {
    // The page must render even if Knock is down: show the defaults.
    console.error("[settings] could not read Notification preferences", error);
    switches = preferenceKindsFor(audience).map((kind) => ({
      kind,
      enabled: true,
    }));
  }

  return {
    switches,
    user: {
      id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
      bio: currentUser.bio,
      role: currentUser.role,
    },
    openRefundRequests,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();
  if (!currentUser) {
    throw data("User not found.", { status: 404 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, actionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  if (parsed.data.intent === "preference") {
    const audience = getPreferenceAudience(db, currentUser);
    const allowed = preferenceKindsFor(audience);
    const { kind, enabled } = parsed.data;
    if (!allowed.some((allowedKind) => allowedKind === kind)) {
      return data(
        { errors: { kind: "That switch isn't available." } },
        { status: 400 }
      );
    }
    try {
      await savePreference(
        getNotifier(),
        currentUser.id,
        kind,
        enabled === "true"
      );
    } catch (error) {
      console.error(
        "[settings] could not save a Notification preference",
        error
      );
      return data(
        { errors: { kind: "Couldn't save that. Try again." } },
        { status: 502 }
      );
    }
    return { preferenceSaved: true };
  }

  const { name, bio } = parsed.data;

  db.update(users)
    .set({ name, email: currentUser.email, bio: bio || null })
    .where(eq(users.id, currentUser.id))
    .returning()
    .get();
  return { success: true };
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { user, openRefundRequests, switches } = loaderData;
  const fetcher = useFetcher();
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success("Profile updated successfully.");
    }
    if (fetcher.state === "idle" && fetcher.data?.errors) {
      const firstError = Object.values(fetcher.data.errors)[0] as
        string | undefined;
      if (firstError) toast.error(firstError);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Settings</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Update your profile details
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <h2 className="text-lg font-semibold">Profile</h2>
        </CardHeader>
        <CardContent>
          <fetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="profile" />
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                ref={nameInputRef}
                id="name"
                name="name"
                type="text"
                defaultValue={user.name}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={user.email}
                disabled
                className="text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed.
              </p>
            </div>
            {user.role === UserRole.Instructor && (
              <div className="space-y-2">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  name="bio"
                  rows={4}
                  defaultValue={user.bio ?? ""}
                  placeholder="Tell students about yourself..."
                />
                <p className="text-xs text-muted-foreground">
                  Your bio is shown on your course pages.
                </p>
              </div>
            )}
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? "Saving..." : "Save Changes"}
            </Button>
          </fetcher.Form>
        </CardContent>
      </Card>

      <Card className="mt-8 max-w-md">
        <CardHeader>
          <h2 className="text-lg font-semibold">Notifications</h2>
          <p className="text-sm text-muted-foreground">
            Choose which Notifications reach your Inbox.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {switches.map((preference) => (
            <NotificationSwitch key={preference.kind} preference={preference} />
          ))}
        </CardContent>
      </Card>

      {openRefundRequests.length > 0 && (
        <Card className="mt-8 max-w-md">
          <CardHeader>
            <h2 className="text-lg font-semibold">Refund requests</h2>
            <p className="text-sm text-muted-foreground">
              {openRefundRequests.length === 1
                ? "You have one refund request that hasn't been resolved yet."
                : `You have ${openRefundRequests.length} refund requests that haven't been resolved yet.`}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {openRefundRequests.map((refundRequest) => (
              <div key={refundRequest.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    to={`/courses/${refundRequest.courseSlug}`}
                    className="font-medium hover:underline"
                  >
                    {refundRequest.courseTitle}
                  </Link>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                    Refund requested
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatPrice(refundRequest.amountPaid)} · Requested{" "}
                  {new Date(refundRequest.requestedAt).toLocaleDateString()}
                </p>
                <p className="mt-2 text-sm">{refundRequest.reason}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** One switch. Flipping it saves straight away, with its own fetcher so the
 * profile form's "Profile updated" toast is not triggered. */
function NotificationSwitch({ preference }: { preference: PreferenceSwitch }) {
  const fetcher = useFetcher<typeof action>();
  const label = KIND_LABELS[preference.kind];
  const id = `notification-${preference.kind}`;

  // While saving, show the value being saved.
  const submitted = fetcher.formData?.get("enabled");
  const checked =
    submitted === undefined || submitted === null
      ? preference.enabled
      : submitted === "true";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && "errors" in fetcher.data) {
      toast.error(Object.values(fetcher.data.errors)[0]);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id}>{label}</Label>
      <Switch.Root
        id={id}
        checked={checked}
        onCheckedChange={(next) =>
          fetcher.submit(
            {
              intent: "preference",
              kind: preference.kind,
              enabled: String(next),
            },
            { method: "post" }
          )
        }
        className="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors data-[state=checked]:bg-primary"
      >
        <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-background transition-transform data-[state=checked]:translate-x-[18px]" />
      </Switch.Root>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 404) {
      title = "User not found";
      message = typeof error.data === "string" ? error.data : "User not found.";
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
