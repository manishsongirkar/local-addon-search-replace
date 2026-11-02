# Development

How the add-on is built, how to try a change in Local, and how it is tested and packaged.
Users: see [README.md](README.md). Contributors: see also [CONTRIBUTING.md](CONTRIBUTING.md).

## Layout

| Path | What it holds |
|---|---|
| `src/engine/` | The logic. **No Local imports**, so it is fully testable. |
| `src/main.ts` | The only place that talks to Local (its services, IPC, site data). Runs in Local's main process. |
| `src/renderer.tsx`, `src/renderer/` | The UI: the Tools item, the tabs, the theme. Runs in Local's window. |
| `src/common/types.ts` | Types and the IPC channel names shared by the main process, the engine and the UI. |
| `php/` | Scripts that run inside WP-CLI (`context`, `domains`, `prefilter`) or on their own (`fallback`, `preg-check`). |
| `lib/` | The build (`tsc`). **Committed**, so a clone works without a build. Never edit it by hand. |
| `tests/unit/`, `tests/integration/` | Unit tests and tests against real WP-CLI, MySQL and WordPress. |
| `scripts/dev-sync.mjs` | Copies the build into Local's add-ons folder. |
| `.githooks/pre-commit` | Rebuilds `lib/`, stages it, and runs lint. |
| `.github/` | CI, the issue forms (`ISSUE_TEMPLATE/`) and the pull request template. `scripts/check-github-forms.rb` checks the forms. |

### The engine, by file

| File | Job |
|---|---|
| `urls.ts` | Parse URLs and hosts, suggest replacements, expand a URL into its stored forms, order pairs. |
| `validate.ts` | The checks before a run, and the helpers for skip columns and skip flags. |
| `plan.ts` | Turn pairs and tables into steps: scopes (sub-sites first), table groups for workers, flags, case rule. |
| `runner.ts` | The `Job`: regex check, pre-scan, backup, a scheduler with workers, progress, logs, cancel, fallback retry. |
| `scan.ts` | Read the site layout and the domains, build the candidates. |
| `reconcile.ts` | Merge a scan into the saved list: groups, order, kept text, removed rows. |
| `prefilter.ts` | Find the tables and columns that contain the search text. |
| `fingerprint.ts` | A summary of the database, to see that it changed. |
| `fallback.ts`, `dbconn.ts` | Run `php/fallback.php`, and find the database connection for it. |
| `wpRunner.ts`, `env.ts`, `wpPath.ts` | Start WP-CLI, build its environment, find WordPress. |
| `store.ts`, `logger.ts`, `retention.ts` | Saved config and history, log files, clean-up. |
| `localurl.ts` | Add `https` to a site URL when the site's certificate is trusted. |

### How a run flows

```text
UI (renderer) ── IPC ──▶ main.ts ──▶ engine ──▶ WP-CLI / PHP / MySQL
   ▲                        │
   └── snapshot and log events (every event carries the site id; the UI drops other sites')
```

1. **Scan** (`sr:scan`): `main.ts` builds the runtime (Local's PHP, the WP-CLI phar, the PATH of the database service),
   reads the layout and the domains, merges them into the saved list, and stores a fingerprint.
2. **Check** (`sr:check`): reads the fingerprint again. A difference makes the page scan again.
3. **Start** (`sr:start`): reads the tables again, validates, creates a `Job`.
4. **Job:** regex check, optional pre-scan, backup, then the steps, up to `workers` at a time. A step waits while an earlier
   step uses one of its tables, and a multisite main-site step waits for everything before it. Then wp-config and the cache.
5. **Events:** snapshots (progress) and log lines go to the UI. The log also goes to a file.

Every piece of state in `main.ts` is keyed by the Local site id: jobs, logs, scans, fingerprints. Two sites never share any.

### IPC channels

`sr:scan`, `sr:check`, `sr:validate`, `sr:start`, `sr:cancel`, `sr:state`, `sr:history`, `sr:load-config`, `sr:save-config`,
`sr:log-files`, `sr:read-log`, `sr:open-folder` (UI to main), and `sr:snapshot`, `sr:log` (main to UI). The names are in
`CH` in `src/common/types.ts`.

## Commands

```sh
nvm use && npm install        # also builds lib/ (the prepare script)
npm run build                 # tsc → lib/
npm run lint                  # biome check
npm run format                # biome format --write
npm test                      # unit tests
npm run test:integration      # real WP-CLI + MySQL + WordPress
npm run test:all              # both
npm run pack:check            # what npm would publish
npm run setup-git             # turn on the pre-commit hook
```

## Try a change in Local

`npm run dev` rebuilds on every change in `src/` or `php/` and **copies** the build into Local's add-ons folder
(`scripts/dev-sync.mjs`). `npm run sync` does one copy. It copies, and does not link, because a link would expose the
repository's `node_modules`, which holds its own React. Only the files a user gets are copied.

- First time: switch the add-on on in **Preferences → Add-ons → Installed**, then restart Local.
- A change in the UI: reload the Local window (Cmd/Ctrl+R).
- A change in `src/main.ts` or the engine: quit Local and open it again.
- Another folder: `LOCAL_ADDONS_DIR=/path npm run sync`.

Facts about Local that the code relies on (read from Local itself, not guessed):

- `Site.url` is always `http://…`. The add-on adds `https` from the certificate trust status.
- The config folder of a service is named after it (`conf/mysql`, `conf/mariadb`, `conf/php`). `MYSQL_HOME` and `PHPRC` come
  from the service's `configPath`.
- Both MySQL and MariaDB services expose `mysql`, `mysqld`, `mysqldump` and a `MYSQL` port.
- Other add-ons register a Tools item with `hooks.addFilter('siteInfoToolsItem', …)` and `path: '/<name>'`.

## Tests

| | Unit (`tests/unit`) | Integration (`tests/integration`) |
|---|---|---|
| Needs | Node. PHP if found (some tests skip without it). | MySQL, WordPress, WP-CLI, PHP. |
| Covers | Every engine module, the PHP regexes on real PCRE, the scheduler with fake processes, the theme, the privacy guard. | A real run on single sites, multisite (both types), Bedrock, sub-directory installs, the fallback, the pre-scan, workers, `--all-tables`, options, and database-change detection after real imports. |
| Speed | Seconds. | A few minutes. |

By default the integration tests start a throw-away MySQL from the one that ships with Local on macOS and use Local's PHP,
WP-CLI and cached WordPress. To use your own, set:

| Variable | Meaning |
|---|---|
| `SR_DB_HOST`, `SR_DB_USER`, `SR_DB_PASS` | An existing MySQL or MariaDB server (CI does this). `localhost:/path/sock` means a socket. |
| `SR_MYSQLD` | A `mysqld` binary to start (to try another MySQL version). |
| `SR_MYSQL_BIN` | Folder with the `mysql` and `mysqldump` clients. |
| `SR_WP_TARBALL`, `SR_WPCLI`, `SR_PHP` | A WordPress `.tar.gz`, a `wp-cli.phar`, a PHP binary. |
| `SR_PHP_BINS` | Extra PHP binaries (a PATH-style list) for `php.test.ts`. |

Tests build their own data. They check results, not only that a command ran. Fake processes record real overlap, so a
scheduler that breaks the order of steps on a table fails a test.

### PHP versions

The scripts in `php/` must run on PHP 7.2 to 8.5. `php.test.ts` bans newer syntax, lints every script with every PHP binary
it finds (also the PHP builds of Local), and runs the generated regexes on each of them.

### No private data

`no-personal-data.test.ts` scans source, tests, docs, scripts and workflows. It fails on a `.test` or `.local` host that is not
a listed placeholder, a personal folder path, or an e-mail address outside the example domains.

## CI (`.github/workflows/ci.yml`)

- **Unit tests** on Ubuntu, macOS and Windows: lint, build, unit tests.
- **PHP versions**: 7.2, 7.3, 7.4, 8.0, 8.1, 8.2, 8.3, 8.4 and 8.5. `php -l` on every script, then the PHP and regex tests.
- **lib/ is up to date**: builds and fails when `lib/` differs from the committed files.
- **Integration** on Ubuntu with PHP 7.4, 8.2 and 8.4 against MySQL 8.0, real WordPress and real WP-CLI.

Not in CI yet: MariaDB and other MySQL versions (run them locally with `SR_MYSQLD` or `SR_DB_HOST`), and a release workflow.

## Packaging and releases

- **A `git clone`** has everything: source, tests, and the build in `lib/`.
- **"Download ZIP" and the source archives of a release** hold only what the add-on needs to run. `.gitattributes` marks
  everything else `export-ignore`.
  `.gitattributes` must be committed for this to work. Some global ignore files (`~/.gitignore_global`) list it, so the
  project's `.gitignore` re-includes it with `!.gitattributes`. To check: in a copy of the repository, commit everything and
  run `git archive HEAD | tar -t`. It must list only `lib/`, `php/`, `package.json`, `icon.svg` and the docs.
- **`npm pack`** makes the file Local installs. The `files` list in `package.json` limits it to `lib/`, `php/`, `package.json`,
  `icon.svg`, the README, the license and the changelog. The add-on has no runtime dependencies, so no `node_modules` ships.
- The `peerDependency` on `react` is Local's own React. Never add a copy to the package.

To make a release by hand:

1. Update the version in `package.json` and move the changelog entries from **Unreleased** to the new version.
2. `npm run build && npm test && npm run test:integration`.
3. `git commit`, `git tag vX.Y.Z`, `git push --tags`.
4. `npm pack`, and attach the `.tgz` to the GitHub release.

## Status and open items

- The add-on is not listed in Local's add-on library, so its details page in Preferences shows an error. What is needed to list it
  is in [docs/marketplace-submission.md](docs/marketplace-submission.md).
- Tried by hand in Local on macOS. Windows and Linux are covered by unit tests only.
- Integration-tested with MySQL 8.0.16, 8.0.35 and 8.4. MariaDB is not yet.
- The UI has no automated tests. Its pure parts (theme, log parsing helpers) are tested.
- A scanned row removed with **Remove** returns at the next scan.
- Every progress event carries the full step list. A network with hundreds of steps sends large events.
- In regex mode the fallback unserializes and serializes again every serialized-looking value, also one without a match, so
  a float can be written in a shorter form. It also counts replacements differently from WP-CLI.
- GitHub Actions are pinned by version tag, not by commit.
