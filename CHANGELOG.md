# Changelog

All notable changes to this add-on are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-02

First version. This is a pre-release: it is tested against real WP-CLI, MySQL and WordPress, but only tried by hand in Local on macOS.

### Added

**Search and replace**
- A **Search & Replace** page in the **Tools** tab of a Local site: scan, dry run, run, cancel, logs, history.
- Replaces plain text, `http` and `https`, protocol-relative, JSON-escaped, double-escaped and URL-encoded forms,
  serialized data, and your own regex. E-mail addresses are kept when a host is replaced.
- A full URL, with a path, can be searched and replaced as it is.
- A dry run is a button next to Run. Matching is always case sensitive and the `guid` column is never changed, so there is no option for either.
- Options: backup, precise mode, `--report-changed-only`, `--skip-plugins`, `--skip-themes`, `--skip-packages`,
  variants, e-mail protection, cache flush, fallback, skip columns, regex flags, WordPress path, workers.
- Runs on all tables of the database, also plugin tables and tables without the prefix.
- Multisite, sub-directory and sub-domain: domains of `wp_blogs`, `wp_site`, `wp_sitemeta` and every sub-site, sub-sites
  first and the network tables last, and `DOMAIN_CURRENT_SITE` updated.

**The list of domains**
- Every domain found in the database is listed in three groups: **main** (ticked, the site's registered domains), **close**
  (a suggested replace, not ticked) and **other** (not ticked), with a filter box and a scroll box for the long group.
- Suggestions from your Local URL: `www` maps to the plain URL, sub-sites of a sub-domain network map to the same
  sub-domain, a domain with the name of the Local site is suggested, and the protocol is `https` when the site's certificate
  is trusted.
- The list is saved per site and checked against the database on every scan: known rows keep your text, new domains are added,
  vanished ones are removed, rows you typed stay.
- The page checks for a changed database (an import by any tool, or a new site URL) when it opens and when you return to
  Local, and scans again.
- A run no longer needs a scan in the same session. A row that replaces a domain with itself is skipped, not an error.

**Speed**
- A pre-scan finds the tables and columns that contain the search text, and WP-CLI touches only those.
- Groups of tables run in parallel WP-CLI processes, and each table still sees the pairs in order.
- A free-disk-space check before the backup, and `--single-transaction`.

**Safety and logs**
- A built-in PHP and MySQL **fallback** for the scan, the replace and the backup when WP-CLI cannot run.
- A regex check before any write, a backup before a real run, cancel, and a log file per run.
- A Logs tab with levels (error, warning, notice, info, command), saved log files and a history of the last 20 runs.
  A dry run lists each changed column. Logs older than 30 days are removed when a run starts, and backups older than 30
  days after a real run that worked.
- Works with the MySQL and MariaDB versions Local offers, and with PHP 7.2 to 8.5.
- The interface follows Local's light or dark theme.

**Project**
- Unit tests, integration tests against real WP-CLI, MySQL and WordPress, a PHP-version matrix in CI, and a test that keeps
  private data out of the repository.
- MIT license, [README](README.md), [DEVELOPMENT](DEVELOPMENT.md) and [CONTRIBUTING](CONTRIBUTING.md).
- `npm run dev` copies each build into Local's add-ons folder. The release package holds only the build files.

### Security
- An imported database is not trusted: a table name or domain that starts with `--` is refused (WP-CLI would read it as an
  option), the network domain is checked before it goes into `wp-config.php`, WP-CLI starts in an empty folder so a site's
  `wp-cli.yml` cannot load code, and the WordPress path must be inside the site folder.
- Saved files are private (mode 600) and are not followed through a symbolic link. Log files can be read only by their
  own names.

[Unreleased]: https://github.com/manishsongirkar/local-addon-search-replace/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/manishsongirkar/local-addon-search-replace/releases/tag/v0.1.0
