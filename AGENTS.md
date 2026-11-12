## Verification checks

Do these checks in this order before you report a change to `app/` as complete:

1. `npm run typecheck`
2. `npm run test`

## When something breaks

| Symptom                                         | Cause                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 401 "Select a user from the DevUI panel"        | No user in the session — switch users and country in the floating panel (`app/components/dev-ui.tsx`). |
| `tsc` reports every `./+types/*` import missing | Typegen has not run. Use `npm run typecheck`, which runs `react-router typegen` first.                 |

## Branches

`coursework` is this repo's working branch: merge finished work into it and stay on it. `main` is a mirror of the course repo's `main` (the `upstream` remote) and only ever receives upstream commits.

When the user asks for a **cleanup**, after the usual tidying, sync with upstream:

1. `git fetch upstream`. If `upstream/main` has new commits, fast-forward `main` to it and push `main` to `origin`.
2. Merge `main` into `coursework`, push `coursework`, and end on `coursework`.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues on your own copy of this repo (the `origin` remote), never on `ai-hero-dev/cohort-005-project`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

## Domain language

`GLOSSARY.md` is the canonical language for refunds. Use its terms in code, on-screen copy, and email, and never the words it lists under _Avoid_.
