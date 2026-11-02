# Contributing

Thank you for helping with Search & Replace for Local. Bug reports, ideas, tests on other systems, documentation and code
are all welcome.

## Ways to help

- **Report a bug** or a confusing message.
- **Suggest a feature.** Say what you want to do and why. A short example helps more than a long design.
- **Try it on a system we have not tried:** Windows, Linux, MariaDB, other PHP versions, multisite layouts.
- **Improve the docs.**
- **Send a change.** For a big change, open an issue first, so we can agree on the direction before you spend time.

## Report a bug

Use **New issue** and choose a form. There is one for a bug, a feature, a compatibility report ("I tried it on this system"),
and documentation. Each form asks for what is needed to reproduce the problem. Please include:

- your Local version and operating system;
- the database engine and version (MySQL or MariaDB), and the PHP version of the site;
- whether the site is a single site or a multisite (sub-directory or sub-domain);
- the steps you took, what you expected, and what happened;
- the lines from the **Logs** tab around the problem. A run also writes a file in
  `<site folder>/search-replace/logs/`.

**Remove private data first.** Replace real site names, domains, e-mail addresses and folder paths in logs and screenshots
with made-up ones (`my-site.test`, `old.example.net`). Never attach a database or a backup.

## Report a security problem

Do not open a public issue. Use the repository's **Security** tab and choose **Report a vulnerability**, so the report stays
private until it is fixed.

## Set up

You need the Node.js version in `.nvmrc`, and PHP for some tests.

```sh
git clone https://github.com/manishsongirkar/local-addon-search-replace.git
cd local-addon-search-replace
nvm use && npm install
npm run setup-git     # turns on the pre-commit hook (it rebuilds lib/)
npm test              # unit tests
```

[DEVELOPMENT.md](DEVELOPMENT.md) explains the layout, how to try your change inside Local, and how to run the integration
tests against a real database.

## Make a change

1. Create a branch from `main`.
2. Keep the change small and about one thing.
3. **Add or update tests.** Logic in `src/engine/` needs unit tests. Behavior that depends on WP-CLI, PHP or the database needs
   an integration test. A bug fix needs a test that fails without the fix.
4. Run the checks:

   ```sh
   npm run lint
   npx tsc --noEmit
   npm test
   npm run test:integration   # when you changed anything that touches the database or WP-CLI
   ```

5. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
6. Open a pull request. The template asks what changed, why, how you tested it, and where (system, Local version, database).

### Rules for code

- **Format and lint** with Biome (`npm run lint`, `npm run format`): tabs, single quotes.
- **TypeScript is strict.** No `any` without a reason in a comment.
- **`src/engine/` has no Local imports.** That keeps it testable. Only `src/main.ts` talks to Local.
- **PHP in `php/` must run on PHP 7.2 to 8.5.** No arrow functions, `match`, `?->`, `str_contains` and the like. A test
  checks this, and CI runs every script on each PHP version.
- **Do not add a runtime dependency.** The add-on ships with none. If you think one is needed, open an issue first.
- **`lib/` is the build.** Do not edit it by hand. The pre-commit hook rebuilds it and adds it to the commit.
- **Comments say why**, not what. Keep the style of the code around yours.
- **The UI follows Local's theme.** Use the colors from `src/renderer/theme.ts` (CSS variables), not fixed colors.

### No private data in the repository

This repository is public. Code, tests, docs and issues must use made-up names only: no real site names, domains,
e-mail addresses or folder paths. A test (`tests/unit/no-personal-data.test.ts`) fails when it finds a `.test` or `.local`
host that is not on its list of placeholders. If you need a new generic name, add it to that list.

## Pull request checklist

- [ ] Lint, types and unit tests pass.
- [ ] Integration tests pass, when the change touches the database or WP-CLI.
- [ ] New behavior has tests. A bug fix has a test that failed before.
- [ ] Docs and the changelog are updated.
- [ ] No private data, and no hand-edited `lib/`.

## License

By sending a change you agree that it is released under the [MIT License](LICENSE) of this project.
