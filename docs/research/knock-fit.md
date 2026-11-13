# Is Knock a good fit for Cadence?

Research for issue #18 (map: #10). It builds on [notification-vendors.md](https://github.com/trenddreamer/cohort-005-project/blob/research/notification-vendors/docs/research/notification-vendors.md) (#11) and assumes the #15 decision: v1 ships **Inbox plus email**, and web push comes later. Collected on **2026-11-13**. Pricing pages carry no effective date, so check the limits again before you commit.

Knock's own product names (`in_app_feed`, `NotificationFeed`) appear in code style below. In Cadence code and copy, use the glossary term **Inbox**.

## Verdict

**Yes, Knock is a good fit for v1, and for Cadence it is slightly better than Novu Cloud.** It meets every hard constraint in #10. Its free tier has no workflow cap, which removes the main problem with Novu (5 workflows). It has 30-day logs instead of 24 hours, and the React package declares React 19 support.

The catches are build effort, not blockers:

- There is no prebuilt preferences UI.
- Styling uses CSS variables or headless hooks, not Tailwind classes on the components.
- Each Notification uses **2 messages** (Inbox plus email), so the free tier covers about 5,000 Notifications a month.
- Real email needs a separate provider such as Resend, with a verified domain.
- Web push later needs Firebase (FCM) and a service worker that we write.
- The jump from free to paid is steep: $250/month.

If an out-of-the-box Inbox styled with Tailwind and a ready-made `<Preferences />` matter more than having more than 5 workflows, Novu is still the better choice. See [Knock vs Novu Cloud](#knock-vs-novu-cloud-for-cadence).

## Cadence's stack (from `package.json`)

- React `^19.2.7`. **React Router 8.3.0** (framework mode, `react-router dev`), not 7 as the ticket says.
- Tailwind CSS 4 (`@tailwindcss/vite`), shadcn and Radix UI, and `lucide-react ^0.563.0`.
- Vitest 5 (`npm run test` = `vitest run`).
- DevUI (`app/components/dev-ui.tsx`) switches the session user through a `<Form>` post. The user's ID is a numeric `id`.

## Hard constraints

| Constraint | Knock | Source |
|---|---|---|
| Hosted | Yes, SaaS only | [K1] |
| Free tier only | Free plan: 10,000 messages/month, unlimited workflows, no hard cap | [K1] |
| Works on localhost | Yes. The client uses a public key and a Knock-hosted socket, and token signing is local. No callback URL is needed for Inbox or email. Delivery-tracking webhooks are optional [K7] | [K3][K5] |
| One Cadence user = one Knock user | Recipient ID is "a string from your system that uniquely represents the recipient", so `String(user.id)` works | [K9] |
| Inbox, web push, email | Inbox: yes. Email: yes, through a provider. Web push: only through FCM ("Knock does not have a first-party web push channel") | [K2][K6][K10] |

## Answers to the ticket's questions

### Free tier

- **Counting.** A message is "a single message delivered to a single user on a single channel". Knock's own FAQ example says a workflow that sends an in-app message and an email counts as **two** [K1]. So one Cadence Notification on Inbox plus email uses **2 messages**. That gives about **5,000 Notifications a month**, which is plenty for development and a course cohort. Bounced or failed messages, and messages blocked by preferences, are not counted [K1].
- **Overage.** "We don't hard cap your messages." Knock contacts you about adding billing for the next month [K1]. There is no sudden cutoff.
- **Workflows.** Unlimited workflows and triggers [K1], so we can use one workflow per kind of Notification (comment reply, refund decided, and so on).
- **Environments.** Unlimited environments. Development and production are isolated, each with its own keys, users and logs. Workflows are committed in development and promoted to production [K1][K8].
- **Branding.** "Remove Knock branding" is **No** on free [K1]. The pricing page doesn't say exactly where the branding appears. A headless Inbox (see below) renders none of Knock's UI.
- **Retention.** Logs are kept 30 days. Inbox (`in_app_feed`) retention is "Unlimited" and configurable [K1].
- **Other.** Unlimited team members. Preferences for channels, workflows and categories are included on free. Per-tenant preferences are not [K1].
- **Next plan.** Starter is **$250/month** for 50,000 messages [K1]. Novu's next plan is $30 [N1].

### Email

Knock does not send real email itself. It delivers "to downstream providers": SES, Resend, SendGrid, Postmark, Mailgun, SMTP and others [K6].

- **Built-in "Knock (testing only)" provider.** It is enabled in every environment for new accounts. It allows **100 emails a month** and only to **members of the Knock account**. Other recipients get `knock_recipient_not_allowed`. It is not for production [K7]. That is enough to see an email from a DevUI user whose seeded email is our own address. It cannot reach seeded users with made-up addresses.
- **Real provider.** Resend needs an API key, a From address and a **verified sending domain** [K11]. Its free plan allows 3,000 emails a month and 100 a day [R1]. Sending works from localhost because Knock calls Resend from Knock's servers. Delivery tracking needs a Resend webhook pointing at Knock, which is optional [K11].
- **Sandbox mode.** This is a per-environment channel setting. Messages are generated and previewable but are not sent to the provider [K7][K12]. It is useful in development, where seeded users have fake addresses.

### Inbox UI with Cadence's stack

- `@knocklabs/react` 0.15.1 declares peer `react ^17 || ^18 || ^19`. `next` and `@tanstack/react-router` are **optional** peers, and React Router is not a dependency at all [npm]. So React Router 8 is neither required nor in conflict.
- Prebuilt pieces: `KnockProvider` (`apiKey`, `user={{ id }}`, `userToken`), `KnockFeedProvider` (`feedId`), `NotificationIconButton`, `NotificationFeedPopover` and `NotificationFeed`. The Inbox updates in real time over a socket [K2].
- **Customization.** `renderItem` replaces a whole row and `renderHeader` the header. `--rnf-*` CSS variables restyle the components, and you can drop Knock's stylesheet entirely [K2]. There is **no Tailwind-class prop** like Novu's `appearance.elements`. To use Tailwind and shadcn, either map `--rnf-*` to our theme tokens or go **headless**: `useKnockClient`, `useNotifications(client, feedId)` and `useNotificationStore(feed)` return `items` and `unread_count`/`unseen_count`, and we render shadcn components [K3]. With headless hooks we must call `markAsSeen`/`markAllAsSeen` ourselves, or the badge never clears [K3].
- **Dependency weight.** `@knocklabs/react` brings in Knock's Telegraph UI kit, Radix dialog and hover-card, `@popperjs/core`, and its own `lucide-react ^0.544.0` (Cadence uses `^0.563.0`, so npm installs a second copy) [npm]. The headless route could use the smaller `@knocklabs/react-core` 0.17.1 (swr, date-fns, `@knocklabs/client`) [npm].
- **SSR.** The docs say nothing about server rendering. Cadence renders on the server, so the spike should check whether the provider needs to be client-only.

### Auth and DevUI switching

- The browser uses the **public key**. Without enhanced security mode, "a request with your public key can act as any user". The mode is off by default and should be on in production. Development can stay off [K5].
- With enhanced security mode on, the server signs an **RS256 JWT** (`sub` = user ID) using the environment's signing key: `signUserToken(userId, { expiresInSeconds })` from `@knocklabs/node`. Signing is local, with no network call. The default expiry is 1 hour, and `onUserTokenExpiring` lets the client refresh [K5].
- **DevUI.** The root loader already knows the current user. It can return `knockUserId = String(user.id)` and, when needed, a signed token. When DevUI switches user, the loader runs again. Re-render `KnockProvider` with the new `user`/`userToken`, or remount it with `key={userId}`. Re-calling `authenticate` "restarts" the real-time connection [K5]. This is the same shape as Novu's HMAC hash.
- **Identifying users.** Users can be identified inline in the trigger call, with `id`, `email` and `name` [K9]. A separate sync step is not required.

### Preferences

- The **API is on free**: channel types (`email`, `in_app_feed`), per-workflow and per-category settings, plus environment-level defaults that merge with the user's changes [K1][K4].
- **No prebuilt component.** The docs build a `PreferenceCenter` by hand with `knockClient.user.getPreferences()` and `setPreferences()` [K4]. For Cadence this is a small shadcn settings form with a switch for each kind of Notification × Channel, and the Inbox always on. It is extra work that Novu's `<Preferences />` saves.

### Testing (keeping Knock out of `npm run test`)

Knock's docs offer no test mode for SDK calls. They offer channel **sandbox mode** and separate environments [K12]. The project-side approach:

- Put all server calls (trigger and identify) behind one small Cadence `notify` module. Vitest tests swap in a fake that records triggers. Tests then check "refund decided ⇒ Notification of kind X to user Y" without network access.
- Never set `KNOCK_API_KEY` in the test environment, and make the real adapter throw if it is used in tests.
- Inbox components: test our own rendering with fixed items. If we go headless, render from plain data, not the hooks.
- Manual development: use the Knock development environment, with sandbox mode on the email channel or the test-only email provider.

The same applies to Novu. This is not a point of difference.

### Web push later (FCM)

Knock's FCM tutorial [K10] requires:

- a Firebase project with a web app, a VAPID key and a service account;
- an FCM channel in Knock;
- the `firebase` client package;
- our own `public/firebase-messaging-sw.js`;
- a provider that asks permission, calls `getToken`, and stores the token with `knock.user.setChannelData(channelId, { tokens: [token] })`;
- on logout or a DevUI switch, clearing the channel data (`{ tokens: [] }`).

Rough effort is a day or two, about the same as Novu, which also routes through FCM [N4]. It counts as a third message per Notification for users who opt in [K1].

## Knock vs Novu Cloud for Cadence

| | Knock (free) | Novu Cloud (free) |
|---|---|---|
| Volume | 10,000 messages/mo, **per channel**. Inbox + email = 2 per Notification, so about 5,000 Notifications [K1] | 10,000 workflow runs/mo [N1]. One run covers both Channels per #11, but the pricing page doesn't define a run |
| Workflows | **Unlimited** [K1] | **5** (Pro raises it to 20) [N1] |
| Over the limit | No hard cap; Knock asks for billing next month [K1] | Not stated on the pricing page |
| Log retention | **30 days** [K1] | 24 hours [N1] |
| Environments / seats | Unlimited / unlimited [K1] | 2 (Dev + Prod) / 3 members [N1] |
| Branding | Knock branding stays on free [K1] | Novu branding stays on free [N1] |
| Next plan | $250/mo [K1] | $30/mo [N1] |
| React 19 | Yes (peer 17–19) [npm] | Yes (peer 18–19) [npm] |
| Tailwind styling | `--rnf-*` CSS variables or headless hooks [K2][K3] | `appearance.elements` accepts Tailwind classes; headless hooks [N2] |
| Preferences UI | **Build it yourself** (API on free) [K4] | `<Preferences />` component [N3] |
| Test email | Built-in, 100/mo, Knock account members only [K7] | Demo provider, 300/mo, your own login address only [N5] |
| Real email | Your provider (e.g. Resend) [K6] | Your provider [N3] |
| Auth | RS256 user token, optional in dev [K5] | HMAC `subscriberHash` [N3] |
| Web push | FCM only, your own service worker [K10] | FCM and other providers, your own service worker [N4] |

**For Cadence specifically.** Cadence will have several kinds of Notification: refund requested, refund decided, comment reply, and more. Under Novu's 5-workflow cap we would have to merge kinds into shared workflows with a "kind" field in the payload. That spoils per-kind preferences, because Novu preferences are set per workflow, and it complicates templates. Knock has no cap, so each kind can have its own workflow, and its preferences map straight onto "kind × Channel".

Knock's costs are one-off build work: a preferences form, and a themed or headless Inbox in shadcn. Novu's cap is a lasting design constraint. Knock's longer logs and no hard cap also make development and debugging easier.

Novu wins if the team wants the least UI work, since it has Tailwind classes on a prebuilt Inbox and a prebuilt `<Preferences />`, or if a cheap paid tier ever matters ($30 vs $250).

**Recommendation:** choose **Knock** for v1, with headless or CSS-variable Inbox styling and a small preferences form. First run a short spike on `localhost:5173`:

1. Render the Inbox on React Router 8 with SSR.
2. Switch users in DevUI and check the Inbox follows.
3. Trigger one workflow with Inbox and email steps, and check that it uses 2 messages in Knock's usage view.

## Sources

Accessed 2026-11-13. Package data comes from `npm view` on the same date.

- [K1] Knock pricing and FAQ: https://knock.app/pricing
- [K2] Knock React Inbox (feed) components: https://docs.knock.app/in-app-ui/react/feed
- [K3] Knock headless feed hooks: https://docs.knock.app/in-app-ui/react/headless/feed
- [K4] Knock preferences in React: https://docs.knock.app/in-app-ui/react/preferences
- [K5] Knock security and authentication: https://docs.knock.app/in-app-ui/security-and-authentication
- [K6] Knock email overview and providers: https://docs.knock.app/integrations/email/overview
- [K7] Knock built-in test email channel: https://docs.knock.app/integrations/email/knock-test
- [K8] Knock environments: https://docs.knock.app/concepts/environments
- [K9] Knock recipients (inline identification, IDs): https://docs.knock.app/concepts/recipients
- [K10] Knock, sending web push with FCM: https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm
- [K11] Knock + Resend: https://docs.knock.app/integrations/email/resend
- [K12] Knock implementation guide (sandbox mode): https://docs.knock.app/tutorials/implementation-guide
- [R1] Resend pricing: https://resend.com/pricing
- [N1] Novu pricing: https://novu.co/pricing
- [N2] Novu Inbox styling: https://docs.novu.co/platform/inbox/configuration/styling
- [N3] Novu Inbox overview and production prep: https://docs.novu.co/platform/inbox/overview, https://docs.novu.co/platform/inbox/prepare-for-production
- [N4] Novu push integrations: https://docs.novu.co/platform/integrations/push
- [N5] Novu demo providers: https://docs.novu.co/platform/integrations/demo-providers
- [npm] `@knocklabs/react` 0.15.1, `@knocklabs/react-core` 0.17.1, `@knocklabs/client` 0.23.1, `@knocklabs/node` 1.41.1, `@novu/react` 3.19.2

## Caveats

- Knock's pricing page doesn't say where "Knock branding" appears on free (Inbox components, emails, or both).
- Knock's docs don't say whether the prebuilt React components support SSR. Check this in the spike.
- Novu's pricing page doesn't define a "workflow run". The claim that one run covers all Channels comes from #11.
- The Novu demo-provider limit (300/mo) comes from a docs page that may be old.
