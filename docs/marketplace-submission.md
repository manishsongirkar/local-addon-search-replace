# Listing the add-on in Local's Add-ons marketplace

This file holds what is needed to list **Search & Replace** in Local's add-on library, and ready-to-paste text for it.

## Why clicking the add-on's name shows an error

In **Preferences → Add-ons → Installed**, the name of an add-on opens its **marketplace page**: the description, the
screenshots, the details, the releases. Local does not read that from the files of the add-on. It asks Local's own online
catalog for the add-on by its slug (the query is `addon(slug: "…")`, with `name`, `excerpt`, `avatar`, `categories`,
`developer`, `details { homepage license support repository overview }` and `releases`). An add-on that is installed
by hand is not in that catalog, so the page has nothing to show and Local shows an error.

Nothing in this repository can change that. The add-on itself is not affected: it works, and it is in the **Tools** tab.
The details page appears only after the add-on is **listed** in the catalog. Add-ons such as Notes or Image Optimizer
show details because they are listed.

## How to get listed

Local's staff review submissions. The form is on Local's site: <https://localwp.com/submit-addon/>
(a staff reply in the [Local community forum](https://community.localwp.com/t/how-do-i-submit-my-add-on-to-the-list/22902)
points to it). I could not read the fields of the form, so check them when you open it, and use the text below.
Staff ask that the add-on was tried on the latest version of Local.

### Before you submit

- [ ] The repository is public, with the README, license and changelog.
- [ ] A **release** exists on GitHub with the `.tgz` from `npm pack` attached. Local needs a download address for it.
      Steps: [DEVELOPMENT.md](../DEVELOPMENT.md#packaging-and-releases).
- [ ] The add-on was tried on the latest Local (this was prepared with Local **10.1.2**).
- [ ] Screenshots are ready (see the list below), taken on a **demo site** with made-up names.
- [ ] The issue forms are live, and **Private vulnerability reporting** is on, so the support link works.

## Text for the form

The names below match what the marketplace page shows.

| Field | Value |
|---|---|
| Name | Search & Replace |
| Slug | `search-replace` |
| Version | 0.1.0 (the first release) |
| Developer | Manish Songirkar |
| Type | Add-on (a page in the site's **Tools** tab) |
| Color | `#51bb7b` (the `bgColor` in `package.json`) |
| Icon (avatar) | `icon.svg` in the repository root |
| Local requirement | 10.1.2 or newer (`engines` in `package.json`) |
| Tested up to | Local 10.1.2 |
| License | MIT |
| Homepage | <https://github.com/manishsongirkar/local-addon-search-replace> |
| Repository | <https://github.com/manishsongirkar/local-addon-search-replace> |
| Support | <https://github.com/manishsongirkar/local-addon-search-replace/issues> |
| Download | The `.tgz` attached to the GitHub release |
| Offline support | Yes. The add-on makes no network calls. |
| Local account | Not required |
| Categories | Pick the closest from the list in the form: database, migration, or developer tools |

### Short description (excerpt)

> Move a site's database to its Local domain: scan the domains, dry run, replace, and read the logs. Works with multisite,
> serialized data, regex and very large databases.

### Overview

The marketplace page shows this as Markdown.

```markdown
Search & Replace changes the domains in a Local site's database, with a clear page in the site's **Tools** tab.

**Open the page, check the list, press Dry run, then Run.**

- **Finds every domain in the database** and groups them: the site's main domains (ticked, with your Local URL as the
  replace), close domains such as `api.example.com` (suggested, not ticked), and all the others (not ticked).
- **Suggests `https`** when your Local site has a trusted SSL certificate.
- **Notices a new import.** If you import a database with WP-CLI, phpMyAdmin or the `mysql` command, the page scans again.
- **Replaces every form of a domain:** `http` and `https`, `//host`, JSON-escaped, URL-encoded, and inside serialized data.
  You can also replace a full URL with a path, plain text, or your own regex.
- **Multisite:** sub-directory and sub-domain networks, including `wp_blogs` and `wp_site`.
- **Fast on very large databases:** it finds the tables that contain your domain first, and runs several WP-CLI processes in
  parallel.
- **Safe:** a dry run that lists every changed column, a backup before a real run (with a free-disk check), cancel, and a log
  file for each run.
- **A fallback** when WP-CLI cannot run.
- **Logs and history** inside the page, with levels for errors, warnings and notices.
- Follows Local's **light and dark** theme. The settings are saved per site.

Works with the MySQL and MariaDB versions Local offers. The add-on sends no data anywhere.
```

### What is new in this version (changelog)

> First release. Scan, dry run, run, cancel, logs and history. Grouped domain list with `https` suggestions. Automatic
> scan after a database import. Multisite. Pre-scan and parallel processes for large databases. Built-in fallback when
> WP-CLI cannot run. Light and dark theme.

## Screenshots to take

Take them on a **demo site**. Use made-up names (`my-site.test`, `old.example.net`). Hide any real site name, domain or folder
path. Take them in the dark theme, and one in the light theme. Check the form for the sizes it wants.

1. **The page after a scan:** the three groups of domains, with the main domain ticked and the Local URL as the replace.
2. **A dry run:** the **Logs** tab with the progress bar and lines such as `wp_options.option_value: 10 replacement(s)`.
3. **A finished run:** the progress bar at 100% and the summary.
4. **Options:** the grouped options list.
5. **A multisite network:** the list of main domains for the sub-sites.
6. **The light theme:** the same page as number 1.

Put the finished images where you keep release assets. They are not in the package, and the release ZIP does not need them.
