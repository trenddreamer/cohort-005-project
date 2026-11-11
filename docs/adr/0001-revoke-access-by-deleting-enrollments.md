# Revoke access on refund approval by deleting enrollment rows

When a Refund Request is Approved, we take the learner's access away by deleting their enrollment row(s) for the course, rather than adding a `revokedAt`/status column to `enrollments`. Access everywhere is "an enrollment row exists" (`app/lib/access.server.ts`), and at least five queries read enrollments; a soft-delete column would have to be filtered in every one, and a single missed filter silently gives a refunded learner access back. The history a soft delete would preserve already lives elsewhere: the purchase, and the Approved Refund Request with `resolvedAt`/`resolvedByUserId`. Lesson progress and watch events are keyed by user and lesson, not by enrollment, so they survive, and because purchasing is only blocked by an existing enrollment, the learner can buy the course again and resume.

## Consequences

- `enrollments.enrolledAt` and `completedAt` for a refunded enrollment are lost; anything that needs "when did they first enroll" after a refund must read the purchase instead.
- For a team purchase, the enrollments to delete are found via `coupons.purchaseId` → `redeemedByUserId` + `courseId`; there is no direct link from enrollment to purchase.
