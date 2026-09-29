const bcrypt = require('bcryptjs');
const { categories, forumTopics } = require('./constants');

const imagePool = [
  'https://picsum.photos/seed/forum-a/900/520',
  'https://picsum.photos/seed/forum-b/900/520',
  'https://picsum.photos/seed/forum-c/900/520',
  'https://picsum.photos/seed/forum-d/900/520',
  'https://picsum.photos/seed/forum-e/900/520'
];

const videoPool = [
  'https://samplelib.com/lib/preview/mp4/sample-5s.mp4',
  'https://samplelib.com/lib/preview/mp4/sample-10s.mp4',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
];

const loremSnippets = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus bibendum interdum massa, id consectetur nisl suscipit id.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ultrices in iaculis nunc sed augue lacus viverra vitae.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  'Mauris cursus mattis molestie a iaculis at erat pellentesque adipiscing commodo elit at imperdiet dui accumsan sit.',
  'Velit ut tortor pretium viverra suspendisse potenti nullam ac tortor vitae purus faucibus ornare suspendisse sed.'
];

function pick(list, index) {
  return list[index % list.length];
}

function buildBody(seed) {
  return [
    pick(loremSnippets, seed),
    pick(loremSnippets, seed + 2),
    pick(loremSnippets, seed + 4)
  ].join(' ');
}

const INSERT_USER_SQL = `
  INSERT INTO users (
    username, email, password_hash, display_name, headline, bio,
    avatar_url, theme_mode, accent_color, background_color, card_color,
    text_color, title_font, body_font, section_order,
    hide_activity, hide_media, hide_reviews, hide_comment_board, created_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?
  )
`;

const INSERT_THREAD_SQL = `
  INSERT INTO threads (
    user_id, category_slug, topic_tag, title, body, media_type, media_url, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

const INSERT_COMMENT_SQL = `
  INSERT INTO thread_comments (thread_id, user_id, body, created_at)
  VALUES (?, ?, ?, ?)
`;

const INSERT_REVIEW_SQL = `
  INSERT INTO reviews (user_id, title, body, rating, created_at)
  VALUES (?, ?, ?, ?, ?)
`;

const INSERT_MEDIA_SQL = `
  INSERT INTO media_posts (user_id, title, description, media_type, media_url, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`;

const INSERT_PROFILE_COMMENT_SQL = `
  INSERT INTO profile_comments (profile_user_id, author_user_id, body, created_at)
  VALUES (?, ?, ?, ?)
`;

// The seed only ever runs against an empty users table. User and thread ids
// are queried back between phases (like the original implementation) instead
// of being assumed, so seeding stays correct even if the id sequences do not
// start at 1.
function buildUserStatements(now) {
  const statements = [];

  const baseUsers = [
    {
      username: 'aurora_admin',
      email: 'aurora@example.com',
      display_name: 'Aurora Lane',
      headline: 'Community host and media archivist.',
      bio: buildBody(0),
      accent_color: '#FA8072',
      background_color: '#fff6f7',
      card_color: '#ffffff',
      text_color: '#3f4a56',
      theme_mode: 'light'
    },
    {
      username: 'pixelpilot',
      email: 'pixelpilot@example.com',
      display_name: 'Pixel Pilot',
      headline: 'Daily uploader of concept clips.',
      bio: buildBody(1),
      accent_color: '#ff4a4a',
      background_color: '#f8f8ff',
      card_color: '#fefefe',
      text_color: '#303740',
      theme_mode: 'dark'
    },
    {
      username: 'salmonsky',
      email: 'salmonsky@example.com',
      display_name: 'Salmon Sky',
      headline: 'Photos, reels, and pastel UI experiments.',
      bio: buildBody(2),
      accent_color: '#f49b9b',
      background_color: '#fff7f8',
      card_color: '#ffffff',
      text_color: '#434b56',
      theme_mode: 'light'
    },
    {
      username: 'canarybyte',
      email: 'canarybyte@example.com',
      display_name: 'Canary Byte',
      headline: 'Search optimization and metadata nerd.',
      bio: buildBody(3),
      accent_color: '#ffd93b',
      background_color: '#fffdf1',
      card_color: '#ffffff',
      text_color: '#323b44',
      theme_mode: 'light'
    },
    {
      username: 'slatewave',
      email: 'slatewave@example.com',
      display_name: 'Slate Wave',
      headline: 'Forum reviewer and quality gatekeeper.',
      bio: buildBody(4),
      accent_color: '#6a7480',
      background_color: '#f3f5f7',
      card_color: '#ffffff',
      text_color: '#2e3740',
      theme_mode: 'dark'
    },
    {
      username: 'modularmint',
      email: 'modularmint@example.com',
      display_name: 'Modular Mint',
      headline: 'Build logs and template packs every week.',
      bio: buildBody(5),
      accent_color: '#ff6b6b',
      background_color: '#fff7f7',
      card_color: '#ffffff',
      text_color: '#3b4350',
      theme_mode: 'light'
    }
  ];

  const hashed = bcrypt.hashSync('password123', 10);

  baseUsers.forEach((user, i) => {
    statements.push({
      sql: INSERT_USER_SQL,
      args: [
        user.username,
        user.email,
        hashed,
        user.display_name,
        user.headline,
        user.bio,
        `https://placehold.co/240x240/png?text=${encodeURIComponent(user.display_name.split(' ')[0])}`,
        user.theme_mode,
        user.accent_color,
        user.background_color,
        user.card_color,
        user.text_color,
        '"Baloo 2"',
        '"Montserrat"',
        'about,activity,media,reviews,comment_board',
        0,
        0,
        i % 5 === 0 ? 1 : 0,
        0,
        new Date(now - i * 86400000).toISOString()
      ]
    });
  });

  return statements;
}

function buildThreadStatements(userIds, now) {
  const statements = [];
  let seed = 0;
  for (let i = 0; i < 90; i += 1) {
    const category = pick(categories, i);
    const userId = pick(userIds, i);
    const topic = pick(forumTopics, i * 2);
    const mediaType = i % 3 === 0 ? 'image' : i % 5 === 0 ? 'video' : 'text';

    statements.push({
      sql: INSERT_THREAD_SQL,
      args: [
        userId,
        category.slug,
        topic,
        `${topic}: Placeholder thread #${i + 1}`,
        buildBody(seed),
        mediaType,
        mediaType === 'image' ? pick(imagePool, i) : mediaType === 'video' ? pick(videoPool, i) : null,
        new Date(now - i * 7200000).toISOString()
      ]
    });
    seed += 1;
  }

  return statements;
}

function buildContentStatements(userIds, threadIds, now) {
  const statements = [];

  for (let i = 0; i < 60; i += 1) {
    const threadId = threadIds[i % threadIds.length];
    statements.push({
      sql: INSERT_COMMENT_SQL,
      args: [threadId, pick(userIds, i + 1), `Great thread. ${buildBody(i + 1)}`, new Date(now - i * 3600000).toISOString()]
    });
    statements.push({
      sql: INSERT_COMMENT_SQL,
      args: [threadId, pick(userIds, i + 2), `Second viewpoint here. ${buildBody(i + 2)}`, new Date(now - i * 3200000).toISOString()]
    });
  }

  for (let i = 0; i < 36; i += 1) {
    statements.push({
      sql: INSERT_REVIEW_SQL,
      args: [pick(userIds, i), `Placeholder review #${i + 1}`, buildBody(i), (i % 5) + 1, new Date(now - i * 5400000).toISOString()]
    });
  }

  for (let i = 0; i < 48; i += 1) {
    const mediaType = i % 4 === 0 ? 'video' : 'image';
    statements.push({
      sql: INSERT_MEDIA_SQL,
      args: [
        pick(userIds, i),
        `Media drop #${i + 1}`,
        buildBody(i + 3),
        mediaType,
        mediaType === 'video' ? pick(videoPool, i) : pick(imagePool, i),
        new Date(now - i * 4100000).toISOString()
      ]
    });
  }

  for (let i = 0; i < userIds.length * 4; i += 1) {
    statements.push({
      sql: INSERT_PROFILE_COMMENT_SQL,
      args: [
        userIds[i % userIds.length],
        userIds[(i + 1) % userIds.length],
        `Profile board note #${i + 1}. ${buildBody(i + 2)}`,
        new Date(now - i * 2300000).toISOString()
      ]
    });
  }

  return statements;
}

async function seedIfNeeded(db) {
  const existing = await db.get('SELECT COUNT(*) AS count FROM users');
  if (existing && existing.count > 0) {
    return false;
  }

  const now = Date.now();
  await db.batch(buildUserStatements(now));
  const userIds = (await db.all('SELECT id FROM users ORDER BY id')).map((row) => row.id);
  await db.batch(buildThreadStatements(userIds, now));
  const threadIds = (await db.all('SELECT id FROM threads ORDER BY id')).map((row) => row.id);
  await db.batch(buildContentStatements(userIds, threadIds, now));
  return true;
}

module.exports = {
  seedIfNeeded,
  buildUserStatements,
  buildThreadStatements,
  buildContentStatements
};
