const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const { categories } = require('./constants');
const { seedIfNeeded } = require('./seed');

function resolveDatabaseUrl() {
  // Turso (recommended for Vercel): set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.
  if (process.env.TURSO_DATABASE_URL) {
    return process.env.TURSO_DATABASE_URL;
  }

  // Local dev keeps using a repo-local SQLite file, exactly like before.
  // On Vercel the filesystem is ephemeral, so a local file database is not
  // viable there: fail fast with a clear message instead of silently booting
  // an empty database that vanishes between invocations.
  if (process.env.VERCEL) {
    throw new Error(
      'TURSO_DATABASE_URL is required on Vercel. Create a free Turso database and set ' +
        'TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the Vercel project environment variables.'
    );
  }

  const dir = path.join(__dirname, '..', 'data');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return `file:${path.join(dir, 'forum.db')}`;
}

const client = createClient({
  url: resolveDatabaseUrl(),
  authToken: process.env.TURSO_AUTH_TOKEN || undefined
});

function toJs(value) {
  if (typeof value === 'bigint') {
    const num = Number(value);
    return Number.isSafeInteger(num) ? num : value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return value;
}

function normalizeRow(row) {
  if (Array.isArray(row)) {
    return row.map(toJs);
  }
  const out = {};
  for (const key of Object.keys(row)) {
    out[key] = toJs(row[key]);
  }
  return out;
}

async function get(sql, args = []) {
  const rs = await client.execute({ sql, args });
  const row = rs.rows[0];
  return row === undefined ? undefined : normalizeRow(row);
}

async function all(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return rs.rows.map(normalizeRow);
}

async function run(sql, args = []) {
  const rs = await client.execute({ sql, args });
  const id = rs.lastInsertRowid;
  return {
    changes: Number(rs.rowsAffected || 0),
    lastInsertRowid: id === undefined || id === null ? undefined : toJs(id)
  };
}

async function batch(statements) {
  if (!statements.length) {
    return [];
  }
  return client.batch(statements);
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS categories (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    headline TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    avatar_url TEXT DEFAULT 'https://placehold.co/240x240/png?text=Avatar',
    theme_mode TEXT DEFAULT 'light',
    accent_color TEXT DEFAULT '#FA8072',
    background_color TEXT DEFAULT '#fff7f8',
    card_color TEXT DEFAULT '#ffffff',
    text_color TEXT DEFAULT '#3f4a56',
    title_font TEXT DEFAULT '"Baloo 2"',
    body_font TEXT DEFAULT '"Montserrat"',
    section_order TEXT DEFAULT 'about,activity,media,reviews,comment_board',
    hide_activity INTEGER DEFAULT 0,
    hide_media INTEGER DEFAULT 0,
    hide_reviews INTEGER DEFAULT 0,
    hide_comment_board INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category_slug TEXT NOT NULL,
    topic_tag TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'text',
    media_url TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(category_slug) REFERENCES categories(slug)
  );

  CREATE TABLE IF NOT EXISTS thread_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(thread_id) REFERENCES threads(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    rating INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS media_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    media_type TEXT NOT NULL,
    media_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS profile_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_user_id INTEGER NOT NULL,
    author_user_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(profile_user_id) REFERENCES users(id),
    FOREIGN KEY(author_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS search_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author TEXT NOT NULL,
    category TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_threads_category ON threads(category_slug);
  CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id);
  CREATE INDEX IF NOT EXISTS idx_thread_comments_thread ON thread_comments(thread_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
  CREATE INDEX IF NOT EXISTS idx_media_user ON media_posts(user_id);
  CREATE INDEX IF NOT EXISTS idx_profile_comments_profile ON profile_comments(profile_user_id);
  CREATE INDEX IF NOT EXISTS idx_search_documents_kind_ref ON search_documents(kind, ref_id);
`;

const FTS_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    kind,
    ref_id UNINDEXED,
    title,
    body,
    author,
    category,
    tokenize='porter unicode61'
  );
`;

const UPSERT_CATEGORY_SQL = `
  INSERT INTO categories (slug, name, description, icon)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(slug) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    icon = excluded.icon
`;

let ftsEnabled = true;
let initialized = false;
let didSeed = false;

function isFtsEnabled() {
  return ftsEnabled;
}

async function syncCategories() {
  await batch(
    categories.map((category) => ({
      sql: UPSERT_CATEGORY_SQL,
      args: [category.slug, category.name, category.description, category.icon]
    }))
  );
}

async function rebuildSearchIndex() {
  const docs = [];

  const categoryRows = await all('SELECT slug, name, description FROM categories ORDER BY name');
  categoryRows.forEach((category) => {
    docs.push({
      kind: 'category',
      ref_id: category.slug,
      title: category.name,
      body: category.description,
      author: 'system',
      category: category.slug,
      created_at: new Date().toISOString()
    });
  });

  const userRows = await all(
    'SELECT id, username, display_name, headline, bio, created_at FROM users ORDER BY id'
  );
  userRows.forEach((user) => {
    docs.push({
      kind: 'user',
      ref_id: String(user.id),
      title: user.display_name,
      body: `${user.headline || ''} ${user.bio || ''}`.trim(),
      author: user.username,
      category: 'profiles',
      created_at: user.created_at
    });
  });

  const threadRows = await all(
    `SELECT t.id, t.title, t.body, t.category_slug, t.created_at, u.username
     FROM threads t
     JOIN users u ON u.id = t.user_id
     ORDER BY t.id`
  );
  threadRows.forEach((thread) => {
    docs.push({
      kind: 'thread',
      ref_id: String(thread.id),
      title: thread.title,
      body: thread.body,
      author: thread.username,
      category: thread.category_slug,
      created_at: thread.created_at
    });
  });

  const reviewRows = await all(
    `SELECT r.id, r.title, r.body, r.created_at, u.username
     FROM reviews r
     JOIN users u ON u.id = r.user_id
     ORDER BY r.id`
  );
  reviewRows.forEach((review) => {
    docs.push({
      kind: 'review',
      ref_id: String(review.id),
      title: review.title,
      body: review.body,
      author: review.username,
      category: 'reviews',
      created_at: review.created_at
    });
  });

  const mediaRows = await all(
    `SELECT m.id, m.title, m.description, m.created_at, u.username, m.media_type
     FROM media_posts m
     JOIN users u ON u.id = m.user_id
     ORDER BY m.id`
  );
  mediaRows.forEach((media) => {
    docs.push({
      kind: 'media',
      ref_id: String(media.id),
      title: media.title,
      body: `${media.media_type} ${media.description}`,
      author: media.username,
      category: 'media',
      created_at: media.created_at
    });
  });

  const statements = [{ sql: 'DELETE FROM search_documents', args: [] }];
  if (ftsEnabled) {
    statements.push({ sql: 'DELETE FROM search_index', args: [] });
  }
  docs.forEach((doc) => {
    statements.push({
      sql: `INSERT INTO search_documents (kind, ref_id, title, body, author, category, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [doc.kind, doc.ref_id, doc.title, doc.body, doc.author, doc.category, doc.created_at]
    });
  });
  await batch(statements);

  if (ftsEnabled && docs.length) {
    // Rows come back in insertion order, matching the docs array.
    const idRows = await all('SELECT id FROM search_documents ORDER BY id');
    await batch(
      idRows.map((row, index) => ({
        sql: 'INSERT INTO search_index (rowid, kind, ref_id, title, body, author, category) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [
          row.id,
          docs[index].kind,
          docs[index].ref_id,
          docs[index].title,
          docs[index].body,
          docs[index].author,
          docs[index].category
        ]
      }))
    );
  }
}

function toFtsQuery(text) {
  const tokens = (text.toLowerCase().match(/[a-z0-9_'-]+/g) || [])
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 12);

  return tokens.map((token) => `${token.replace(/'/g, "''")}*`).join(' OR ');
}

async function searchAll(query, limit = 24, offset = 0) {
  const term = (query || '').trim();
  if (!term) {
    return { total: 0, results: [] };
  }

  if (ftsEnabled) {
    const ftsQuery = toFtsQuery(term);

    if (ftsQuery) {
      try {
        const results = await all(
          `SELECT d.kind, d.ref_id, d.title, d.body, d.author, d.category, d.created_at
           FROM search_index s
           JOIN search_documents d ON d.id = s.rowid
           WHERE s MATCH ?
           ORDER BY bm25(s), datetime(d.created_at) DESC
           LIMIT ? OFFSET ?`,
          [ftsQuery, limit, offset]
        );

        const totalRow = await get(
          'SELECT COUNT(*) AS count FROM search_index s WHERE s MATCH ?',
          [ftsQuery]
        );

        return { total: totalRow ? totalRow.count : 0, results };
      } catch (error) {
        // Fall back to LIKE search for malformed FTS expressions.
      }
    }
  }

  const like = `%${term}%`;
  const whereArgs = [like, like, like, like];

  const results = await all(
    `SELECT kind, ref_id, title, body, author, category, created_at
     FROM search_documents
     WHERE title LIKE ? OR body LIKE ? OR author LIKE ? OR category LIKE ?
     ORDER BY datetime(created_at) DESC
     LIMIT ? OFFSET ?`,
    [...whereArgs, limit, offset]
  );

  const totalRow = await get(
    `SELECT COUNT(*) AS count
     FROM search_documents
     WHERE title LIKE ? OR body LIKE ? OR author LIKE ? OR category LIKE ?`,
    whereArgs
  );

  return { total: totalRow ? totalRow.count : 0, results };
}

async function initDb() {
  if (initialized) {
    return { seeded: didSeed };
  }

  await client.executeMultiple(SCHEMA_SQL);

  try {
    await client.execute(FTS_SQL);
  } catch (error) {
    ftsEnabled = false;
  }

  await syncCategories();
  didSeed = await seedIfNeeded({ get, all, batch });
  await rebuildSearchIndex();

  initialized = true;
  return { seeded: didSeed };
}

module.exports = {
  initDb,
  get,
  all,
  run,
  batch,
  rebuildSearchIndex,
  searchAll,
  categories,
  isFtsEnabled
};
