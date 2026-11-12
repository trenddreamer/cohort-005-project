# Hosted notification vendors for Cadence

Research for issue #11 (map: #10). Collected on **2026-11-12**. Pricing pages carry no effective date, so treat every limit below as "as of 2026-11-12" and check it again before you commit to a vendor.

## Constraints (from #10)

The vendor must be hosted, not self-hosted. Its free tier must cover development and the course, and it must work on localhost. One Cadence user must map to one vendor user ID. It must support all three Channels: Inbox, browser web push and email. Rule from #11: rule out any vendor whose Inbox or web push needs a paid plan.

## Summary table

| | Knock | Novu Cloud | MagicBell | Courier | SuprSend |
|---|---|---|---|---|---|
| Free tier volume | 10,000 messages/mo, counted per channel [K1] | 10,000 workflow runs/mo, **max 5 workflows** [N1] | **1,000 deliveries/mo**, counted per channel [M1] | 10,000 sends/mo, one send covers all channels [C1] | 10,000 notifications/mo [S1] |
| Inbox on free tier | Yes | Yes | Yes | Yes | Yes (SuprSend branding) [S1] |
| React package (2026-11-12) | `@knocklabs/react` 0.15.1, peer React 17/18/19 | `@novu/react` 3.19.2, peer React 18/19 | `@magicbell/react` 1.14.0 | `@trycourier/courier-react` 9.3.5, peer React >=18 | `@suprsend/react` 1.5.0, peer React >=16.8 |
| Styling / own UI | `--rnf-*` CSS variables, replaceable stylesheet, `renderItem` [K2] | `appearance` prop; **elements accept Tailwind classes**; headless hooks [N2][N3] | CSS custom properties and class names; no headless hooks documented [M2] | `CourierInboxTheme`, custom views, low-level APIs [C2] | Drop-in `@suprsend/react`; headless `@suprsend/react-core` [S2] |
| Web push | **No first-party web push.** Through FCM; you write `firebase-messaging-sw.js` [K3] | Through providers (FCM, OneSignal, Pushpad and others); no service worker supplied [N4] | **Native VAPID web push**; you host `/sw.js`, which imports MagicBell's script; `WebPushButton` component [M3][M4] | No dedicated web push docs; through FCM or OneSignal [C3] | **Native VAPID web push**; you host `serviceworker.js`, which imports SuprSend's hosted SDK; `registerPush()` [S3] |
| Email | Yes, through your email provider | Yes | Yes (SES, SendGrid, Mailgun, SMTP and others) [M5] | Yes | Yes, through a downstream provider [S1] |
| Prebuilt preferences UI | **None.** You build it with `@knocklabs/client` [K4]; the preferences API is on free [K1] | `<Preferences />` component [N3] | `UserPreferences` component [M2] | Hosted preference page and preference center [C4] | **Not on free.** Preferences are Business-tier only ($250/mo) [S1] |
| Node server SDK | `@knocklabs/node` 1.41.1 | `@novu/api` 3.19.1 | `magicbell-js` 1.8.0 | `@trycourier/courier` 10.0.0 | `@suprsend/node-sdk` 1.15.1 |
| User auth | Public key, plus an RS256 user-token JWT (`sub` = user id) in Enhanced Security mode, which is optional in dev [K5] | HMAC-SHA256 `subscriberHash` of `subscriberId`, toggled per environment [N5] | HS256 user JWT with `user_external_id` [M6] | JWT minted by your backend; `signIn({ userId, jwt })` [C2] | ES256 user-token JWT (`entity_id` = distinct_id); enforcement is off in Sandbox [S4] |
| Real-time Inbox | Yes (socket) [K2] | Yes (WebSocket, `socketUrl`) [N5] | Yes ("persistent connection") [M5] | Yes [C2] | Yes ("real-time inbox") [S1] |

Every vendor in the table identifies users by an arbitrary external ID that your server signs. So "one Cadence user = one vendor user ID" works with all five, and so does DevUI user switching: mint a new token or hash when the user changes. All five keep signing on the server and call vendor-hosted APIs, so nothing needs a public callback URL. Inbox, email and auth work on localhost. Browser web push works on `http://localhost` because browsers treat localhost as a secure context for service workers (MDN, [Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)).

## Ruled out or downgraded

- **MagicBell: ruled out by the free-tier constraint.** The free Builder plan has 1,000 deliveries a month, and every channel a user receives counts as a separate delivery. One Notification sent to Inbox, push and email therefore uses 3. Going over the limit is billed per delivery, so you cannot stay on the free tier once you exceed it [M1]. That is too tight for a cohort of course users. It is otherwise the best fit technically, with native VAPID push and a preferences component.
- **SuprSend: not ruled out by the #11 rule, but a poor fit.** Its Inbox and web push are free. However, the Inbox carries SuprSend branding on free, and the pricing table shows a dash under Free and Essentials on every preferences row: channel preferences, categories, the preference-centre UI and the hosted page [S1]. The map lists user preferences as a likely need.
- **Knock: allowed, but weakest on web push.** Its docs say "Knock does not have a first-party web push channel." Web push needs a Firebase project and your own FCM service worker [K3]. It also has no prebuilt preferences UI [K4]. Its free tier is otherwise generous: unlimited workflows and 10k messages.
- **Courier: allowed, but web push is poorly documented.** The docs' push providers are FCM and OneSignal, and the push docs have no browser setup guide [C3]. The free tier is the most generous for multi-channel use, because a send covers all Channels [C1].
- **Novu Cloud: allowed.** Its one notable free-tier limit is **5 workflows**, and each kind of Notification is one workflow [N1]. Cadence's list of Notifications (comment reply, refund decided, and so on) will probably exceed 5 unless kinds share a workflow or a Pro plan is bought later. Activity log retention on free is 24 hours. That is the debug log, not the Inbox.

## Recommendation

**Novu Cloud**, with **Courier** as the runner-up.

Novu fits Cadence's stack best:
- React 19 is a declared peer dependency.
- The Inbox `appearance.elements` accepts Tailwind classes directly [N2], and headless hooks let us replace the UI entirely.
- It ships `<Preferences />`.
- Real-time updates use WebSocket.
- Auth is a single server-side HMAC that is easy to recompute when DevUI switches users.
- Email and push are included on free.

The costs:
- Web push goes through FCM, so it needs a free Firebase project and a service worker we write ourselves.
- The 5-workflow cap means the list of Notifications has to fit in 5 workflows during the course, for example one workflow per domain area with the kind in the payload.

If that cap is unacceptable, Courier is the next choice. Its free tier is per send rather than per channel, it has no workflow cap, and it has an Inbox plus a hosted preference page. Its web push story is the weakest documented of the remaining vendors, though.

Before deciding, a short spike should confirm that FCM web push works on `localhost:5173` with the chosen vendor. It should also confirm that the 5-workflow limit fits the list of Notifications.

## Sources

Accessed 2026-11-12. Package versions come from `npm view` on the same date.

- [K1] Knock pricing: https://knock.app/pricing
- [K2] Knock React feed: https://docs.knock.app/in-app-ui/react/feed
- [K3] Knock, "Sending web push notifications with FCM": https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm. Push providers: https://docs.knock.app/integrations/push/overview
- [K4] Knock preferences in React: https://docs.knock.app/in-app-ui/react/preferences
- [K5] Knock security and authentication: https://docs.knock.app/in-app-ui/security-and-authentication
- [N1] Novu pricing: https://novu.co/pricing
- [N2] Novu Inbox styling: https://docs.novu.co/platform/inbox/configuration/styling
- [N3] Novu Inbox overview: https://docs.novu.co/platform/inbox/overview
- [N4] Novu push integrations: https://docs.novu.co/platform/integrations/push
- [N5] Novu, prepare Inbox for production (HMAC, `socketUrl`): https://docs.novu.co/platform/inbox/prepare-for-production
- [M1] MagicBell pricing and delivery-count FAQ: https://www.magicbell.com/pricing
- [M2] MagicBell React components: https://www.magicbell.com/docs/libraries/magicbell-react
- [M3] MagicBell web push channel: https://www.magicbell.com/docs/channels/web_push
- [M4] MagicBell web push setup (`/sw.js`, `WebPushButton`): https://www.magicbell.com/blog/using-push-notifications-in-pwas
- [M5] MagicBell in-app and email channels: https://www.magicbell.com/docs/channels/in_app, https://www.magicbell.com/docs
- [M6] MagicBell user JWT: https://www.magicbell.com/docs/api/authentication/user
- [C1] Courier pricing: https://www.courier.com/pricing
- [C2] Courier Inbox overview: https://www.courier.com/docs/platform/inbox/inbox-overview
- [C3] Courier push overview: https://www.courier.com/docs/external-integrations/push/intro-to-push. FCM: https://www.courier.com/docs/external-integrations/push/firebase-fcm
- [C4] Courier preferences overview: https://www.courier.com/docs/platform/preferences/preferences-overview
- [S1] SuprSend pricing and feature table: https://www.suprsend.com/pricing
- [S2] SuprSend React integration: https://docs.suprsend.com/docs/react-inbox-integration
- [S3] SuprSend React web push: https://docs.suprsend.com/docs/react-webpush
- [S4] SuprSend client authentication: https://docs.suprsend.com/docs/client-authentication

## Caveats

- MagicBell's React docs and FAQ disagree on whether you write the service worker yourself or the SDK registers it [M4].
- The Courier push overview lists FCM as covering Android, iOS and web, but neither page gives browser setup steps. A Courier guide routes browser push through OneSignal instead [C3].
- None of the vendors states plan gating for the web push channel itself. All the free tiers say "all channels", "unlimited channels" or "all integrations".
