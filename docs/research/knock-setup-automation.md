# Setting up Knock: what a human must do, and what the agent can do

Research for the Knock setup wizard. It builds on [knock-fit.md](https://github.com/trenddreamer/cohort-005-project/blob/research/knock-fit/docs/research/knock-fit.md) (#18) and does not repeat it. Scope is the v1 plan from #13: **Inbox only** (Knock's `in_app_feed` channel), 8 kinds of Notification, and enhanced security with signed user tokens. Collected on **2026-11-16**. Knock is shipping agent features quickly, so check the "headless accounts" section again before you build the wizard.

Knock's own product names (`in_app_feed`, "in-app feed channel") appear in code style below. In Cadence code and copy, use the glossary term **Inbox**.

## Verdict

**A human needs about 5 minutes in the dashboard, in 4 steps.** The agent does everything after that.

1. Sign up. This is browser-only [S2][S3], with no card [S1].
2. Turn on environments. This is dashboard-only and can't be undone [S5].
3. Create a **service token** [S6].
4. In the development environment, turn on **enhanced security mode** and generate the **signing key**. The signing key is shown once [S8][S9].

The service token is the only credential the agent needs for setup. It drives the Management API and the CLI [S6][S10], and it can be **exchanged for the environment's secret and public API keys** through `POST /v1/api_keys/exchange` [S11]. So the human does not need to copy API keys. The signing key is different: no Management API endpoint returns or creates it [S10], so it has to come from the dashboard.

After that, the agent can do all of these as code:

- list channels and find the Inbox channel ID;
- set environment variables;
- create preference categories and default preferences;
- create, validate, push and commit the 8 workflows;
- run a workflow;
- read the result back from the feed API with a signed token.

**One development to watch.** Knock's Management API spec already lists `POST /v1/headless_accounts`. An agent calls it with no credentials, gets an unowned account plus a service token, builds in it, and a human "claims" it later with a link and a six-digit code [S10][S12]. If that goes live, steps 1 and 3 become "type a code". **It is not live yet**:

- the docs PR is still open, marked "Do not merge before … `control-agent-provisioning-enabled` is on in production. The page describes endpoints that are dark until then" [S12];
- Knock's published `auth.md` says Knock "does not support agentic OAuth registration today" [S13].

Even with it, steps 2 and 4 remain dashboard-only.

## 1. Signup

- **Browser only.** The quick start says "create a Knock account … and log into the Knock dashboard" [S3]. No public, documented API or CLI signup exists today [S13]. `knock login` needs an existing account and opens a browser [S7].
- **Sign-in methods.** Email magic link (it expires in 5 minutes) or Google. SAML is Enterprise only [S2]. The docs mention no separate email-verification step; clicking the magic link signs you in [S2]. GitHub sign-in is not mentioned.
- **No card.** "Start building for free, no credit card required" [S1].
- **What a new account has.** "Your Knock account starts with a single environment: production" [S5]. Knock "will create a single in-app channel for you" by default [S14]. See §4 for the doubt about this.

## 2. Credentials

| Credential | Prefix | Created where | API/CLI? | Needed by |
|---|---|---|---|---|
| Service token | `knock_st_` | Dashboard: **Settings → Service tokens → + New token**. Shown once. Owner or admin only. Account-wide, with the creator's privileges. No expiry is documented [S6] | Not creatable by API, except the not-yet-live headless-account flow [S10][S12] | Agent (Management API, CLI, MCP). Never the app at runtime |
| Secret API key | `sk_` | Dashboard: **Platform → API keys**, per environment [S4] | **Yes, readable**: `POST https://control.knock.app/v1/api_keys/exchange?environment=development` with the service token returns the environment's secret key [S11] | Cadence server (trigger, identify) |
| Public API key | `pk_` | Same page [S4] | **Yes**: the same endpoint with `&type=public` [S11] | Cadence browser (Inbox) |
| Signing key (RS256 private key) | base64 PEM, `LS0tLS1CRUdJTi…` | Dashboard: **Platform → API keys → Application signing keys**. Shown once, regenerate if lost [S8][S9] | **No.** The Management API has no endpoint for it [S10] | Cadence server, to sign user tokens |
| Inbox channel ID (UUID) | n/a | Dashboard: account settings → **Channels and sources** [S15] | **Yes**: `GET /v1/channels` or `knock channel list --json` [S10][S16] | Cadence browser (`feedId`) |

**Dashboard-only:** the service token (until headless accounts ship) and the signing key.

**What the agent needs:** only `KNOCK_SERVICE_TOKEN`. The Knock CLI reads that exact variable, with precedence flag → env var → config file [S16]. With the token the agent gets everything else except the signing key.

Notes:

- The exchange endpoint "returns the environment's secret key". It does not say whether it **creates** a new key or returns an existing one [S11]. Knock's `auth.md` says `environment` is **required** [S13], while the OpenAPI spec says it defaults to the account's default environment [S10]. Always pass `environment=` explicitly.
- Each environment has its own API keys [S4][S5]. The docs show the signing key on the same per-environment page [S8][S9] but never say outright that each environment has its own signing key. Assume one per environment.

## 3. Knock CLI and Management API: config as code

**Setup.** `npm install -g @knocklabs/cli` [S7]. The docs say Node 16.14+ [S7], but the current package (1.6.2) declares `"node": ">=24"` in `package.json` [S16]. Authentication: `KNOCK_SERVICE_TOKEN` in the environment, `--service-token`, or `~/.config/knock/config.json` with `serviceToken` [S7][S16]. `knock init` writes `knock.json` with `knockDir` [S7]. Knock publishes an agent skill for the CLI: `npx skills add knocklabs/skills --skill knock-cli` [S17].

**What the CLI can manage** [S7]:

| Resource | Commands | Versioned (needs commit)? |
|---|---|---|
| Workflows (including in-app feed steps and templates) | `workflow new/pull/push/validate/run/activate/generate-types` | Yes |
| Partials | `partial push/validate/pull` | Yes |
| Translations | `translation push/validate/pull` | Yes, but translations are **Enterprise-only** [S18] |
| Email layouts | `layout push/validate/pull` | Yes (not needed for v1) |
| Message types | `message-type push/validate/pull` | Yes (not needed for v1, which uses the standard feed template) |
| Channels | `channel list` **only** | Not versioned |
| Environments | `environment list` **only** | n/a |
| Variables | `variable set/get/list/delete` | Not versioned |
| Commits | `commit`, `commit list/get`, `commit promote --to=production` | n/a |

The Management API (`https://control.knock.app/v1`, bearer service token) covers the same ground [S10]. It adds endpoints the CLI lacks:

- `PUT /v1/preference_categories/{name}`;
- `GET`/`PUT /v1/environments/{slug}/defaults`, for the default preference set;
- `GET /v1/channels?include=environment_settings`.

It has **no** endpoints to create channels, enable or create environments, manage API keys, generate signing keys, or invite members. Members are list, get and remove only [S10]. Knock's FAQ confirms that "the Management API does not create channel providers" [S12].

**In-app feed step shape.** A workflow step is:

- `type: "channel"`, `channel_type: "in_app_feed"`;
- `channel_key`: the channel's key, not its UUID;
- `template: { markdown_body, action_url, action_buttons? }`.

`markdown_body` is required. The workflow has `categories: [...]` and `settings.override_preferences` [S10]. In CLI files, the step lives in `in_app_feed_1/markdown_body.md` next to `workflow.json` [S7]. `knock workflow new --key=<key> --steps=in-app-feed` scaffolds one [S7].

**Validate.** `knock workflow validate <key>` / `--all` checks without saving [S7]. Management API equivalent: `PUT /v1/workflows/{key}/validate` [S10].

**Commit before triggers work, in development too.** API triggers run only committed versions. "You need to commit the draft before it goes live in your environment", and drafts "do not apply to workflow runs … invoked through the API" [S19]. The quick start agrees [S3]. So push with `--commit`: `knock workflow push --all --commit -m "…"` [S7].

**Activation** is separate from commits. `knock workflow activate <key> --environment=development` takes effect immediately, with no promotion [S7].

**Promotion.** Commits move up one environment at a time: `knock commit promote --to=production` promotes everything, and `--only=<commit_id>` promotes one commit [S7]. The API equivalent is `PUT /v1/commits/promote?to_environment=production` [S10]. Promotion permission defaults to owners and admins [S5]. Channel configuration, branding and variables are account-level or per-environment settings. They are **not versioned**, and changes apply immediately [S19].

**Where writes go.** The setting "Modify resources in any environment" is on by default. When it is turned off, "every environment other than development is read-only" [S20]. With environments turned on, the agent should always pass `--environment=development`. Without a flag, the CLI uses "the account's default environment" [S16].

## 4. The Inbox channel

- **Default.** "By default, Knock will create a single in-app channel for you" [S14]. The docs never say whether that applies to every **new** account, and never give its default key or name. The React docs list "an in-app feed channel" as a prerequisite and send you to look in the dashboard [S15].
- **Creating one.** Only in the dashboard: **Channels and sources → Create channel** [S21]. There is no create endpoint in the Management API [S10] and no CLI command [S7].
- **Finding its ID and key.** `knock channel list --json` [S16], or `GET /v1/channels`, which lists across the whole account and returns `id` (UUID), `key`, `type` and `provider` [S10]. Filter on `type == "in_app_feed"`.
  - **`id`** goes in `KNOCK_FEED_CHANNEL_ID`, the name the React docs use for `feedId` [S15].
  - **`key`** goes in each workflow step's `channel_key` [S10].
  - A channel has "the same ID for each environment" [S21], so one value works in development and production.
- **Per-environment settings.** Channels need configuring separately in each environment [S21]. For the in-app channel the docs describe no provider credentials, so there is probably nothing to set. `GET /v1/channels/{key}` returns `environment_settings[env].is_valid` and `is_sandbox`, which the agent can check [S10].

## 5. Enhanced security mode

- **Turning it on.** Dashboard only. It is set per environment [S22] on **Platform → API keys** ("navigating to **Platform** > **API Keys** in your Knock dashboard's Production environment") [S9]. It is off by default [S8]. No Management API field or endpoint controls it [S10]. The docs don't describe the exact label of the control.
- **When it is on**, a request with the public key must also carry a signed user token. Otherwise "a request with your public key can act as any user" [S8].
- **Signing key.** Generated on the same page, under "Application signing keys". The private key is shown **once**. The dashboard shows a single-line base64-encoded PEM, and a plain PEM under "Advanced". Use the base64 form in `.env` [S8].
- **Signing tokens.** Verified in `@knocklabs/node` 1.41.1, `lib/tokenSigner.js` [S23]:
  - `import { signUserToken } from "@knocklabs/node"`, then `await signUserToken(String(user.id), { expiresInSeconds })`;
  - `signingKey` defaults to `process.env.KNOCK_SIGNING_KEY` and accepts PEM or base64 PEM;
  - algorithm `RS256`, header `{ alg: "RS256", typ: "JWT" }`;
  - claims `sub` (user ID), `iat`, `exp` (default `iat + 3600`), optional `grants`, and an optional `jti`;
  - signing is local, with no network call.
- **How the token travels.** `@knocklabs/client` sends `Authorization: Bearer <public key>` plus `X-Knock-User-Token: <token>` on HTTP requests, and `user_token` as a socket parameter [S24].
- **Recommendation.** Turn it on in **development as well as production**. The DevUI user switch and the live Inbox then exercise the same code path locally as in production. The knock-fit doc said development "can stay off"; this goal is stricter.

## 6. Preferences and categories

All of this can be done by the agent.

- **Categories.** List them in the workflow's `categories` field, which is versioned [S10]. They can also be created on their own with `PUT /v1/preference_categories/{name}` [S10].
- **Default preference set per environment.** `PUT /v1/environments/{slug}/defaults` with `{ preference_set: { channel_types, categories, workflows, channels } }`. It "applies to the environment immediately, including production. It is not committed or promoted", and it replaces the existing set in full [S10]. The preferences overview confirms defaults can be set "either in the Knock dashboard or with the Management API" [S25].
- **The CLI has no preferences command** [S7]. Use `curl` against the Management API.
- **Not needed for setup.** Per-user preferences are written by the app at runtime through the Knock API [S25].

## 7. Dashboard-only, beyond the above

- Turning on, creating, renaming and deleting **environments**: "You can only enable, create, rename, and delete environments through the Knock dashboard" [S5].
- **Inviting members.** The Management API can only list, get and remove members [S10].
- **Creating channels** and setting provider credentials [S10][S12][S21].
- **Generating service tokens** and **API keys** (creating; reading works through the exchange) [S4][S6].
- **Signing keys** and the **enhanced security** setting [S8][S9].
- **Branding**. It is account-level, not versioned [S19], and has no Management API endpoint [S10]. Free plans keep Knock branding anyway [S1].
- **Permissions** such as "Modify resources in any environment" [S20].

## 8. Free tier limits that matter in development

- **10,000 messages a month**, with no hard cap [S1]. Usage counts in every environment, development included [S18]. For an Inbox-only Notification, one Inbox message counts as one message (knock-fit §Free tier).
- **Unlimited** environments, workflows and members. Logs kept 30 days [S1].
- **Translations are Enterprise-only** [S18], so `knock translation push` is not available. Write copy straight into templates.
- **Rate limits** by tier: 1, 5, 60, 200 and 1,000 requests a second for tiers 1–5 [S26]. Workflow trigger is tier 5 [S27]. Feed list is tier 2, scoped per user and per environment [S28]. Neither will matter for development.
- **Agent credits** (the dashboard Knock agent): 500 a month on free [S1]. Not needed for this flow.

## 9. End-to-end check with no human

All of this runs from the shell with `KNOCK_SERVICE_TOKEN` and `KNOCK_SIGNING_KEY`. It assumes the development environment:

1. `knock whoami`. Returns 200 with the account name [S7]. `GET /v1/whoami` also returns plan features such as `message_sent_limit` [S29].
2. Exchange for keys: `POST /v1/api_keys/exchange?environment=development` (secret) and `…&type=public` [S11].
3. `knock workflow run <key> --environment=development --recipients=<id> --data='{…}'` [S7]. Or call `POST https://api.knock.app/v1/workflows/<key>/trigger` with the secret key and `recipients: [{ id, name }]` for inline identify [S27]. The trigger is async and returns `workflow_run_id` [S27].
4. Sign a token: `node -e` with `signUserToken("<id>")` [S23].
5. `GET https://api.knock.app/v1/users/<id>/feeds/<KNOCK_FEED_CHANNEL_ID>` with `Authorization: Bearer <pk>` and `X-Knock-User-Token: <jwt>` [S24][S28]. Poll until `entries[0]` has the expected `data` and `meta.unread_count` ≥ 1 [S28].
6. **Negative check.** Repeat step 5 without `X-Knock-User-Token`, and with a token for a different `sub`. Both should fail if enhanced security is on [S8]. The docs don't give the exact status code; expect 401 or 403.
7. Clean up the test user if wanted.

Two notes:

- Use a **dedicated test user ID**, such as `cadence-setup-check`, so real Inboxes stay clean.
- Each run costs one message [S1].

## Human steps

For the wizard. Each step says where to click and what to paste into `.env`.

1. **Create a Knock account.** Go to https://dashboard.knock.app and sign up with an email magic link or Google. No card is needed. If Knock asks you to name the account, use `Cadence`. [S1][S2][S3]
2. **Turn on environments.** Open **Settings → Version control → Environments** (https://dashboard.knock.app/~/settings/environments). Click **Enable environments** and confirm. This creates a **Development** environment next to Production. It can't be undone. [S5]
3. **Create a service token.** Open **Settings → Service tokens** and click **+ New token**. Name it `cadence-agent`, then click **Generate**. Copy it right away; it is shown once. Paste it into `.env` as `KNOCK_SERVICE_TOKEN=knock_st_…`. [S6]
4. **Turn on enhanced security in Development.** Use the environment switcher to pick **Development**. Open **Platform → API keys**. Turn on **enhanced security mode**. Under **Application signing keys**, generate a signing key. Copy the **base64 (single-line)** form; it is shown once. Paste it into `.env` as `KNOCK_SIGNING_KEY=LS0tLS1CRUdJTi…`. [S8][S9]
5. **Confirm there is an in-app feed channel.** Open account settings → **Channels and sources**. If no channel of type "In-app feed" is listed, click **Create channel**, choose **In-app feed**, and save. Nothing to copy; the agent reads the ID. [S14][S15][S21]
6. **Tell the agent you're done.** It takes over from here.

Later, when going to production, repeat step 4 in the **Production** environment. Put that signing key in the production secrets, not in local `.env`.

## Agent steps

1. **Install and check the CLI.** `npm i -D @knocklabs/cli` (needs Node ≥ 24 [S16]). Then `npx knock whoami` with `KNOCK_SERVICE_TOKEN` from `.env`. `npx knock environment list` must show `development` and `production`.
2. **Fill in the API keys.**
   ```sh
   curl -X POST -H "Authorization: Bearer $KNOCK_SERVICE_TOKEN" \
     "https://control.knock.app/v1/api_keys/exchange?environment=development"
   curl -X POST -H "Authorization: Bearer $KNOCK_SERVICE_TOKEN" \
     "https://control.knock.app/v1/api_keys/exchange?environment=development&type=public"
   ```
   Write the results to `.env` as `KNOCK_API_KEY` (the name `@knocklabs/node` reads by default [S23]) and `KNOCK_PUBLIC_API_KEY` [S8][S11].
3. **Find the Inbox channel.** Run `npx knock channel list --json` and pick `type == "in_app_feed"`. Write its `id` to `.env` as `KNOCK_FEED_CHANNEL_ID`, and keep its `key` for workflow steps. Check `GET /v1/channels/<key>` shows `environment_settings.development.is_valid == true` [S10][S16].
4. **Set variables.** `npx knock variable set app_url --type=public --environment-value=development=http://localhost:5173`, so templates can build `action_url`s from `{{ vars.app_url }}`. In CLI 1.6.2, `variable set` rejects `--environment`; you set per-environment values with the repeatable `--environment-value <slug>=<value>` [S16]. Variables are not versioned [S19].
5. **Create the preference categories.** `PUT https://control.knock.app/v1/preference_categories/{name}` for each category Cadence uses [S10].
6. **Scaffold and write the 8 workflows** from #13. `npx knock init`, then `npx knock workflow new --key=<key> --steps=in-app-feed` for each one. Edit `workflow.json` and `in_app_feed_1/markdown_body.md`, using the copy from #13 and the `GLOSSARY.md` terms. Set `channel_key`, `action_url` and `categories` [S7][S10].
7. **Validate, push and commit.**
   ```sh
   npx knock workflow validate --all --environment=development
   npx knock workflow push --all --environment=development --commit -m "Add v1 Notifications"
   ```
   Then `npx knock workflow activate <key> --environment=development` if any workflow is inactive [S7][S19].
8. **Default preferences.** `PUT /v1/environments/development/defaults` with a `preference_set` that turns `in_app_feed` on [S10].
9. **Generate trigger types** (optional). `npx knock workflow generate-types --output-file=./app/notifications/knock-workflows.ts` [S7].
10. **Check end to end** as in §9: run or trigger a workflow, sign a token, read the feed with the public key and the token, and check that a request without the token is rejected.
11. **Production, later.** `npx knock commit promote --to=production` [S7]. Then exchange the production keys (`environment=production`) into production secrets, `PUT /v1/environments/production/defaults`, and set `app_url` for production.

## Open questions / risks

- **Headless accounts may make human steps 1 and 3 unnecessary.** `POST /v1/headless_accounts` is in the OpenAPI spec [S10] but is "dark" until a feature flag goes on, and the docs PR is unmerged [S12]. `auth.md` says agent registration is unsupported today [S13]. Re-check before building the wizard. If it goes live:
  - the agent creates the account;
  - the human only claims it with a link and code;
  - unclaimed accounts are deleted after 24 hours;
  - the account is limited to the Free plan [S12].

  Turning on environments and the signing key would still need the dashboard.
- **Does exchange create keys or return existing ones?** The spec doesn't say [S11]. If it creates a new key on every call, repeated setup runs would pile up keys. Call it once and keep the result.
- **Is the signing key per environment?** Probably, since it sits on the per-environment API keys page [S8][S9], but the docs don't say so outright.
- **Default in-app channel.** Docs say Knock creates one [S14] but give no key or name, and don't confirm it exists before environments are turned on. Wizard step 5 covers the case where it is missing.
- **Exact UI labels** for the enhanced security control and the signing-key button aren't in the docs. The wizard copy may need adjusting after a real walkthrough.
- **Rejection status code** for a missing or wrong user token isn't documented. The negative check should accept 401 or 403.
- **CLI Node version.** `@knocklabs/cli` 1.6.2 requires Node ≥ 24 [S16], but the docs say 16.14+ [S7]. Check the project's Node version, or use the Management API with `curl` instead.
- **The service token is powerful.** It is account-wide, with admin privileges and no documented expiry [S6]. Keep it in `.env` (gitignored) only. Don't ship it to the runtime or CI unless needed. Revoke it from **Settings → Service tokens** when setup is done if you want least privilege.
- **Turning on environments can't be undone** [S5]. That's fine for Cadence, but the wizard should say so.

## Sources

Accessed 2026-11-16.

- [S1] Knock pricing: https://knock.app/pricing
- [S2] Authentication methods: https://docs.knock.app/manage-your-account/authentication-methods
- [S3] Quick start: https://docs.knock.app/getting-started/quick-start
- [S4] API keys: https://docs.knock.app/developer-tools/api-keys
- [S5] Environments: https://docs.knock.app/version-control/environments (also https://docs.knock.app/concepts/environments)
- [S6] Service tokens: https://docs.knock.app/developer-tools/service-tokens
- [S7] Knock CLI reference: https://docs.knock.app/cli and https://docs.knock.app/cli/overview/authentication
- [S8] Security and authentication (enhanced security, signing keys, `signUserToken`): https://docs.knock.app/in-app-ui/security-and-authentication
- [S9] Implementation guide: https://docs.knock.app/tutorials/implementation-guide
- [S10] Management API OpenAPI spec: https://docs.knock.app/mapi/openapi.json (endpoints and schemas quoted from it). Overview: https://docs.knock.app/mapi-reference
- [S11] Exchange for API key: https://docs.knock.app/mapi-reference/api_keys/exchange
- [S12] knocklabs/docs PR #1755 "adds agent registration page" (open, unmerged): https://github.com/knocklabs/docs/pull/1755
- [S13] Knock `auth.md`: https://knock.app/auth.md
- [S14] Feeds overview (FAQ: default in-app channel): https://docs.knock.app/in-app-ui/feeds/overview
- [S15] React feed component (`KNOCK_FEED_CHANNEL_ID`, Channels and sources): https://docs.knock.app/in-app-ui/react/feed
- [S16] `@knocklabs/cli` 1.6.2 npm package source (`dist/lib/base-command.js` `env: "KNOCK_SERVICE_TOKEN"`, `dist/commands/channel/list.js` `enableJsonFlag`, `package.json` engines): https://www.npmjs.com/package/@knocklabs/cli, repo https://github.com/knocklabs/knock-cli
- [S17] Knock CLI for AI agents: https://docs.knock.app/ai/cli
- [S18] Knock plans: https://docs.knock.app/manage-your-account/knock-plans
- [S19] Commits: https://docs.knock.app/concepts/commits
- [S20] Environments, "Modify resources in any environment": https://docs.knock.app/version-control/environments
- [S21] Channels: https://docs.knock.app/concepts/channels
- [S22] Changelog 2023-02-24 (enhanced security per environment): https://knock.app/changelog/2023-02-24
- [S23] `@knocklabs/node` 1.41.1 npm package source, `lib/tokenSigner.js` and `client.js`: https://www.npmjs.com/package/@knocklabs/node
- [S24] `@knocklabs/client` 0.23.1 npm package source, `dist/cjs/api.js` (headers): https://www.npmjs.com/package/@knocklabs/client
- [S25] Preferences overview: https://docs.knock.app/preferences/overview
- [S26] Rate limits: https://docs.knock.app/api-reference/overview/rate-limits
- [S27] Trigger workflow: https://docs.knock.app/api-reference/workflows/trigger
- [S28] List feed items: https://docs.knock.app/api-reference/users/feeds/list_items
- [S29] Management API `whoami`: https://docs.knock.app/mapi-reference/auth

## Caveats

- No Knock account was created and no Knock API was called. Package facts come from reading the published npm tarballs, not from running them.
- The headless-account flow is described from the OpenAPI spec and an unmerged docs PR. Treat it as upcoming, not available.
- Dashboard paths are as the docs give them. Knock has renamed menus before ("Developers → API keys" in 2023 [S22], "Platform → API keys" now [S4]).
