const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { categories } = require('./constants');
const { seedIfNeeded } = require('./seed');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'forum.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
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
`);

let ftsEnabled = true;
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      kind,
      ref_id UNINDEXED,
      title,
      body,
      author,
      category,
      tokenize='porter unicode61'
    );
  `);
} catch (error) {
  ftsEnabled = false;
}

const upsertCategory = db.prepare(`
  INSERT INTO categories (slug, name, description, icon)
  VALUES (@slug, @name, @description, @icon)
  ON CONFLICT(slug) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    icon = excluded.icon
`);

const syncCategories = db.transaction(() => {
  categories.forEach((category) => {
    upsertCategory.run(category);
  });
});

syncCategories();
const seeded = seedIfNeeded(db);

function addDocument(insertDoc, insertFts, document) {
  const row = insertDoc.run(document);

  if (ftsEnabled) {
    insertFts.run({
      rowid: row.lastInsertRowid,
      ...document
    });
  }
}

function rebuildSearchIndex() {
  const insertDoc = db.prepare(`
    INSERT INTO search_documents (kind, ref_id, title, body, author, category, created_at)
    VALUES (@kind, @ref_id, @title, @body, @author, @category, @created_at)
  `);

  const insertFts = ftsEnabled
    ? db.prepare(`
      INSERT INTO search_index (rowid, kind, ref_id, title, body, author, category)
      VALUES (@rowid, @kind, @ref_id, @title, @body, @author, @category)
    `)
    : null;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM search_documents').run();

    if (ftsEnabled) {
      db.prepare('DELETE FROM search_index').run();
    }

    db.prepare('SELECT slug, name, description FROM categories ORDER BY name').all().forEach((category) => {
      addDocument(insertDoc, insertFts, {
        kind: 'category',
        ref_id: category.slug,
        title: category.name,
        body: category.description,
        author: 'system',
        category: category.slug,
        created_at: new Date().toISOString()
      });
    });

    db.prepare(`
      SELECT id, username, display_name, headline, bio, created_at
      FROM users
      ORDER BY id
    `)
      .all()
      .forEach((user) => {
        addDocument(insertDoc, insertFts, {
          kind: 'user',
          ref_id: String(user.id),
          title: user.display_name,
          body: `${user.headline || ''} ${user.bio || ''}`.trim(),
          author: user.username,
          category: 'profiles',
          created_at: user.created_at
        });
      });

    db.prepare(`
      SELECT t.id, t.title, t.body, t.category_slug, t.created_at, u.username
      FROM threads t
      JOIN users u ON u.id = t.user_id
      ORDER BY t.id
    `)
      .all()
      .forEach((thread) => {
        addDocument(insertDoc, insertFts, {
          kind: 'thread',
          ref_id: String(thread.id),
          title: thread.title,
          body: thread.body,
          author: thread.username,
          category: thread.category_slug,
          created_at: thread.created_at
        });
      });

    db.prepare(`
      SELECT r.id, r.title, r.body, r.created_at, u.username
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      ORDER BY r.id
    `)
      .all()
      .forEach((review) => {
        addDocument(insertDoc, insertFts, {
          kind: 'review',
          ref_id: String(review.id),
          title: review.title,
          body: review.body,
          author: review.username,
          category: 'reviews',
          created_at: review.created_at
        });
      });

    db.prepare(`
      SELECT m.id, m.title, m.description, m.created_at, u.username, m.media_type
      FROM media_posts m
      JOIN users u ON u.id = m.user_id
      ORDER BY m.id
    `)
      .all()
      .forEach((media) => {
        addDocument(insertDoc, insertFts, {
          kind: 'media',
          ref_id: String(media.id),
          title: media.title,
          body: `${media.media_type} ${media.description}`,
          author: media.username,
          category: 'media',
          created_at: media.created_at
        });
      });
  });

  tx();
}

function toFtsQuery(text) {
  const tokens = (text.toLowerCase().match(/[a-z0-9_'-]+/g) || [])
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 12);

  return tokens.map((token) => `${token.replace(/'/g, "''")}*`).join(' OR ');
}

function searchAll(query, limit = 24, offset = 0) {
  const term = (query || '').trim();
  if (!term) {
    return { total: 0, results: [] };
  }

  if (ftsEnabled) {
    const ftsQuery = toFtsQuery(term);

    if (ftsQuery) {
      try {
        const results = db
          .prepare(`
            SELECT d.kind, d.ref_id, d.title, d.body, d.author, d.category, d.created_at
            FROM search_index s
            JOIN search_documents d ON d.id = s.rowid
            WHERE s MATCH ?
            ORDER BY bm25(s), datetime(d.created_at) DESC
            LIMIT ? OFFSET ?
          `)
          .all(ftsQuery, limit, offset);

        const total = db
          .prepare(`
            SELECT COUNT(*) AS count
            FROM search_index s
            WHERE s MATCH ?
          `)
          .get(ftsQuery).count;

        return { total, results };
      } catch (error) {
        // Fall back to LIKE search for malformed FTS expressions.
      }
    }
  }

  const like = `%${term}%`;
  const whereClause = `
    title LIKE @like OR
    body LIKE @like OR
    author LIKE @like OR
    category LIKE @like
  `;

  const results = db
    .prepare(`
      SELECT kind, ref_id, title, body, author, category, created_at
      FROM search_documents
      WHERE ${whereClause}
      ORDER BY datetime(created_at) DESC
      LIMIT @limit OFFSET @offset
    `)
    .all({ like, limit, offset });

  const total = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM search_documents
      WHERE ${whereClause}
    `)
    .get({ like }).count;

  return { total, results };
}

rebuildSearchIndex();

module.exports = {
  db,
  seeded,
  categories,
  ftsEnabled,
  rebuildSearchIndex,
  searchAll
};
