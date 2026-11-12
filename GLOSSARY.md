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
_In code_: `RefundStatus.Requested` (`"requested"`), `requested_at`
_Avoid_: Pending, raised, "waiting on us"

**Resolve**:
To Approve or Decline an Open Refund Request. Only an admin resolves, and they do it on the refund requests screen. A resolved Refund Request is final. It never goes back to Open, and an Approved request never becomes Declined, or the other way round.
_Say_: "resolved by {admin} on {date}"
_In code_: `resolvedAt`, `resolvedByUserId`
_Avoid_: process, handle, close

**Approved**:
A Refund Request an admin has resolved in favour of the learner. Approving records a Refund the admin has already issued by hand outside the app. It never moves money itself. The moment a request is Approved, everyone who got access through the purchase loses it, and the Refundable Amount comes off revenue. For a team purchase, that includes seats claimed while the request was Open, and any unclaimed seats can no longer be claimed. Learners keep their progress, so if they buy the course again they carry on where they left off.
_Say_: "Refund approved", "Mark refund approved"
_In code_: `RefundStatus.Approved`, `resolvedAt`, `resolvedByUserId`, `amountRefunded`

**Declined**:
A Refund Request an admin has resolved without a Refund. Access and revenue don't change.
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

**Amount Refunded**:
The amount recorded against an Approved Refund Request. It is always the full Refundable Amount. There are no partial refunds.
_In code_: `amountRefunded`
_Avoid_: partial refund

## Eligibility

A learner can open a Refund Request only if the purchase is inside the Refund Window, under the Watch Limit and under the Completion Limit, has no Claimed Seat, and has never had a Refund Request. Each purchase gets one Refund Request. Once it is Declined, the learner can't ask again.

**Refund Window**:
The 14 calendar days from the day of purchase during which a learner can open a Refund Request.
_In code_: `REFUND_WINDOW_DAYS`
_Avoid_: cancel window

**Watch Limit**:
The 2 hours of watched video at or above which a purchase can no longer be refunded.
_In code_: `MAX_WATCHED_HOURS`

**Completion Limit**:
The 50% of lessons completed at or above which a purchase can no longer be refunded.
_In code_: `COMPLETION_LIMIT`

**Claimed Seat**:
A team seat a member has taken by redeeming its coupon. One Claimed Seat makes the whole team purchase ineligible for a Refund Request.
_Say_: "claimed"
_In code_: `coupons.redeemedAt`, `redeemedByUserId`, `claimedSeat`
_Avoid_: redeemed (in copy)

## Rules

- "Cancel" is only for dismissing UI. It never means asking for a refund. The course-page button reads "Request a refund".
- In copy, "refund" is lowercase mid-sentence, and headings and badges use sentence case.
- Chargeback is reserved for a dispute the cardholder raises through their bank. We don't handle chargebacks today, so the word shouldn't appear anywhere.
