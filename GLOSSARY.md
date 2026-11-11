# Refunds Glossary

The language for a learner getting their money back on a course purchase. Use these terms in code, on screen, and in email.

## Terms

**Refund Request**:
A learner's request, with a reason, to get back the Refundable Amount on a single purchase. It is Open, Approved, or Declined.
_Say_: "refund request"
_In code_: `refunds` row, `RefundStatus`
_Avoid_: Chargeback, Reversal, cancellation, "cancel my purchase"

**Open**:
A Refund Request that nobody has resolved yet. While it is Open, the learner keeps access and the purchase still counts as revenue.
_Say_: "Refund requested" (badge), "Requested {date}"
_In code_: `RefundStatus.Requested` (`"requested"`), `requested_at`; aliases `getOpenRefund`, `getRequestedRefund`, `pendingChargebacks`
_Avoid_: Pending, raised, "waiting on us"

**Approved**:
A Refund Request the team has resolved in favour of the learner, after issuing the Refund by hand outside the app. Approval revokes the learner's enrollment and takes the Refundable Amount off revenue.
_Say_: "Refund approved"
_In code_: `RefundStatus.Approved`, `resolvedAt`, `resolvedByUserId`, `amountRefunded`

**Declined**:
A Refund Request the team has resolved without a Refund. Access and revenue don't change.
_Say_: "Refund declined"
_In code_: `RefundStatus.Declined`

**Refund**:
The money actually going back to the learner's card. It only happens when a Refund Request is Approved, and the team does it by hand.
_Avoid_: Reversal, chargeback

**Refundable Amount**:
The amount the learner actually paid on the purchase. For a team purchase, that is the total for the whole purchase.
_Say_: "the amount you paid"
_In code_: `refundableAmount`, `purchases.amountPaid`
_Avoid_: deriving it from the course's current list price

## Eligibility

A learner can open a Refund Request only if the purchase is inside the Refund Window, under the Watch Limit and under the Completion Limit, has no Claimed Seat, and has no Refund Request already Open.

**Refund Window**:
The 14 calendar days from the day of purchase during which a learner can open a Refund Request.
_In code_: `REFUND_WINDOW_DAYS`; alias `CANCEL_WINDOW_DAYS`
_Avoid_: cancel window

**Watch Limit**:
The 2 hours of watched video at or above which a purchase can no longer be refunded.
_In code_: `MAX_WATCHED_HOURS`; alias `CANCEL_WATCH_LIMIT_SECONDS`

**Completion Limit**:
The 50% of lessons completed at or above which a purchase can no longer be refunded.
_In code_: `CANCEL_COMPLETION_LIMIT`

**Claimed Seat**:
A team seat a member has taken by redeeming its coupon. One Claimed Seat makes the whole team purchase ineligible for a Refund Request.
_Say_: "claimed"
_In code_: `coupons.redeemedAt`, `redeemedByUserId`, `claimedSeat`
_Avoid_: redeemed (in copy)

## Rules

- "Cancel" is only for dismissing UI. It never means asking for a refund. The course-page button reads "Request a refund".
- In copy, "refund" is lowercase mid-sentence, and headings and badges use sentence case.
- Chargeback is reserved for a dispute the cardholder raises through their bank. We don't handle chargebacks today, so the word shouldn't appear anywhere.
