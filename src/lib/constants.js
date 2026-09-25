export const SERVICE_META = {
  seo: {
    key: 'seo', label: 'SEO', icon: 'Search',
    accent: '#6366f1', accentBg: '#eef2ff', accentBorder: '#c7d2fe', accentText: '#4338ca',
    tagline: 'Organic search performance & backlink building',
    hasPlatforms: false,
    coreMetrics: [
      { key: 'organic_clicks', label: 'Organic Clicks', lowerBetter: false, format: 'int' },
      { key: 'impressions', label: 'Impressions', lowerBetter: false, format: 'int' },
      { key: 'avg_ranking', label: 'Avg. Ranking', lowerBetter: true, format: 'num1' },
    ],
    breakdown: { key: 'backlink_types', label: 'Backlink Activity', itemNoun: 'link type', defaults: ['Blog submissions', 'Profile links', 'Content written', 'Guest posts'] },
    lists: [
      { key: 'backlinks', label: 'Backlinks Placed', addLabel: 'Add backlink',
        columns: [
          { key: 'url', label: 'URL', type: 'text', placeholder: 'https://...' },
          { key: 'type', label: 'Type', type: 'text', placeholder: 'Guest post' },
          { key: 'anchor_text', label: 'Anchor Text', type: 'text' },
          { key: 'date', label: 'Date', type: 'date' },
        ] },
      { key: 'published_pages', label: 'Published Pages', addLabel: 'Add page',
        columns: [
          { key: 'live_link', label: 'Live Link', type: 'text', placeholder: 'https://...' },
          { key: 'blog_title', label: 'Blog Title', type: 'text', placeholder: 'Article title' },
          { key: 'published_date', label: 'Published Date', type: 'date' },
          { key: 'type', label: 'Type', type: 'text', placeholder: 'Guest post / Blog / Press release' },
          { key: 'note', label: 'Note', type: 'text', placeholder: 'Additional notes' },
        ] },
      // GA4 tables. Both share the same four numeric columns; only the first
      // column differs (page URL vs country).
      { key: 'ga_top_pages', label: 'Top Pages (GA4)', addLabel: 'Add page',
        columns: [
          { key: 'url', label: 'Page URL', type: 'text', placeholder: '/services or https://...' },
          { key: 'sessions', label: 'Sessions', type: 'number', placeholder: '0' },
          { key: 'active_users', label: 'Active Users', type: 'number', placeholder: '0' },
          { key: 'engagement_rate', label: 'Engagement Rate (%)', type: 'number', placeholder: 'e.g. 58.4' },
          { key: 'bounce_rate', label: 'Bounce Rate (%)', type: 'number', placeholder: '≈ 100 − engagement' },
        ] },
      { key: 'ga_demographics', label: 'Demographic Details', addLabel: 'Add country',
        columns: [
          { key: 'country', label: 'Country', type: 'text', placeholder: 'India' },
          { key: 'sessions', label: 'Sessions', type: 'number', placeholder: '0' },
          { key: 'active_users', label: 'Active Users', type: 'number', placeholder: '0' },
          { key: 'engagement_rate', label: 'Engagement Rate (%)', type: 'number', placeholder: 'e.g. 58.4' },
          { key: 'bounce_rate', label: 'Bounce Rate (%)', type: 'number', placeholder: '≈ 100 − engagement' },
        ] },
    ],
    // GA Metrics — editable name+value pairs shown like core metrics
    gaMetrics: true,
  },
  orm: {
    key: 'orm', label: 'ORM', icon: 'ShieldCheck',
    accent: '#10b981', accentBg: '#ecfdf5', accentBorder: '#a7f3d0', accentText: '#047857',
    tagline: 'Reputation, reviews & brand keyword rankings',
    hasPlatforms: false,
    coreMetrics: [
      { key: 'avg_rating', label: 'Avg. Rating', lowerBetter: false, format: 'num1', max: 5 },
      { key: 'review_count', label: 'Total Reviews', lowerBetter: false, format: 'int' },
    ],
    breakdown: { key: 'review_platforms', label: 'Reviews Submitted', itemNoun: 'platform', defaults: ['Google', 'Yelp', 'Facebook'] },
    breakdown2: { key: 'backlink_types', label: 'Backlink Activity', itemNoun: 'link type', defaults: ['Blog submissions', 'Profile links', 'Content written', 'Guest posts'] },
    lists: [
      { key: 'brand_keywords', label: 'Brand Keyword Rankings', addLabel: 'Add keyword',
        columns: [
          { key: 'keyword', label: 'Keyword', type: 'text', placeholder: 'brand name reviews' },
          { key: 'position', label: 'Position', type: 'number', placeholder: '1-100' },
          { key: 'asset', label: 'Top-3 Asset', type: 'text', placeholder: 'Your site / Review page / Press article' },
        ] },
      { key: 'reviews', label: 'Recent Reviews', addLabel: 'Add review',
        columns: [
          { key: 'platform', label: 'Platform', type: 'text' },
          { key: 'author', label: 'Author', type: 'text' },
          { key: 'rating', label: 'Rating', type: 'number' },
          { key: 'snippet', label: 'Snippet', type: 'text' },
          { key: 'date', label: 'Date', type: 'date' },
        ] },
      { key: 'backlinks', label: 'Backlinks Placed', addLabel: 'Add backlink',
        columns: [
          { key: 'url', label: 'URL', type: 'text', placeholder: 'https://...' },
          { key: 'type', label: 'Type', type: 'text', placeholder: 'Guest post' },
          { key: 'anchor_text', label: 'Anchor Text', type: 'text' },
          { key: 'date', label: 'Date', type: 'date' },
        ] },
    ],
  },
  social: {
    key: 'social', label: 'Social Media', icon: 'Share2',
    accent: '#f59e0b', accentBg: '#fffbeb', accentBorder: '#fde68a', accentText: '#b45309',
    tagline: 'Per-platform follower & engagement reporting',
    hasPlatforms: true,
    platforms: [
      { key: 'instagram', label: 'Instagram', color: '#ec4899' },
      { key: 'facebook', label: 'Facebook', color: '#1877f2' },
      { key: 'linkedin', label: 'LinkedIn', color: '#0a66c2' },
    ],
    coreMetrics: [
      { key: 'followers', label: 'Followers', lowerBetter: false, format: 'int' },
      { key: 'reach', label: 'Reach', lowerBetter: false, format: 'int' },
      { key: 'engagement_rate', label: 'Engagement Rate', lowerBetter: false, format: 'num1', suffix: '%' },
      { key: 'impressions', label: 'Impressions', lowerBetter: false, format: 'int' },
    ],
    breakdown: { key: 'post_types', label: 'Posts by Type', itemNoun: 'post type', defaults: ['Reels', 'Stories', 'Posts', 'Carousels'] },
    lists: [
      { key: 'top_posts', label: 'Top Posts', addLabel: 'Add post',
        columns: [
          { key: 'platform', label: 'Platform', type: 'select', options: ['Instagram', 'Facebook', 'LinkedIn'] },
          { key: 'type', label: 'Type', type: 'text' },
          { key: 'caption', label: 'Caption', type: 'text' },
          { key: 'likes', label: 'Likes', type: 'number' },
          { key: 'comments', label: 'Comments', type: 'number' },
          { key: 'reach', label: 'Reach', type: 'number' },
          { key: 'date', label: 'Date', type: 'date' },
        ] },
    ],
  },
};

export const SERVICE_ORDER = ['seo', 'orm', 'social'];

export function getMeta(service) { return SERVICE_META[service]; }
export function coreKeys(service) { return (SERVICE_META[service]?.coreMetrics || []).map(m => m.key); }
export function isCore(service, key) { return coreKeys(service).includes(key); }

// Repeating free-form report sections: an editable heading plus bullet points.
// 'notes' keeps its original key names so reports saved before the other four
// existed still load correctly.
export const NOTE_SECTIONS = [
  { id: 'notes', titleKey: 'notes_title', pointsKey: 'notes_points', fallback: 'Notes' },
  { id: 'notes2', titleKey: 'notes2_title', pointsKey: 'notes2_points', fallback: 'Notes 2' },
  { id: 'notes3', titleKey: 'notes3_title', pointsKey: 'notes3_points', fallback: 'Notes 3' },
  { id: 'notes4', titleKey: 'notes4_title', pointsKey: 'notes4_points', fallback: 'Notes 4' },
  { id: 'notes5', titleKey: 'notes5_title', pointsKey: 'notes5_points', fallback: 'Notes 5' },
];
