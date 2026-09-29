const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const session = require('cookie-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const db = require('./src/db');
const { initDb, get: dbGet, all: dbAll, run: dbRun } = db;
const { forumTopics } = require('./src/constants');
const { requireAuth } = require('./src/auth');

// Wraps async route handlers so rejected promises reach Express error handling
// (Express 4 does not do this automatically).
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_FONTS = new Set([
  '"Baloo 2"',
  '"Pacifico"',
  '"Caveat"',
  '"Montserrat"',
  '"Nunito"',
  '"Poppins"',
  '"Work Sans"'
]);

// NOTE: Vercel's filesystem is read-only except os.tmpdir(), and files written
// there are ephemeral (they vanish between serverless invocations). Uploads keep
// working within a request, but for permanent file storage the future option is a
// free cloud service such as the Cloudinary free tier instead of local disk.
const uploadDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'prism-forum-uploads')
  : path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}_${Math.floor(Math.random() * 1e6)}_${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/');
    cb(null, allowed);
  }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// cookie-session stores the (tiny) session in a signed cookie, so logins survive
// serverless invocations where an in-memory session store would not.
app.use(
  session({
    name: 'prism-forum-session',
    keys: [process.env.SESSION_SECRET || 'forum-secret-change-me'],
    maxAge: 1000 * 60 * 60 * 24 * 14,
    sameSite: 'lax'
  })
);

app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

function parsePage(input) {
  const page = Number.parseInt(input, 10);
  return Number.isNaN(page) || page < 1 ? 1 : page;
}

function paginate(totalItems, currentPage, pageSize) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(currentPage, totalPages);
  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    offset: (page - 1) * pageSize,
    hasPrev: page > 1,
    hasNext: page < totalPages
  };
}

function formatDate(value) {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function safeHex(value, fallback) {
  const input = (value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(input) ? input : fallback;
}

function clampText(value, maxLength) {
  return (value || '').trim().slice(0, maxLength);
}

function safeFont(value, fallback) {
  const input = clampText(value, 80);
  return ALLOWED_FONTS.has(input) ? input : fallback;
}

function getSectionOrder(raw) {
  const allowed = ['about', 'activity', 'media', 'reviews', 'comment_board'];
  const listed = (raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => allowed.includes(value));

  const unique = [...new Set(listed)];
  allowed.forEach((entry) => {
    if (!unique.includes(entry)) {
      unique.push(entry);
    }
  });

  return unique;
}

function mapSearchResult(result) {
  let url = '/search';

  if (result.kind === 'thread') {
    url = `/threads/${result.ref_id}`;
  } else if (result.kind === 'review') {
    url = `/reviews#review-${result.ref_id}`;
  } else if (result.kind === 'media') {
    url = `/media#media-${result.ref_id}`;
  } else if (result.kind === 'user') {
    url = `/profile/${result.author}`;
  } else if (result.kind === 'category') {
    url = `/categories/${result.ref_id}`;
  }

  return {
    ...result,
    url,
    excerpt: result.body.length > 180 ? `${result.body.slice(0, 177)}...` : result.body
  };
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

app.use(
  ah(async (req, res, next) => {
    const flash = req.session.flash || null;
    delete req.session.flash;

    let currentUser = null;
    if (req.session.userId) {
      currentUser = await dbGet(
        `
          SELECT id, username, email, display_name, headline, bio, avatar_url,
                 theme_mode, accent_color, background_color, card_color, text_color,
                 title_font, body_font, section_order,
                 hide_activity, hide_media, hide_reviews, hide_comment_board,
                 created_at
          FROM users
          WHERE id = ?
        `,
        [req.session.userId]
      );

      if (!currentUser) {
        req.session.userId = null;
      }
    }

  res.locals.currentUser = currentUser;
  res.locals.flash = flash;
  res.locals.categories = db.categories;
  res.locals.forumTopics = forumTopics;
  res.locals.formatDate = formatDate;
  res.locals.ftsEnabled = db.isFtsEnabled();
  res.locals.nowYear = new Date().getFullYear();
  res.locals.themeClass = currentUser && currentUser.theme_mode === 'dark' ? 'theme-dark' : 'theme-light';

  const profileStyle = currentUser
    ? {
        accent: safeHex(currentUser.accent_color, '#FA8072'),
        background: safeHex(currentUser.background_color, '#fff7f8'),
        card: safeHex(currentUser.card_color, '#ffffff'),
        text: safeHex(currentUser.text_color, '#3f4a56'),
        titleFont: safeFont(currentUser.title_font, '"Baloo 2"'),
        bodyFont: safeFont(currentUser.body_font, '"Montserrat"')
      }
    : {
        accent: '#FA8072',
        background: '#fff7f8',
        card: '#ffffff',
        text: '#3f4a56',
        titleFont: '"Baloo 2"',
        bodyFont: '"Montserrat"'
      };

  res.locals.profileStyle = profileStyle;

    next();
  })
);

app.get(
  '/',
  ah(async (req, res) => {
    const page = parsePage(req.query.page);
    const pageSize = 12;

    const totalThreads = (await dbGet('SELECT COUNT(*) AS count FROM threads')).count;
    const paging = paginate(totalThreads, page, pageSize);

    const threads = await dbAll(
      `
        SELECT
          t.id,
          t.category_slug,
          t.topic_tag,
          t.title,
          t.body,
          t.media_type,
          t.media_url,
          t.created_at,
          u.username,
          u.display_name,
          c.name AS category_name,
          (SELECT COUNT(*) FROM thread_comments tc WHERE tc.thread_id = t.id) AS comment_count
        FROM threads t
        JOIN users u ON u.id = t.user_id
        JOIN categories c ON c.slug = t.category_slug
        ORDER BY datetime(t.created_at) DESC
        LIMIT ? OFFSET ?
      `,
      [pageSize, paging.offset]
    );

    const latestMedia = await dbAll(
      `
        SELECT m.id, m.title, m.media_type, m.media_url, u.username
        FROM media_posts m
        JOIN users u ON u.id = m.user_id
        ORDER BY datetime(m.created_at) DESC
        LIMIT 8
      `
    );

    const stats = {
      users: (await dbGet('SELECT COUNT(*) AS count FROM users')).count,
      threads: totalThreads,
      reviews: (await dbGet('SELECT COUNT(*) AS count FROM reviews')).count,
      media: (await dbGet('SELECT COUNT(*) AS count FROM media_posts')).count
    };

    res.render('home', { threads, latestMedia, paging, stats, pageTitle: 'Forum Home' });
  })
);

app.get('/auth', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }

  return res.render('auth', { pageTitle: 'Login & Sign Up' });
});

app.post(
  '/auth/signup',
  ah(async (req, res) => {
    const username = clampText(req.body.username, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const email = clampText(req.body.email, 100).toLowerCase();
    const password = String(req.body.password || '');
    const displayName = clampText(req.body.display_name, 60);

    if (!username || !email.includes('@') || !displayName || password.length < 6) {
      setFlash(req, 'danger', 'Sign up failed. Username, email, display name, and a 6+ character password are required.');
      return res.redirect('/auth');
    }

    try {
      const hash = bcrypt.hashSync(password, 10);
      const result = await dbRun(
        `
          INSERT INTO users (
            username, email, password_hash, display_name, headline, bio, avatar_url,
            theme_mode, accent_color, background_color, card_color, text_color,
            title_font, body_font, section_order,
            hide_activity, hide_media, hide_reviews, hide_comment_board, created_at
          ) VALUES (?, ?, ?, ?, '', '', ?, 'light', '#FA8072', '#fff7f8', '#ffffff', '#3f4a56',
                    '"Baloo 2"', '"Montserrat"', 'about,activity,media,reviews,comment_board',
                    0, 0, 0, 0, ?)
        `,
        [
          username,
          email,
          hash,
          displayName,
          `https://placehold.co/240x240/png?text=${encodeURIComponent(displayName.split(' ')[0] || 'Avatar')}`,
          new Date().toISOString()
        ]
      );

      req.session.userId = result.lastInsertRowid;
      await db.rebuildSearchIndex();
      setFlash(req, 'success', 'Account created successfully.');

      return res.redirect(`/profile/${username}`);
    } catch (error) {
      setFlash(req, 'danger', 'Could not create account. Username or email may already exist.');
      return res.redirect('/auth');
    }
  })
);

app.post(
  '/auth/login',
  ah(async (req, res) => {
    const identity = clampText(req.body.identity, 100).toLowerCase();
    const password = String(req.body.password || '');

    const user = await dbGet('SELECT id, username, password_hash FROM users WHERE username = ? OR email = ?', [
      identity,
      identity
    ]);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      setFlash(req, 'danger', 'Invalid login credentials.');
      return res.redirect('/auth');
    }

    req.session.userId = user.id;
    setFlash(req, 'success', `Welcome back, ${user.username}.`);
    return res.redirect('/');
  })
);

app.post('/auth/logout', (req, res) => {
  // cookie-session has no destroy(); clearing the session object drops the cookie.
  req.session = null;
  res.redirect('/');
});

app.get(
  '/categories',
  ah(async (req, res) => {
    const categoryRows = await dbAll(
      `
        SELECT c.slug, c.name, c.description, c.icon, COUNT(t.id) AS thread_count
        FROM categories c
        LEFT JOIN threads t ON t.category_slug = c.slug
        GROUP BY c.slug
        ORDER BY c.name ASC
      `
    );

    res.render('categories', {
      pageTitle: 'All Categories',
      categoryRows
    });
  })
);

app.get(
  '/categories/:slug',
  ah(async (req, res) => {
    const category = await dbGet('SELECT * FROM categories WHERE slug = ?', [req.params.slug]);

    if (!category) {
      return res.status(404).render('404', { pageTitle: 'Category Not Found' });
    }

    const page = parsePage(req.query.page);
    const pageSize = 12;

    const total = (await dbGet('SELECT COUNT(*) AS count FROM threads WHERE category_slug = ?', [category.slug]))
      .count;
    const paging = paginate(total, page, pageSize);

    const threads = await dbAll(
      `
        SELECT
          t.id,
          t.title,
          t.body,
          t.topic_tag,
          t.media_type,
          t.media_url,
          t.created_at,
          u.username,
          u.display_name,
          (SELECT COUNT(*) FROM thread_comments tc WHERE tc.thread_id = t.id) AS comment_count
        FROM threads t
        JOIN users u ON u.id = t.user_id
        WHERE t.category_slug = ?
        ORDER BY datetime(t.created_at) DESC
        LIMIT ? OFFSET ?
      `,
      [category.slug, pageSize, paging.offset]
    );

    return res.render('category', {
      pageTitle: `${category.name} Threads`,
      category,
      threads,
      paging
    });
  })
);

app.get(
  '/threads/:id',
  ah(async (req, res) => {
    const thread = await dbGet(
      `
        SELECT
          t.id,
          t.title,
          t.body,
          t.topic_tag,
          t.media_type,
          t.media_url,
          t.created_at,
          t.category_slug,
          c.name AS category_name,
          u.username,
          u.display_name,
          u.avatar_url
        FROM threads t
        JOIN users u ON u.id = t.user_id
        JOIN categories c ON c.slug = t.category_slug
        WHERE t.id = ?
      `,
      [req.params.id]
    );

    if (!thread) {
      return res.status(404).render('404', { pageTitle: 'Thread Not Found' });
    }

    const comments = await dbAll(
      `
        SELECT tc.id, tc.body, tc.created_at, u.username, u.display_name, u.avatar_url
        FROM thread_comments tc
        JOIN users u ON u.id = tc.user_id
        WHERE tc.thread_id = ?
        ORDER BY datetime(tc.created_at) DESC
      `,
      [thread.id]
    );

    const related = await dbAll(
      `
        SELECT t.id, t.title, t.topic_tag
        FROM threads t
        WHERE t.category_slug = ? AND t.id != ?
        ORDER BY datetime(t.created_at) DESC
        LIMIT 6
      `,
      [thread.category_slug, thread.id]
    );

    return res.render('thread', {
      pageTitle: thread.title,
      thread,
      comments,
      related
    });
  })
);

app.post(
  '/threads',
  requireAuth,
  ah(async (req, res) => {
    const categorySlug = clampText(req.body.category_slug, 50);
    const topicTag = clampText(req.body.topic_tag, 80) || 'General';
    const title = clampText(req.body.title, 140);
    const body = clampText(req.body.body, 12000);
    const mediaType = ['text', 'image', 'video'].includes(req.body.media_type) ? req.body.media_type : 'text';
    const mediaUrl = clampText(req.body.media_url, 500);

    if (!categorySlug || !title || !body) {
      setFlash(req, 'danger', 'Thread title, body, and category are required.');
      return res.redirect('/');
    }

    const categoryExists = await dbGet('SELECT slug FROM categories WHERE slug = ?', [categorySlug]);
    if (!categoryExists) {
      setFlash(req, 'danger', 'Invalid category selection.');
      return res.redirect('/');
    }

    const result = await dbRun(
      `
        INSERT INTO threads (user_id, category_slug, topic_tag, title, body, media_type, media_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        req.session.userId,
        categorySlug,
        topicTag,
        title,
        body,
        mediaType,
        mediaType === 'text' ? null : mediaUrl || null,
        new Date().toISOString()
      ]
    );

    await db.rebuildSearchIndex();
    setFlash(req, 'success', 'Thread published.');
    return res.redirect(`/threads/${result.lastInsertRowid}`);
  })
);

app.post(
  '/threads/:id/comments',
  requireAuth,
  ah(async (req, res) => {
    const body = clampText(req.body.body, 5000);
    const thread = await dbGet('SELECT id FROM threads WHERE id = ?', [req.params.id]);

    if (!thread || !body) {
      setFlash(req, 'danger', 'Unable to post comment.');
      return res.redirect(`/threads/${req.params.id}`);
    }

    await dbRun('INSERT INTO thread_comments (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', [
      thread.id,
      req.session.userId,
      body,
      new Date().toISOString()
    ]);

    return res.redirect(`/threads/${thread.id}#comments`);
  })
);

app.get(
  '/reviews',
  ah(async (req, res) => {
    const page = parsePage(req.query.page);
    const pageSize = 15;
    const total = (await dbGet('SELECT COUNT(*) AS count FROM reviews')).count;
    const paging = paginate(total, page, pageSize);

    const reviews = await dbAll(
      `
        SELECT r.id, r.title, r.body, r.rating, r.created_at, u.username, u.display_name, u.avatar_url
        FROM reviews r
        JOIN users u ON u.id = r.user_id
        ORDER BY datetime(r.created_at) DESC
        LIMIT ? OFFSET ?
      `,
      [pageSize, paging.offset]
    );

    res.render('reviews', {
      pageTitle: 'Community Reviews',
      reviews,
      paging
    });
  })
);

app.post(
  '/reviews',
  requireAuth,
  ah(async (req, res) => {
    const title = clampText(req.body.title, 120);
    const body = clampText(req.body.body, 7000);
    const rating = Math.max(1, Math.min(5, Number.parseInt(req.body.rating, 10) || 1));

    if (!title || !body) {
      setFlash(req, 'danger', 'Review title and body are required.');
      return res.redirect('/reviews');
    }

    await dbRun('INSERT INTO reviews (user_id, title, body, rating, created_at) VALUES (?, ?, ?, ?, ?)', [
      req.session.userId,
      title,
      body,
      rating,
      new Date().toISOString()
    ]);

    await db.rebuildSearchIndex();
    setFlash(req, 'success', 'Review posted.');
    return res.redirect('/reviews');
  })
);

app.get(
  '/media',
  ah(async (req, res) => {
    const page = parsePage(req.query.page);
    const pageSize = 16;
    const total = (await dbGet('SELECT COUNT(*) AS count FROM media_posts')).count;
    const paging = paginate(total, page, pageSize);

    const mediaPosts = await dbAll(
      `
        SELECT
          m.id,
          m.title,
          m.description,
          m.media_type,
          m.media_url,
          m.created_at,
          u.username,
          u.display_name
        FROM media_posts m
        JOIN users u ON u.id = m.user_id
        ORDER BY datetime(m.created_at) DESC
        LIMIT ? OFFSET ?
      `,
      [pageSize, paging.offset]
    );

    return res.render('media', {
      pageTitle: 'Media Library',
      mediaPosts,
      paging
    });
  })
);

app.post(
  '/media/upload',
  requireAuth,
  upload.single('media_file'),
  ah(async (req, res) => {
    const title = clampText(req.body.title, 120);
    const description = clampText(req.body.description, 6000);
    const inputType = req.body.media_type === 'video' ? 'video' : 'image';
    const urlInput = clampText(req.body.media_url, 500);

    if (!title || !description) {
      setFlash(req, 'danger', 'Media title and description are required.');
      return res.redirect('/media');
    }

    let mediaType = inputType;
    let mediaUrl = urlInput;

    if (req.file) {
      mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
      mediaUrl = `/uploads/${req.file.filename}`;
    }

    if (!mediaUrl) {
      setFlash(req, 'danger', 'Provide a media URL or upload a file.');
      return res.redirect('/media');
    }

    await dbRun(
      `
        INSERT INTO media_posts (user_id, title, description, media_type, media_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [req.session.userId, title, description, mediaType, mediaUrl, new Date().toISOString()]
    );

    await db.rebuildSearchIndex();
    setFlash(req, 'success', 'Media item published.');
    return res.redirect('/media');
  })
);

app.get(
  '/search',
  ah(async (req, res) => {
    const query = clampText(req.query.q, 160);
    const page = parsePage(req.query.page);
    const pageSize = 18;

    let results = [];
    let paging = null;

    if (query) {
      const found = await db.searchAll(query, pageSize, (page - 1) * pageSize);
      results = found.results.map(mapSearchResult);
      paging = paginate(found.total, page, pageSize);
    }

    return res.render('search', {
      pageTitle: 'All Media Search',
      query,
      results,
      paging
    });
  })
);

app.get(
  '/api/search',
  ah(async (req, res) => {
    const query = clampText(req.query.q, 160);
    const page = parsePage(req.query.page);
    const pageSize = 20;

    const found = await db.searchAll(query, pageSize, (page - 1) * pageSize);

    res.json({
      query,
      page,
      pageSize,
      total: found.total,
      results: found.results.map(mapSearchResult)
    });
  })
);

app.get('/about', (_req, res) => {
  res.render('about', { pageTitle: 'About Us' });
});

app.get('/contact', (_req, res) => {
  res.render('contact', { pageTitle: 'Contact' });
});

app.post(
  '/contact',
  ah(async (req, res) => {
    const name = clampText(req.body.name, 100);
    const email = clampText(req.body.email, 100);
    const subject = clampText(req.body.subject, 150);
    const message = clampText(req.body.message, 5000);

    if (!name || !email || !subject || !message) {
      setFlash(req, 'danger', 'All contact form fields are required.');
      return res.redirect('/contact');
    }

    await dbRun('INSERT INTO contact_messages (name, email, subject, message, created_at) VALUES (?, ?, ?, ?, ?)', [
      name,
      email,
      subject,
      message,
      new Date().toISOString()
    ]);

    setFlash(req, 'success', 'Message sent. We will follow up soon.');
    return res.redirect('/contact');
  })
);

app.get('/affiliates', (_req, res) => {
  res.render('affiliates', { pageTitle: 'Affiliate Sites' });
});

app.get('/help', (_req, res) => {
  res.render('help', { pageTitle: 'Help Center' });
});

app.get(
  '/profile/:username',
  ah(async (req, res) => {
    const profileRow = await dbGet(
      `
        SELECT
          id,
          username,
          email,
          display_name,
          headline,
          bio,
          avatar_url,
          theme_mode,
          accent_color,
          background_color,
          card_color,
          text_color,
          title_font,
          body_font,
          section_order,
          hide_activity,
          hide_media,
          hide_reviews,
          hide_comment_board,
          created_at
        FROM users
        WHERE username = ?
      `,
      [req.params.username.toLowerCase()]
    );

    if (!profileRow) {
      return res.status(404).render('404', { pageTitle: 'Profile Not Found' });
    }

    const profile = {
      ...profileRow,
      accent_color: safeHex(profileRow.accent_color, '#FA8072'),
      background_color: safeHex(profileRow.background_color, '#fff7f8'),
      card_color: safeHex(profileRow.card_color, '#ffffff'),
      text_color: safeHex(profileRow.text_color, '#3f4a56'),
      title_font: safeFont(profileRow.title_font, '"Baloo 2"'),
      body_font: safeFont(profileRow.body_font, '"Montserrat"')
    };

    const recentThreads = await dbAll(
      `
        SELECT id, title, topic_tag, created_at
        FROM threads
        WHERE user_id = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 12
      `,
      [profile.id]
    );

    const recentMedia = await dbAll(
      `
        SELECT id, title, media_type, media_url, created_at
        FROM media_posts
        WHERE user_id = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 12
      `,
      [profile.id]
    );

    const recentReviews = await dbAll(
      `
        SELECT id, title, rating, body, created_at
        FROM reviews
        WHERE user_id = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 12
      `,
      [profile.id]
    );

    const activity = await dbAll(
      `
        SELECT *
        FROM (
          SELECT 'thread' AS type, id AS ref_id, title AS label, created_at
          FROM threads
          WHERE user_id = ?
          UNION ALL
          SELECT 'media' AS type, id AS ref_id, title AS label, created_at
          FROM media_posts
          WHERE user_id = ?
          UNION ALL
          SELECT 'review' AS type, id AS ref_id, title AS label, created_at
          FROM reviews
          WHERE user_id = ?
        )
        ORDER BY datetime(created_at) DESC
        LIMIT 30
      `,
      [profile.id, profile.id, profile.id]
    );

    const commentBoard = await dbAll(
      `
        SELECT pc.id, pc.body, pc.created_at, u.username, u.display_name, u.avatar_url
        FROM profile_comments pc
        JOIN users u ON u.id = pc.author_user_id
        WHERE pc.profile_user_id = ?
        ORDER BY datetime(pc.created_at) DESC
        LIMIT 50
      `,
      [profile.id]
    );

    const order = getSectionOrder(profile.section_order);
    const hidden = {
      activity: Boolean(profile.hide_activity),
      media: Boolean(profile.hide_media),
      reviews: Boolean(profile.hide_reviews),
      comment_board: Boolean(profile.hide_comment_board),
      about: false
    };

    const visibleSections = order.filter((section) => !hidden[section]);

    return res.render('profile', {
      pageTitle: `${profile.display_name} Profile`,
      profile,
      recentThreads,
      recentMedia,
      recentReviews,
      activity,
      commentBoard,
      visibleSections,
      isOwner: req.session.userId === profile.id
    });
  })
);

app.post(
  '/profile/:username/comment-board',
  requireAuth,
  ah(async (req, res) => {
    const profile = await dbGet('SELECT id, username, hide_comment_board FROM users WHERE username = ?', [
      req.params.username.toLowerCase()
    ]);

    if (!profile) {
      return res.status(404).render('404', { pageTitle: 'Profile Not Found' });
    }

    if (profile.hide_comment_board) {
      setFlash(req, 'warning', 'This user has hidden their comment board.');
      return res.redirect(`/profile/${profile.username}`);
    }

    const body = clampText(req.body.body, 3000);
    if (!body) {
      setFlash(req, 'danger', 'Comment cannot be empty.');
      return res.redirect(`/profile/${profile.username}`);
    }

    await dbRun(
      'INSERT INTO profile_comments (profile_user_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?)',
      [profile.id, req.session.userId, body, new Date().toISOString()]
    );

    return res.redirect(`/profile/${profile.username}#comment-board`);
  })
);

app.get(
  '/settings/profile',
  requireAuth,
  ah(async (req, res) => {
    const userRow = await dbGet(
      `
        SELECT id, username, email, display_name, headline, bio, avatar_url,
               theme_mode, accent_color, background_color, card_color, text_color,
               title_font, body_font, section_order,
               hide_activity, hide_media, hide_reviews, hide_comment_board
        FROM users
        WHERE id = ?
      `,
      [req.session.userId]
    );

    if (!userRow) {
      req.session.userId = null;
      return res.redirect('/auth');
    }

    const user = {
      ...userRow,
      title_font: safeFont(userRow.title_font, '"Baloo 2"'),
      body_font: safeFont(userRow.body_font, '"Montserrat"')
    };

    return res.render('settings-profile', {
      pageTitle: 'Edit Profile',
      user,
      sectionOrder: getSectionOrder(user.section_order)
    });
  })
);

app.post(
  '/settings/profile',
  requireAuth,
  ah(async (req, res) => {
    const current = await dbGet('SELECT id, username FROM users WHERE id = ?', [req.session.userId]);

    if (!current) {
      req.session.userId = null;
      return res.redirect('/auth');
    }

    const newUsernameInput = clampText(req.body.username, 30).toLowerCase();
    const newUsername = newUsernameInput.replace(/[^a-z0-9_-]/g, '').slice(0, 30) || current.username;
    const newEmailInput = clampText(req.body.email, 100).toLowerCase();
    const newEmail = newEmailInput.includes('@') ? newEmailInput : null;

    const sectionOrder = getSectionOrder(req.body.section_order).join(',');

    if (!newEmail) {
      setFlash(req, 'danger', 'Please provide a valid email address.');
      return res.redirect('/settings/profile');
    }

    try {
      await dbRun(
        `
          UPDATE users
          SET
            username = ?,
            email = ?,
            display_name = ?,
            headline = ?,
            bio = ?,
            avatar_url = ?,
            theme_mode = ?,
            accent_color = ?,
            background_color = ?,
            card_color = ?,
            text_color = ?,
            title_font = ?,
            body_font = ?,
            section_order = ?,
            hide_activity = ?,
            hide_media = ?,
            hide_reviews = ?,
            hide_comment_board = ?
          WHERE id = ?
        `,
        [
          newUsername,
          newEmail,
          clampText(req.body.display_name, 60) || 'Member',
          clampText(req.body.headline, 140),
          clampText(req.body.bio, 8000),
          clampText(req.body.avatar_url, 500) || 'https://placehold.co/240x240/png?text=Avatar',
          req.body.theme_mode === 'dark' ? 'dark' : 'light',
          safeHex(req.body.accent_color, '#FA8072'),
          safeHex(req.body.background_color, '#fff7f8'),
          safeHex(req.body.card_color, '#ffffff'),
          safeHex(req.body.text_color, '#3f4a56'),
          safeFont(req.body.title_font, '"Baloo 2"'),
          safeFont(req.body.body_font, '"Montserrat"'),
          sectionOrder,
          req.body.hide_activity ? 1 : 0,
          req.body.hide_media ? 1 : 0,
          req.body.hide_reviews ? 1 : 0,
          req.body.hide_comment_board ? 1 : 0,
          current.id
        ]
      );
    } catch (error) {
      setFlash(req, 'danger', 'Could not update profile. Username or email may already exist.');
      return res.redirect('/settings/profile');
    }

    await db.rebuildSearchIndex();
    const updated = await dbGet('SELECT username FROM users WHERE id = ?', [current.id]);
    setFlash(req, 'success', 'Profile updated.');
    return res.redirect(`/profile/${updated.username}`);
  })
);

app.get('/search/recommendation', (_req, res) => {
  res.render('search-recommendation', {
    pageTitle: 'Search Engine Recommendation'
  });
});

app.use((_req, res) => {
  res.status(404).render('404', { pageTitle: 'Page Not Found' });
});

// Database initialization is async now (works for local file DB and remote Turso).
// `ready` resolves once tables, categories, seed data, and the search index exist.
const ready = initDb()
  .then(({ seeded: didSeed }) => {
    // eslint-disable-next-line no-console
    console.log(`Forum database ready (seeded: ${didSeed})`);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize database:', error);
    throw error;
  });

// On Vercel the app is invoked as a serverless function (see api/index.js),
// so it must not call app.listen() there — only export the app.
if (!process.env.VERCEL) {
  ready.then(() => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Forum app listening on http://localhost:${PORT}`);
    });
  });
}

module.exports = app;
module.exports.ready = ready;
