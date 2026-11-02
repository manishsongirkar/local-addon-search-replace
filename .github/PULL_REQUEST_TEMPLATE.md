<!--
Thank you for the pull request. Fill in each section. Delete a section only when it does not apply, and say "n/a".
Do not put private data anywhere in this pull request: no real site names, domains, e-mail addresses or folder paths.
Use made-up names such as `my-site.test` and `old.example.net`. Never attach a database or a backup.
-->

## Summary

<!-- One or two sentences: what does this change, and why? -->

## Related issue

<!-- Use "Fixes #123" to close an issue when this is merged, or "Refs #123" to only link it. Write "none" if there is none. -->

Fixes #

## Type of change

<!-- Tick one or more. -->

- [ ] Bug fix (a change that fixes a problem)
- [ ] New feature (a change that adds something)
- [ ] Improvement of an existing feature (behavior, speed, wording)
- [ ] Security fix or hardening
- [ ] Refactor (no change in behavior)
- [ ] Tests only
- [ ] Documentation only
- [ ] CI, tooling or packaging
- [ ] Dependency change

## What changed

<!-- The main points, for a reviewer who has not seen the code. Say WHY for anything that is not obvious. -->

-

### Parts of the add-on touched

- [ ] Engine (`src/engine/`)
- [ ] Main process (`src/main.ts`)
- [ ] Interface (`src/renderer*`)
- [ ] Shared types or IPC channels (`src/common/types.ts`)
- [ ] PHP scripts (`php/`)
- [ ] Tests (`tests/`)
- [ ] Docs (README, DEVELOPMENT, CONTRIBUTING, CHANGELOG)
- [ ] CI or tooling (`.github/`, `scripts/`, hooks)
- [ ] Packaging (`package.json`, `.gitattributes`, `lib/`)

## Behavior change

- [ ] No change that a user can see
- [ ] A user can see a change (describe it below)
- [ ] This changes a saved file format (`config.json`, `history.json`) or a default option. Old files still load:
  - [ ] yes, and a test shows it
  - [ ] not needed, explain below

<!-- Before and after, in words. Add screenshots for interface changes (light and dark theme). -->

## How it was tested

<!-- Tick what you did. Say what you ran, and what you saw. -->

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm test` (unit tests)
- [ ] `npm run test:integration` (real WP-CLI, MySQL and WordPress). Needed for any change that touches the database or WP-CLI
- [ ] Tried by hand in Local (`npm run dev`):
  - [ ] Scan and the list of domains
  - [ ] Dry run (and its log)
  - [ ] Run, with a backup
  - [ ] Cancel
  - [ ] Multisite
  - [ ] Light and dark theme
  - [ ] Other: 

### Where it was tried

| | |
|---|---|
| Operating system | |
| Local version | |
| Database service (MySQL or MariaDB, version) | |
| PHP version of the site | |
| Site type (single, multisite sub-directory, multisite sub-domain, Bedrock) | |

### Tests added or changed

<!-- A bug fix needs a test that fails without the fix. Name the tests, or say why none is needed. -->

-

## Checklist

**Code**
- [ ] The change is small and about one thing.
- [ ] `src/engine/` still has no imports from Local.
- [ ] No new runtime dependency (the add-on ships with none). If there is one, it is explained above.
- [ ] No `any` without a comment that says why.
- [ ] PHP changes run on PHP 7.2 to 8.5: no arrow functions, `match`, `?->`, `str_contains`, named arguments or typed properties.
- [ ] Interface colors come from `src/renderer/theme.ts` (CSS variables), not fixed colors, and text keeps a readable contrast in both themes.
- [ ] State in the main process is still keyed by the site id, so two sites never share data.
- [ ] `lib/` was rebuilt by the pre-commit hook (`npm run setup-git`, then commit). It is not edited by hand.

**Safety**
- [ ] Data from a database (table names, domains, option values) is not given to a command line, to SQL or to `wp-config.php` without a check.
- [ ] No password or secret is written to a log, to history or to a command line.
- [ ] A file or folder the add-on creates is private to the user, and a symbolic link is not followed.
- [ ] A step that can lose data (delete, overwrite, replace) has a check, a backup or a warning that needs a click.

**Docs and housekeeping**
- [ ] README, DEVELOPMENT or CONTRIBUTING are updated where they describe this.
- [ ] A line is added under **Unreleased** in `CHANGELOG.md`.
- [ ] No private data in code, tests, docs, screenshots or this description (the test `no-personal-data` passes).
- [ ] The title says what the change does, in the present tense.

## Risk and rollback

<!-- What could go wrong for a user? How would someone notice, and how can it be undone? Write "low risk" and why, if that is true. -->

## Notes for the reviewer

<!-- Where to look first, what you are unsure about, what you left out on purpose, follow-up work. -->
