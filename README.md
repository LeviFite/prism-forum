# Prism Forum

Full-stack online media sharing forum with:

- Express + EJS frontend/backend
- SQLite database with seeded placeholder content
- Authentication (signup/login/logout)
- Fully editable user profiles (colors, theme mode, section order, hide sections)
- 30+ standard forum categories and 40+ topic tags
- Threads, comments, media uploads, reviews, profile comment boards
- Fast unified all-media search across threads, media, reviews, users, and categories
- Standard pages: About, Contact, Affiliates, Categories, Search, Help

## Quick Start

Use Node.js 22 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000`

Set `PORT` to use a different port and `SESSION_SECRET` to configure the session signing secret.

## Database

Local development uses a file-backed database at `data/forum.db` (created automatically and seeded on first run). On Vercel, set both of these environment variables to use a free Turso database instead:

- `TURSO_DATABASE_URL` — the database URL (e.g. `libsql://your-db.turso.io`)
- `TURSO_AUTH_TOKEN` — the Turso auth token

When `TURSO_DATABASE_URL` is set, it takes precedence; without it the app always uses the local `data/forum.db` file. `SESSION_SECRET` should be a long random value in production so session cookies are signed securely.

## Deploying to Vercel (free tier)

The repo ships with `api/index.js` and `vercel.json`, which run the Express app as a Vercel serverless function. Notes:

- Do not call `app.listen()` on Vercel; `server.js` skips it automatically when `VERCEL` is set and exports the app instead.
- File uploads on Vercel go to `os.tmpdir()` and are ephemeral — they disappear after each serverless invocation. For persistent uploads, a free Cloudinary account is the intended future option.
- Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `SESSION_SECRET` in the Vercel project's environment variables.
- The app refuses to boot on Vercel without `TURSO_DATABASE_URL` set — it will not silently run on an ephemeral database.

## Releases and GitHub Packages

Download a versioned application archive from [GitHub Releases](https://github.com/LeviFite/prism-forum/releases). Extract the `.tgz` archive, open the extracted `package` directory, then run `npm install` and `npm start`.

The application is also published as `@levifite/prism-forum` on GitHub Packages. [Authenticate to GitHub Packages](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-to-github-packages) with a personal access token (classic) that has `read:packages`, then install and start it:

```bash
npm login --scope=@levifite --auth-type=legacy --registry=https://npm.pkg.github.com
npm install @levifite/prism-forum@1.0.0 --@levifite:registry=https://npm.pkg.github.com
node node_modules/@levifite/prism-forum/server.js
```

The app creates its SQLite database and upload directory inside its installation directory. Back up those directories before replacing or upgrading an installation. Release archives and packages contain application files only; local databases, uploads, credentials, and dependencies are excluded.

Publishing a GitHub release with a tag matching the package version, such as `v1.0.0`, runs the package smoke check and publishes the tested archive to GitHub Packages. The workflow also attaches that archive to the release. Use the workflow's manual run to validate packaging without publishing.

## Seeded Login Accounts

Password for all seeded users: `password123`

- `aurora_admin`
- `pixelpilot`
- `salmonsky`
- `canarybyte`
- `slatewave`
- `modularmint`
