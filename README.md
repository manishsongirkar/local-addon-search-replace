# Search & Replace for Local

A [Local](https://localwp.com) add-on. It moves a WordPress database to its Local domain: open a site, go to
**Tools → Search & Replace**, check the domains, and run. The work is done by WP-CLI.

It handles plain domains, `http` and `https`, escaped and encoded forms, serialized data, your own regex, and
multisite networks. It stays fast on very large databases, and it has a built-in fallback for when WP-CLI cannot run.

- Needs Local 10.1.2 or newer. Works with the MySQL and MariaDB versions Local offers, and with the PHP versions Local ships.
- The add-on makes no network calls and sends no data anywhere.

## Install

1. **From a release:** download the `.tgz` of a release. **From Git:** clone the repository (it includes the build in `lib/`).
   **From "Download ZIP":** the ZIP holds only the files the add-on needs.
2. Put the add-on in Local's add-ons folder, in a folder called `local-addon-search-replace`:
   - macOS: `~/Library/Application Support/Local/addons`
   - Windows: `%APPDATA%\Local\addons`
   - Linux: `~/.config/Local/addons`
3. In Local, open **Preferences → Add-ons → Installed**, switch **Search & Replace** on, and restart Local.
   Local ignores an add-on that is not switched on.
4. Open a site. **Search & Replace** is in the **Tools** tab.

## Use it

1. **Open the page.** The add-on reads the domains in the database. You do not need to press anything first.
2. **Check the list.** The main domains are ticked, with your Local URL as the replace text. Change the text if you want.
3. **Press Dry run.** The page switches to the **Logs** tab and shows what would change, table by table.
   Nothing is changed and no backup is made.
4. **Press Run.** The add-on makes a backup, runs, and shows progress and the log.

If you import a new database later (with WP-CLI, phpMyAdmin or the `mysql` command), the page notices and scans again
when you open it or come back to Local.

## The list of domains

Every domain found in the database is listed, in three groups, so you can start with the ones that matter.

| Group | What it holds | Ticked | Replace text |
|---|---|---|---|
| **Main domains** | What the site is registered under: `siteurl` and `home` of every site, the network URL, the hosts in `wp_site` and `wp_blogs`. | Yes | Your Local URL |
| **Close domains** | Near a main domain: `api.example.com`, or `example.net` for `example.com`. Also a domain with the name of your Local site (`api.acme.com` for the site `acme.test`), which is usually the live site the database came from. | No | A suggestion |
| **Other domains found in the database** | CDNs, fonts, other companies. | No | Empty |
| **Added by you** | Rows you typed with **Add domain**. | Yes | What you typed |

- Only ticked rows are used. An unticked row is never searched or replaced, even when both fields are filled.
- To change an "other" domain, tick it and type its replace text.
- A filter box searches the whole list. The "other" group has its own scroll box.
- Built-in noise such as `wordpress.org`, `w3.org` and `gravatar.com` is left out.
- A row that replaces a domain with the same text (typically your own Local domain) is skipped. It never blocks a run.
- The replace text follows your site's protocol. Local reports every site URL as `http://`, so the add-on checks whether the
  site's certificate is trusted (SSL is on) and suggests `https://` when it is. With localhost routing
  (`localhost:10008`) it stays `http`.
- Suggestions by site type: `www.example.com` maps to the plain Local URL. On a sub-domain network, `one.example.com` maps to
  `one.<your-local-domain>`.

### Saved per site

Each site has its own list. On every scan the saved list is checked against the database:

- a known domain keeps the replace text and tick you set;
- a new domain is added to its group;
- a scanned domain that left the database is removed;
- rows you typed yourself are never removed automatically.

If you change the search text of a scanned row, it becomes a row of your own. To skip a scanned row, untick it.

## What is replaced

What you type in **Search** decides what happens.

| Search | What is replaced |
|---|---|
| A domain with scheme, `https://old.example.net` | The domain in all its forms: `http` and `https`, `//old.example.net`, JSON-escaped (`https:\/\/…`), double-escaped, and URL-encoded (`https%3A%2F%2F…`), also inside serialized data. A path after it is kept. |
| A URL with a path, `https://old.example.net/blog` | Exactly that text, so `…/blog/post` follows. Its JSON-escaped and double-escaped forms are covered too. |
| A bare host, `old.example.net` | The host. E-mail addresses on that host are kept (you can turn that off). |
| Any other text | That text. |
| A regex (tick **Regex**) | Your pattern, run last, in your own order. |

The longest search runs first, so `https://a.com/blog` is applied before `https://a.com`. Text is matched with the exact upper and
lower case. The `guid` column is never changed.

## Options

The **Options** section holds these:

| Option | Default | Meaning |
|---|---|---|
| Back up the database first | On | A real run writes a backup before any change. |
| Precise mode | Off | WP-CLI `--precise`: slower, safer for odd serialized data. |
| Report changed tables only | On | WP-CLI `--report-changed-only`. |
| Do not load plugins / the theme / WP-CLI packages | On | WP-CLI `--skip-plugins`, `--skip-themes`, `--skip-packages`. Faster, and no plugin code runs. They apply to every WP-CLI command of a run, dry run or real. |
| Include http/https, //, escaped and encoded forms | On | The forms in the table above. |
| Keep domains inside e-mail addresses | On | `name@old.example.net` is not changed when the host is. |
| Flush the cache when done | On | `wp cache flush` after a real run. |
| Use the built-in fallback if WP-CLI cannot run | On | See below. |
| Skip columns | empty | Comma separated column names. `guid` is always skipped. |
| Regex flags | empty | Flags for your own regex rows, for example `i`. |
| WordPress path | detect | Set it when WordPress is in an unusual folder. It must be inside the site folder. |
| Workers | 0 (auto) | Parallel WP-CLI processes. Auto is half of your CPUs, at most 4. The most you can set is 8. |

**All tables.** A run always covers all tables of the database, also plugin tables and tables without the WordPress prefix.
There is no per-table option.

## Checks before a run

Errors show under the buttons and block the run. Warnings that need your OK show a tick box. The checks include: no ticked
row, an empty search, a search that starts with `--`, two rows with the same search and different replace text, a regex
that cannot compile, an empty replace text, a very short search, and "no ticked row replaces to this site's Local domain,
and the database still uses another domain".

If a run does not start, the reason is shown under the buttons and written to the log.

## Multisite

Sub-directory and sub-domain networks are supported.

- Domains are read from `wp_blogs`, `wp_site`, `wp_sitemeta` and every sub-site's options.
- Sub-sites run first. The main site and the network tables run last, one step at a time, so the domain WordPress needs
  to start is changed last. A step on the network tables updates the bare host in `wp_blogs`, `wp_site` and the other
  network tables.
- After a real run, `DOMAIN_CURRENT_SITE` in `wp-config.php` is set to the new network domain when the file defines it
  and the new value is a plain host name.
- Only domains are changed. The `path` columns of `wp_blogs` and `wp_site` are not.

## Big databases

- **Pre-scan.** A database over 64 MB is scanned first, in MySQL, to find the tables and columns that contain your search
  text. WP-CLI then touches only those (`--include-columns`). A regex row of your own still runs on every table.
- **Parallel workers.** Groups of tables of similar size run in separate WP-CLI processes. Each table still sees the rows in
  order. One very large table is handled by one process.
- **Backup.** The add-on checks that the disk has enough free space before it starts the dump, and dumps with
  `--single-transaction`.

## If WP-CLI cannot run

When WP-CLI fails to run (a broken phar, a fatal error in a plugin or `wp-config.php`), and **fallback** is on, the add-on
reads the database directly with PHP and mysqli and uses `mysqldump` for the backup. The log says so.

- The fallback cannot change `wp-config.php` or flush the cache. The log tells you what to do by hand.
- A value that holds a serialized PHP object is left as it is, with a warning.
- The number of replacements can be counted differently from WP-CLI. The stored data is the same.

## Logs and history

- **Logs tab:** the live log of the current run, with levels (error, warning, notice, info, command), a filter, search,
  copy, and a list of saved log files. WP-CLI and PHP warnings, notices and errors keep their own level.
- **History tab:** the last 20 runs, dry runs included.
- **Files:** everything is in `<site folder>/search-replace/`:
  - `config.json` the saved list and options;
  - `history.json` the last 20 runs;
  - `logs/` one file per run (`run-…` or `dry-run-…`), and one `activity-<date>.log` per day for scans and refusals.
    A log file stops growing at 10 MB (the app still shows every line);
  - `backups/` the database backups.
- **Clean-up:** logs older than 30 days are removed when a run starts. Backups older than 30 days are removed only after a
  real run that worked, so the last undo is never deleted first.
- These files are private to your user (mode 600) and are never followed through a symbolic link.

## Safety

- A regex is compiled in PHP before any write. A bad pattern stops the run at step 0.
- A dry run changes nothing and makes no backup.
- Cancel stops every running process. A partly written backup is removed.
- An imported database is not trusted:
  - a table name or domain that starts with `--` is refused, because WP-CLI would read it as an option;
  - the network domain is checked before it is written to `wp-config.php`;
  - WP-CLI starts in an empty folder, so a `wp-cli.yml` of the site cannot load code;
  - the WordPress path must be inside the Local site folder.
- WordPress core, `wp-config.php` and must-use plugins still load when WP-CLI runs. That is part of how WP-CLI works.

## Light and dark

The page reads Local's theme from the page and follows it, including when you change it.

## Troubleshooting

| What you see | What it means |
|---|---|
| The add-on is not in the Tools tab | It is not switched on. See **Install**, step 3. |
| The list looks old | Press **Scan site**. The page checks for a changed database when you open it and when you return to Local. A change in content only (no new tables, no new site URL) is not seen. |
| Run or Dry run does nothing | Look under the buttons for a red message. The log also has a "not started" line. The activity log is in `<site folder>/search-replace/logs/`. |
| "Could not scan" | The site is stopped, or its database is not reachable. Start the site. |
| "There is a port conflict with this site's domain" | This comes from Local's router, not from the add-on. Another program holds port 80 or 443. Quit and reopen Local, stop the other program, or choose **Use localhost** in the banner. |
| Clicking the add-on's name in **Preferences → Add-ons → Installed** shows an error | Local builds that page from its own online add-on catalog, and this add-on is not listed there yet. The add-on is not affected. See [docs/marketplace-submission.md](docs/marketplace-submission.md). |
| Dry run shows 0 replacements | No table contains the search text. Check the spelling and the upper and lower case: matching is exact. |

## Known limits

- A scanned row you remove with **Remove** comes back at the next scan. Untick it instead.
- Content that changes without new tables or a new site URL is not seen until you press **Scan site**.
- Tested in Local on macOS. Windows and Linux paths and quoting are handled and covered by unit tests, but not yet tried in Local.
- MariaDB is supported by the code and not yet tested here. MySQL 8.0 and 8.4 are.

## For developers

See [DEVELOPMENT.md](DEVELOPMENT.md) in the repository.

## License

MIT. See [LICENSE](LICENSE). Changes are listed in [CHANGELOG.md](CHANGELOG.md).
