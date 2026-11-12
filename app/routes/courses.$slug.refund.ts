import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, refunds, users, RefundStatus } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import {
  canOpenRefundRequest,
  getLatestPurchase,
  REFUND_WINDOW_DAYS,
  type RefundIneligibleReason,
} from "~/lib/refunds.server";

const refundParamsSchema = z.object({
  slug: z.string().min(1),
});

const refundActionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

const ineligibleResponses: Record<
  RefundIneligibleReason,
  { message: string; status: number }
> = {
  // Each purchase gets one Refund Request, whatever became of it.
  "refund-request-exists": {
    message: "You have already made a refund request on this purchase.",
    status: 409,
  },
  // A seat that came out of a team licence, and has been claimed, belongs to
  // the team — the learner cannot hand it back on their own.
  "claimed-seat": {
    message: "A team purchase with a claimed seat can't be refunded.",
    status: 403,
  },
  "outside-refund-window": {
    message: `The ${REFUND_WINDOW_DAYS}-day refund window has closed.`,
    status: 403,
  },
  "completion-limit-reached": {
    message: "You have completed too much of this course to request a refund.",
    status: 403,
  },
  "watch-limit-reached": {
    message: "You have watched too much of this course to request a refund.",
    status: 403,
  },
};

function getCourseBySlug(slug: string) {
  return db.select().from(courses).where(eq(courses.slug, slug)).get();
}

/**
 * The confirmation the learner gets in their inbox. There is no mail
 * transport wired up yet, so the built message goes to the server log.
 */
function buildRefundRequestEmail(input: {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  amount: number;
}) {
  return {
    to: input.learnerEmail,
    subject: `Refund requested — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      `We have your refund request for "${input.courseTitle}".`,
      `If it is approved, we will refund ${formatPrice(input.amount)}, the amount you paid.`,
      "",
      "Our team reviews every refund request by hand. You do not need to do anything else — we will email you again when it is done.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in to request a refund.", { status: 401 });
  }

  const { slug } = parseParams(params, refundParamsSchema);
  const course = getCourseBySlug(slug);

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const learner = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!learner) {
    throw data("User not found", { status: 404 });
  }

  const purchase = getLatestPurchase(db, currentUserId, course.id);

  if (!purchase) {
    throw data("You have not bought this course.", { status: 403 });
  }

  const eligibility = canOpenRefundRequest(db, purchase, learner, new Date());

  if (!eligibility.eligible) {
    const { message, status } = ineligibleResponses[eligibility.reason];
    throw data(message, { status });
  }

  // The Refundable Amount is what the learner paid, never the course's
  // current list price.
  const refundableAmount = purchase.amountPaid;

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundActionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  db
    .insert(refunds)
    .values({
      purchaseId: purchase.id,
      status: RefundStatus.Requested,
      reason: parsed.data.reason,
    })
    .returning()
    .get();

  const email = buildRefundRequestEmail({
    learnerName: learner.name,
    learnerEmail: learner.email,
    courseTitle: course.title,
    amount: refundableAmount,
  });

  console.log(
    `[email] to=${email.to} subject=${email.subject}\n${email.body}`
  );

  return redirect("/settings");
}
