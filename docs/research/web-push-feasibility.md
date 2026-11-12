# Web push feasibility for Cadence, and email as the fallback Channel

- **Date:** 2026-11-12
- **Question:** How feasible is browser web push as a Channel for Cadence (React Router / React 19 / Vite, no mobile app), and is email the safer fallback?
- **Issue:** [#12](https://github.com/trenddreamer/cohort-005-project/issues/12)
- **Context:** Every Notification lands in the in-app Inbox. Web push and/or email are extra Channels, delivered through a hosted vendor on a free tier (Knock, Novu, MagicBell, Courier or SuprSend). The vendor must work on localhost and map one Cadence user to one vendor user ID. Developers switch users in one browser through the DevUI panel.

Sources are primary (specs, browser vendor docs, mailbox provider docs, each notification vendor's own docs). Each claim links to its source. Anything not verified is marked **Unverified**.

## TL;DR

- **Desktop and Android web push works today** in Chrome 42+, Edge 17+, Firefox 44+ and Safari 16.x on macOS 13+. MDN lists the Push API as Baseline "widely available" since March 2023. No install is needed on these platforms. ([web.dev](https://web.dev/blog/push-notifications-in-all-modern-browsers), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Push_API))
- **iPhone and iPad are the weak spot.** Push works only for web apps added to the Home Screen (iOS/iPadOS 16.4+, February 2023), and the permission request needs a user gesture. Since iOS 26 (announced June 2025), any site added to the Home Screen opens as a web app by default. Adding it is still a manual step most learners will never take. ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [WebKit](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/))
- **What Cadence must add:** a service worker at `public/sw.js` (served from `/`, so its scope covers the whole app), a web app manifest (needed for iOS), a VAPID key pair (public key in the client, private key on the server or held by the vendor), and server-side storage of PushSubscriptions per user and per device. Dead subscriptions must be pruned on 404/410 responses, and subscriptions must be detached on logout or user switch. ([Vite](https://vite.dev/guide/assets), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register), [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292), [web.dev](https://web.dev/articles/push-notifications-web-push-protocol))
- **Localhost works.** `http://localhost` is a secure context. LAN IPs over plain HTTP are not secure contexts. Testing on an iPhone needs an HTTPS origin (for example a tunnel) plus Add to Home Screen. ([MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts))
- **Permission prompts are a one-shot resource.** Ask only after a user gesture, and use a soft ask first. A "denied" answer can't be re-prompted. Chrome also quiets prompts on sites with low accept rates and auto-revokes permission from sites with low engagement. ([web.dev](https://web.dev/articles/push-notifications-permissions-ux), [Mozilla](https://hacks.mozilla.org/2019/11/upcoming-notification-permission-changes-in-firefox-72/), [Google](https://blog.google/chromium/automatic-notification-permission/))
- **Vendors:** only **MagicBell** and **SuprSend** have a first-party VAPID web push Channel with a service worker or SDK. **Knock** states it has no first-party web push channel and routes through FCM. **Novu** routes through FCM or Pushpad. **Courier** routes through third parties (OneSignal, Pusher Beams, MagicBell). ([Knock](https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm), [Novu](https://docs.novu.co/platform/integrations/push), [Courier](https://www.courier.com/docs/integrations/push/overview), [MagicBell](https://www.magicbell.com/docs/channels/web_push), [SuprSend](https://docs.suprsend.com/docs/web-push-quick-start))
- **Email reaches every user** whatever their browser or device. It needs SPF, DKIM and DMARC on the sending domain. At 5,000+ messages/day to Gmail, it also needs DMARC alignment, a spam rate under 0.3%, and RFC 8058 one-click unsubscribe on marketing messages (not required on transactional mail). ([Google](https://support.google.com/a/answer/81126), [Google FAQ](https://support.google.com/a/answer/14229414), [Yahoo](https://senders.yahooinc.com/best-practices/))
- **Recommendation:** for v1, ship the Inbox plus **email** as the only extra Channel. Add web push in v2 as an opt-in Channel for desktop and Android users. Choose a vendor whose web push support is native (SuprSend or MagicBell) so that v2 does not force a vendor change.

## 1. Browser support

### Desktop

| Browser | Push API + Notifications API since | Notes |
| --- | --- | --- |
| Chrome | 42 (2015) | Push needs a service worker. Chrome rejects `subscribe()` unless `userVisibleOnly: true`. ([Chrome](https://developer.chrome.com/blog/push-notifications-on-the-open-web), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe)) |
| Edge | 17 | Uses Windows Push Notification Services (WNS) on Windows. `userVisibleOnly` must be true, and Edge shows a generic notification if the service worker shows none. ([web.dev](https://web.dev/blog/push-notifications-in-all-modern-browsers), [Microsoft](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push), [Microsoft policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/ForceBuiltInPushMessagingClient)) |
| Firefox | 44 (released 26 January 2016) | Since Firefox 72 (7 January 2020), `Notification.requestPermission()` and `PushManager.subscribe()` work only from a user gesture. ([Mozilla Hacks](https://hacks.mozilla.org/2016/01/web-push-arrives-in-firefox-44/), [MDN Fx72](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/72)) |
| Safari (macOS) | Announced for Safari 16 on macOS 13 Ventura. Shipped in Safari 16.1. | Standard W3C Push API. No Apple Developer Program membership needed. Needs a user gesture and `userVisibleOnly: true`. ([WebKit](https://webkit.org/blog/12945/meet-web-push/), [WebKit 16.1](https://webkit.org/blog/13399/webkit-features-in-safari-16-1/)) |

MDN marks the Push API as Baseline "widely available", "available across browsers since March 2023". ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Push_API))

### Android

Chrome on Android has supported push since Chrome 42, in a normal browser tab with no install ([Chrome](https://developer.chrome.com/blog/push-notifications-on-the-open-web)). Chrome's October 2025 auto-revocation of notification permission covers Android and desktop, and exempts installed web apps ([Google](https://blog.google/chromium/automatic-notification-permission/)). **Unverified:** Firefox for Android and Samsung Internet support details were not checked against a primary source here.

### iOS and iPadOS

- **16.4 (beta announced 16 February 2023):** Web Push is available to web apps **added to the Home Screen**, with a manifest whose `display` is `standalone` or `fullscreen`. Permission must be requested from a direct user action, and the Badging API also works. Push does not work in a Safari tab. ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/))
- **Declarative Web Push, iOS/iPadOS 18.4 (31 March 2025):** "available on iOS and iPadOS 18.4 for web apps added to the Home Screen". A JSON payload (`"web_push": 8030`, plus `notification.title` and `notification.navigate`) is shown by the browser without running a service worker, and `window.pushManager` can subscribe without one. A service worker becomes optional and can still rewrite the notification. The payload is backwards compatible: older browsers handle it through the usual service worker path. It was testable on the macOS 15.5 beta. ([WebKit 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/), [Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)) The Home Screen requirement on iOS does not change.
- **iOS/iPadOS 26 (WWDC, 9 June 2025):** "By default, every website added to the Home Screen opens as a web app", and users can turn off "Open as Web App". ([WebKit](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/), [WebKit 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)) Adding a site is therefore enough to make it a web app. **Unverified:** whether iOS 26 grants push to a Home Screen site that has no manifest. Ship a manifest anyway.
- **EU:** In February 2024 Apple said iOS 17.4 would remove Home Screen web apps in the EU to comply with the DMA, then reversed that decision on 1 March 2024. **Unverified from a primary source:** Apple's current DMA page ([Apple](https://developer.apple.com/support/dma-and-apps-in-the-eu/)) no longer mentions Home Screen web apps. The history above comes from press coverage at the time (for example [MacRumors](https://www.macrumors.com/2024/03/01/apple-walks-back-decision-to-disable-eu-web-apps/)), which is a secondary source. Treat EU iOS push as working the same as elsewhere, but re-check before relying on it.

**Implication:** for iPhone learners, web push is opt-in twice: they must install the app to the Home Screen, then grant permission. Expect low reach on iOS.

## 2. What a Vite / React Router app must add

1. **Service worker file.** Put it at `public/sw.js`. Vite serves `public/` "at root path `/` during dev" and copies it "to the root of the dist directory as-is", without hashing ([Vite](https://vite.dev/guide/assets)). Register it with `navigator.serviceWorker.register("/sw.js")`. The default scope is the script's directory, so `/sw.js` controls the whole app. A worker cannot have a scope broader than its location unless the server sends a `Service-Worker-Allowed` header. `{ type: "module" }` is an option. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)) SuprSend warns that if a bundler emits the worker into a subdirectory, push "fails silently" because of scope ([SuprSend](https://docs.suprsend.com/docs/web-push-quick-start)). The worker handles `push` (calls `showNotification`), `notificationclick` (opens or focuses the Inbox), and `pushsubscriptionchange`.
2. **Web app manifest.** Add `public/manifest.webmanifest` with `display: "standalone"`, a name and icons, and link it from the root layout with `<link rel="manifest">`. It is required for iOS Home Screen push ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
3. **VAPID keys.** Use one ECDSA P-256 key pair per environment. The public key goes to the browser as `applicationServerKey`. The private key signs a JWT (`aud` is the push service origin, `exp` is at most 24 hours ahead, `sub` is a `mailto:` or `https:` contact), sent as `Authorization: vapid t=<JWT>, k=<public key>`. This signing key must differ from the RFC 8291 encryption key. ([RFC 8292](https://www.rfc-editor.org/rfc/rfc8292), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe)) Keep the private key in server env vars and never in client code ([Knock VAPID tool](https://knock.app/tools/vapid-key-generator)). With SuprSend or MagicBell, the vendor holds the private key and Cadence ships only the public key ([SuprSend](https://docs.suprsend.com/docs/web-push-quick-start), [MagicBell](https://www.magicbell.com/docs/channels/web_push)). Payloads are encrypted per RFC 8291 and delivered over the RFC 8030 protocol ([RFC 8030](https://www.rfc-editor.org/rfc/rfc8030), [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291)).
4. **PushSubscription storage.** Store `endpoint` plus `keys.p256dh` and `keys.auth`, keyed by user and unique on `endpoint`. The endpoint "is a unique capability URL" and "needs to be kept secret" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)). Protect the subscribe endpoint against CSRF (same page). A vendor stores the same tuple as a per-user "channel token" ([MagicBell](https://www.magicbell.com/docs/channels/web_push)).
5. **Expiry and rotation.** A subscription may carry `expirationTime`, which can be `null` ([W3C Push API](https://www.w3.org/TR/push-api/)). `pushsubscriptionchange` fires when the browser refreshes, revokes or loses a subscription. MDN rates it "Limited availability", so don't depend on it ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event)). The dependable signal is the push service response: **404** (expired) or **410** (gone) means delete the subscription. 429 means rate-limited (honour `Retry-After`), and 413 means the payload is too big (the minimum supported size is 4096 bytes). `TTL` is a required header. ([web.dev](https://web.dev/articles/push-notifications-web-push-protocol)) Also re-check `getSubscription()` on each app load and re-sync it to the server.
6. **Per-browser, per-device subscriptions and user switching.** A subscription belongs to a service worker registration, meaning one origin in one browser profile, not to a Cadence user. The registration's push subscription is the one matching its scope, and subscribing again reuses it ([W3C Push API](https://www.w3.org/TR/push-api/)). One user with a laptop and a phone has two subscriptions. Two Cadence users in one browser share **one** endpoint. Consequences for the DevUI user switch and for real logout:
   - On logout or user switch, call `PushSubscription.unsubscribe()` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription/unsubscribe)) **and** delete the server-side row. Otherwise the previous user's Notifications keep arriving in a browser now used by someone else.
   - Make `endpoint` unique server-side, so that attaching it to a new user detaches it from the old one. This is an inference from the spec behaviour above, not a documented vendor feature. **Unverified:** each vendor's SDK "reset/logout" call removes the browser token from the old vendor user. Test this before relying on it.
   - In development, all DevUI users share one OS-level notification permission for `localhost`.

## 3. Permission prompt best practice

- **User gesture.** Since Firefox 72, `requestPermission()` and `subscribe()` without a user gesture are rejected, and the user only sees a small address-bar icon ([Mozilla Hacks](https://hacks.mozilla.org/2019/11/upcoming-notification-permission-changes-in-firefox-72/)). Safari requires a gesture on macOS and iOS ([WebKit](https://webkit.org/blog/12945/meet-web-push/), [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). MDN: "the request should be made in response to user interaction" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static)).
- **Soft ask (double permission).** First show an in-app control that explains the value, then call the real prompt only on a positive answer. Never prompt on page load. ([web.dev](https://web.dev/articles/push-notifications-permissions-ux)) For Cadence, a good place is an "Enable browser notifications" toggle in Inbox or notification settings.
- **On deny.** "your web app can't ask for permission again". The user must change the site setting in the browser ([web.dev](https://web.dev/articles/push-notifications-permissions-ux)). `Notification.permission` is `granted`, `denied` or `default`, and `default` behaves like denied ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static)). The UI should detect `denied` and show instructions rather than a dead button.
- **Chrome enforcement.**
  - Chrome 80 introduced quieter permission prompts for sites with low acceptance rates or users who often block ([Chrome](https://developer.chrome.com/blog/permissions-request-chip), [Chrome Help](https://support.google.com/chrome/answer/3220216)).
  - Sites with a "Failing" Abusive Notifications Report get all notifications and prompts blocked, after at least 30 days' notice ([Google](https://support.google.com/webtools/answer/9799427)).
  - Push is rate-limited (429) for high-volume, low-engagement senders ([Chrome](https://developer.chrome.com/blog/web-push-rate-limits)).
  - Since October 2025, Chrome auto-revokes notification permission on sites with low engagement and high volume. Installed web apps are exempt. ([Google](https://blog.google/chromium/automatic-notification-permission/))

## 4. localhost, LAN and iOS testing

- `http://localhost`, `*.localhost` and `127.0.0.0/8` are "potentially trustworthy", so service workers and push work there without HTTPS ([MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)). Service worker registration fails on a non-trustworthy origin ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)). SuprSend confirms that localhost works for development ([SuprSend](https://docs.suprsend.com/docs/web-push-quick-start)).
- A LAN IP such as `http://192.168.x.x` is **not** on the trustworthy list, so a phone on the same Wi-Fi can't test push over plain HTTP ([MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)).
- iPhone testing therefore needs a public or trusted HTTPS origin, such as an HTTPS tunnel or a deployed preview, and the site must be added to the Home Screen first. **Unverified:** no primary source was found for any specific tunnel product. This is a consequence of the secure-context and Home Screen rules, not a documented recipe.
- Vendor push still reaches the browser from localhost, because delivery goes vendor, then push service (FCM, Mozilla autopush, WNS or APNs), then browser. Localhost never has to be reachable. This follows from the RFC 8030 architecture ([RFC 8030](https://www.rfc-editor.org/rfc/rfc8030)).

## 5. Vendor coverage

Doc pages generally showed no visible date. The Knock and Novu docs were read from their live `llms.txt` indexes on 2026-11-12.

| Vendor | Web push model | Service worker / SDK | Free tier | Source |
| --- | --- | --- | --- | --- |
| **Knock** | **No first-party web push.** "Knock does not have a first-party web push channel. Instead, you'll use FCM." OneSignal is another route (`external_id` set to the Knock user ID). Push providers listed: APNs, FCM, Expo, OneSignal, Amazon SNS. | You write `firebase-messaging-sw.js` and use the Firebase SDK and Firebase's VAPID key. The FCM token is stored as Knock channel data. | 10,000 messages/month, unlimited Channels, no hard cap | [tutorial](https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm), [providers](https://docs.knock.app/integrations/push/overview), [OneSignal](https://docs.knock.app/integrations/push/one-signal), [pricing](https://knock.app/pricing) |
| **Novu** | **Provider integration only.** FCM ("Desktop notifications for websites can be sent using FCM webpush") or Pushpad, a third-party web push service. No native VAPID provider found. Also FCM, APNs, Expo, OneSignal, Pusher Beams, Push Webhook. | No Novu web push service worker found. You use the FCM or Pushpad SDK. | 10,000 workflow runs/month, 5 workflows, all Channels including in-app Inbox, 24 h activity retention | [push](https://docs.novu.co/platform/integrations/push), [FCM](https://docs.novu.co/platform/integrations/push/fcm), [Pushpad](https://docs.novu.co/platform/integrations/push/pushpad), [pricing](https://novu.co/pricing) |
| **MagicBell** | **Native VAPID web push Channel.** You supply VAPID public and private keys in the dashboard or API (`PUT /v2/integrations/web_push`). Subscriptions are stored as per-user tokens (`endpoint`, `p256dh`, `auth`). States iOS 16.4+ Home Screen support. | SDK "handle[s] service worker registration and setup automatically". React, web components and vanilla JS clients. | Builder plan: $0, 1,000 deliveries/month (each Channel delivery counts), unlimited users | [channel](https://www.magicbell.com/docs/channels/web_push), [web-push](https://www.magicbell.com/web-push), [pricing](https://www.magicbell.com/pricing) |
| **Courier** | **No native web push.** Push providers include FCM (docs cover only Android/iOS), OneSignal, Pusher Beams ("web, APNs, or FCM mode"), MagicBell and others. "Courier Push" in its Inbox is in-app over WebSocket, not browser push. | No Courier web push service worker found. You use the third-party provider's SDK. | 10,000 sends/month | [providers](https://www.courier.com/docs/integrations/push/overview), [FCM](https://www.courier.com/docs/external-integrations/push/firebase-fcm), [pricing](https://www.courier.com/pricing) |
| **SuprSend** | **Native VAPID web push.** SuprSend generates the VAPID pair (Vendors, Web Push), the private key stays in SuprSend, and Cadence passes `vapidKey` to the SDK. `registerPush()` must run from a user action. Localhost works. | You add `/serviceworker.js` at the site root, which `importScripts` the SuprSend web-sdk worker from jsDelivr (v4.0.0 in the React docs). React and JS SDKs. The user is identified by `distinct_id`. | 10,000 notifications/month, all Channels including web push, email and Inbox; Inbox shows SuprSend branding; 30-day logs | [quick start](https://docs.suprsend.com/docs/web-push-quick-start), [React](https://docs.suprsend.com/docs/react-webpush), [JS](https://docs.suprsend.com/docs/js-webpush), [pricing](https://www.suprsend.com/pricing) |

Notes:

- None of the vendor docs read here say how their SDK detaches a browser subscription from the old user on logout or user switch. **Unverified:** test this with the DevUI switch during vendor selection.
- FCM-based routes (Knock, Novu, Courier) add a Firebase project, the Firebase SDK and an FCM-specific service worker. That is a second vendor in the delivery path.
- Free-tier limits come from the pricing pages on 2026-11-12 and can change.

## 6. Email as the fallback Channel

**Reach.** Email works for every learner, instructor and admin, whatever the browser or device, with no install or permission prompt. Web push, by contrast, needs a supported browser and a granted permission, and on iOS also a Home Screen install (sections 1 and 3).

**Deliverability requirements** (Gmail and Yahoo, effective February 2024):

- **All senders:**
  - Set up SPF or DKIM.
  - Have valid forward and reverse DNS.
  - Send over TLS.
  - Keep the spam rate below 0.3%.
  - Follow RFC 5322.

  ([Google](https://support.google.com/a/answer/81126), [Yahoo](https://senders.yahooinc.com/best-practices/))
- **Bulk senders:**
  - Gmail defines a bulk sender as "close to 5,000 messages or more" per 24 h to personal Gmail accounts, and the status is permanent ([Google FAQ](https://support.google.com/a/answer/14229414)).
  - Use SPF **and** DKIM, plus DMARC (`p=none` is acceptable) with From: alignment.
  - Support one-click unsubscribe for marketing and subscribed messages, with a visible unsubscribe link in the body.

  Yahoo requires unsubscribes to be honoured within 2 days. ([Google](https://support.google.com/a/answer/81126), [Yahoo](https://senders.yahooinc.com/best-practices/))
- **One-click unsubscribe (RFC 8058, January 2017):**
  - Add a `List-Unsubscribe` header with an HTTPS URI, plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
  - Both headers must be covered by a valid DKIM signature.
  - The receiver POSTs with no cookies or auth, and no redirects are allowed.

  ([RFC 8058](https://www.rfc-editor.org/rfc/rfc8058)) Google: "One-click unsubscribe is required only for marketing and promotional messages". Transactional mail such as password resets is exempt. ([Google FAQ](https://support.google.com/a/answer/14229414))
- **Enforcement:** "Starting November 2025, Gmail is ramping up its enforcement on non-compliant traffic", with temporary or permanent rejections ([Google FAQ](https://support.google.com/a/answer/14229414)).

**What this means for Cadence.** Most Cadence Notifications (refund updates, course activity, team admin actions) are transactional, so RFC 8058 is not strictly required for them. Adding it anyway is cheap and future-proofs any digest or announcement email. The real work is DNS: SPF, DKIM and DMARC on the sending domain, normally configured through whatever email provider the vendor connects to. All five vendors include email on their free tiers (see table).

## 7. Recommendation: push vs email for v1

**v1: Inbox plus email.**

- Email reaches 100% of users, needs no service worker, manifest, VAPID keys or subscription lifecycle, and has no iOS install hurdle.
- The deliverability work (SPF, DKIM, DMARC, and optionally RFC 8058 headers) is one-time DNS and header configuration.
- It also avoids the user-switching hazard in section 2.6, which affects DevUI development directly.

**v2: web push as an opt-in Channel.**

- Offer it to desktop and Android users from a soft-ask toggle in Inbox settings.
- On iOS, show it only when running as a Home Screen web app.
- It is feasible now: all engines are supported, and localhost works for development.
- Its reach is partial, and it adds lifecycle code: subscription storage, 404/410 pruning, and unsubscribe on logout or user switch.

**Vendor implication.**

- If web push is on the roadmap, prefer a vendor with **native** VAPID web push and its own service worker: **SuprSend** (10k/month free, Inbox and email included) or **MagicBell** (native web push, but only 1,000 deliveries/month free).
- Knock, Novu and Courier would each add Firebase or another push vendor for browser push.
- If push is dropped entirely, any of the five covers Inbox plus email on a free tier.
- Whichever is chosen, verify on localhost that one Cadence user ID maps to one vendor user and that switching users in DevUI detaches the browser subscription from the previous user.

## Unverified items

- Firefox for Android and Samsung Internet push support details.
- Whether iOS 26 grants push to a Home Screen site with no manifest.
- Current EU status of iOS Home Screen web apps from a primary Apple source (Apple's DMA page no longer mentions it; the March 2024 reversal is from press reports).
- Each vendor SDK's logout/reset behaviour for web push tokens.
- A specific HTTPS tunnel product for iPhone testing (no primary source sought).
- Chrome version that introduced October 2025 auto-revocation (the post gives none).

## Sources

Specs and RFCs
- W3C Push API (Working Draft, 12 November 2026): https://www.w3.org/TR/push-api/
- RFC 8030 Generic Event Delivery Using HTTP Push: https://www.rfc-editor.org/rfc/rfc8030
- RFC 8291 Message Encryption for Web Push: https://www.rfc-editor.org/rfc/rfc8291
- RFC 8292 VAPID (November 2017): https://www.rfc-editor.org/rfc/rfc8292
- RFC 8058 One-Click Unsubscribe (January 2017): https://www.rfc-editor.org/rfc/rfc8058

MDN / Mozilla
- Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- PushManager.subscribe(): https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe
- PushSubscription.unsubscribe(): https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription/unsubscribe
- pushsubscriptionchange: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event
- ServiceWorkerContainer.register(): https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register
- Notification.requestPermission(): https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static
- Secure contexts: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
- Firefox 72 release notes: https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/72
- Web Push arrives in Firefox 44: https://hacks.mozilla.org/2016/01/web-push-arrives-in-firefox-44/
- Notification permission changes in Firefox 72: https://hacks.mozilla.org/2019/11/upcoming-notification-permission-changes-in-firefox-72/

Apple / WebKit
- Meet Web Push (Safari 16, macOS Ventura): https://webkit.org/blog/12945/meet-web-push/
- WebKit Features in Safari 16.1: https://webkit.org/blog/13399/webkit-features-in-safari-16-1/
- Web Push for Web Apps on iOS and iPadOS (16 February 2023): https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Meet Declarative Web Push (27 March 2025): https://webkit.org/blog/16535/meet-declarative-web-push/
- WebKit Features in Safari 18.4 (31 March 2025): https://webkit.org/blog/16574/webkit-features-in-safari-18-4/
- News from WWDC25, Safari 26 beta (9 June 2025): https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
- WebKit Features in Safari 26.0: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- Apple DMA and apps in the EU: https://developer.apple.com/support/dma-and-apps-in-the-eu/
- (Secondary, for EU history only) MacRumors, 1 March 2024: https://www.macrumors.com/2024/03/01/apple-walks-back-decision-to-disable-eu-web-apps/

Google / Chrome / web.dev
- Push Notifications on the Open Web (Chrome 42): https://developer.chrome.com/blog/push-notifications-on-the-open-web
- Push notifications supported cross-browser: https://web.dev/blog/push-notifications-in-all-modern-browsers
- Permission UX: https://web.dev/articles/push-notifications-permissions-ux
- Web Push protocol: https://web.dev/articles/push-notifications-web-push-protocol
- Web push rate limits: https://developer.chrome.com/blog/web-push-rate-limits
- Permissions request chip: https://developer.chrome.com/blog/permissions-request-chip
- Chrome notifications help: https://support.google.com/chrome/answer/3220216
- Abusive notifications enforcement: https://support.google.com/webtools/answer/9799427
- Automatic notification permission revocation (10 October 2025): https://blog.google/chromium/automatic-notification-permission/

Microsoft
- Edge PWA push: https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push
- ForceBuiltInPushMessagingClient policy: https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/ForceBuiltInPushMessagingClient

Vite
- Static asset handling / public directory: https://vite.dev/guide/assets

Email
- Gmail email sender guidelines: https://support.google.com/a/answer/81126
- Gmail sender guidelines FAQ: https://support.google.com/a/answer/14229414
- Yahoo sender best practices: https://senders.yahooinc.com/best-practices/

Vendors
- Knock: https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm, https://docs.knock.app/integrations/push/overview, https://docs.knock.app/integrations/push/one-signal, https://knock.app/tools/vapid-key-generator, https://knock.app/pricing
- Novu: https://docs.novu.co/platform/integrations/push, https://docs.novu.co/platform/integrations/push/fcm, https://docs.novu.co/platform/integrations/push/pushpad, https://novu.co/pricing
- MagicBell: https://www.magicbell.com/docs/channels/web_push, https://www.magicbell.com/web-push, https://www.magicbell.com/pricing
- Courier: https://www.courier.com/docs/integrations/push/overview, https://www.courier.com/docs/external-integrations/push/firebase-fcm, https://www.courier.com/pricing
- SuprSend: https://docs.suprsend.com/docs/web-push-quick-start, https://docs.suprsend.com/docs/react-webpush, https://docs.suprsend.com/docs/js-webpush, https://www.suprsend.com/pricing
