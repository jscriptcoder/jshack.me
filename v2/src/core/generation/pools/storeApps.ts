/**
 * What each application keeps in a key-value store beside its tables.
 *
 * A store is the working set of the application its box runs (`databaseApps.ts`): who is
 * signed in, which rows it has cached, what is waiting in its queues, which jobs hold a
 * lock, what it counts, which features it has switched on, and which outside services
 * call it back. Every name here is in that application's own words, so a till's store
 * reads as a till's and a helpdesk's as a helpdesk's.
 *
 * Nothing here is a secret that opens anything in the world. A webhook's secret belongs
 * to a vendor outside it, whose URL no tool in the game can reach.
 */

import type { ArchetypeKey } from '../databaseApp';

/** A queue of jobs, each about one row of `table`. */
export type QueueSpec = {
  readonly name: string;
  /** What a job on this queue does, as the application names it. */
  readonly kind: string;
  readonly table: string;
};

export type StoreSpec = {
  /** Tables whose rows the application caches, as `cache:<table>:<id>`. One the
   *  application did not draw is skipped. */
  readonly cached: readonly string[];
  readonly queues: readonly QueueSpec[];
  /** Jobs that take a lock while they run, as `lock:<job>`. */
  readonly locks: readonly string[];
  /** What the application counts, as `stats:<name>`. */
  readonly counters: readonly string[];
  /** Features it can switch on, as `flag:<feature>`. */
  readonly flags: readonly string[];
  /** Routes it rate-limits per client address, as `ratelimit:<route>:<ip>`. */
  readonly routes: readonly string[];
  /** Outside services that call it back, as `config:webhook:<vendor>`. */
  readonly webhooks: readonly string[];
};

export const STORE_SPECS: Readonly<Record<ArchetypeKey, StoreSpec>> = {
  helpdesk: {
    cached: ['tickets', 'kb_articles', 'sla_policies', 'users'],
    queues: [
      { name: 'notify', kind: 'ticket.updated', table: 'tickets' },
      { name: 'escalations', kind: 'sla.breach', table: 'tickets' },
    ],
    locks: ['sla_sweep', 'digest_mail'],
    counters: ['tickets_open', 'tickets_closed_today', 'replies_today', 'sla_breaches'],
    flags: ['ticket_merge', 'canned_replies', 'csat_survey'],
    routes: ['login', 'tickets', 'search'],
    webhooks: ['slack', 'pagerduty'],
  },
  crm: {
    cached: ['accounts', 'contacts', 'deals', 'users'],
    queues: [
      { name: 'import', kind: 'contact.import', table: 'contacts' },
      { name: 'followups', kind: 'deal.followup', table: 'deals' },
    ],
    locks: ['nightly_dedupe', 'forecast_rollup'],
    counters: ['deals_open', 'deals_won_month', 'calls_logged_today', 'contacts_total'],
    flags: ['pipeline_board', 'forecast_v2', 'email_tracking'],
    routes: ['login', 'contacts', 'deals'],
    webhooks: ['slack', 'mailchimp'],
  },
  stock: {
    cached: ['products', 'suppliers', 'stock_levels', 'users'],
    queues: [
      { name: 'reorder', kind: 'stock.low', table: 'products' },
      { name: 'receiving', kind: 'delivery.expected', table: 'suppliers' },
    ],
    locks: ['reorder_run', 'stocktake'],
    counters: ['skus_low', 'movements_today', 'orders_open'],
    flags: ['barcode_scan', 'auto_reorder', 'bin_locations'],
    routes: ['login', 'products', 'scan'],
    webhooks: ['slack', 'shipstation'],
  },
  till: {
    cached: ['menu_items', 'shifts', 'users'],
    queues: [
      { name: 'kitchen', kind: 'order.placed', table: 'orders' },
      { name: 'receipts', kind: 'receipt.print', table: 'orders' },
    ],
    locks: ['end_of_day', 'menu_sync'],
    counters: ['orders_today', 'covers_today', 'takeaway_today', 'card_payments_today'],
    flags: ['loyalty_stamps', 'table_service', 'oat_milk_default'],
    routes: ['login', 'orders', 'menu'],
    webhooks: ['sumup', 'square'],
  },
  media: {
    cached: ['titles', 'episodes', 'playlists', 'users'],
    queues: [
      { name: 'transcode', kind: 'title.transcode', table: 'titles' },
      { name: 'thumbnails', kind: 'thumbnail.render', table: 'episodes' },
    ],
    locks: ['library_scan', 'metadata_refresh'],
    counters: ['streams_today', 'titles_total', 'hours_watched_week'],
    flags: ['autoplay_next', 'subtitles_default', 'kids_profile'],
    routes: ['login', 'stream', 'search'],
    webhooks: ['discord', 'pushover'],
  },
  household: {
    cached: ['recipes', 'bills', 'chores', 'users'],
    queues: [
      { name: 'reminders', kind: 'bill.due', table: 'bills' },
      { name: 'shopping', kind: 'list.sync', table: 'shopping_list' },
    ],
    locks: ['meal_plan', 'bill_import'],
    counters: ['bills_unpaid', 'recipes_total', 'items_on_list'],
    flags: ['meal_planner', 'shared_lists', 'dark_mode'],
    routes: ['login', 'recipes', 'lists'],
    webhooks: ['pushover', 'telegram'],
  },
  enrolment: {
    cached: ['courses', 'students', 'enrolments', 'users'],
    queues: [
      { name: 'transcripts', kind: 'transcript.render', table: 'students' },
      { name: 'notify', kind: 'enrolment.changed', table: 'enrolments' },
    ],
    locks: ['term_rollover', 'timetable_publish'],
    counters: ['enrolments_term', 'students_active', 'waitlisted'],
    flags: ['self_service_enrol', 'waitlists', 'grade_export'],
    routes: ['login', 'enrol', 'courses'],
    webhooks: ['slack', 'moodle'],
  },
  library: {
    cached: ['books', 'members', 'loans', 'users'],
    queues: [
      { name: 'overdue', kind: 'loan.overdue', table: 'loans' },
      { name: 'holds', kind: 'hold.ready', table: 'books' },
    ],
    locks: ['overdue_sweep', 'catalogue_import'],
    counters: ['loans_today', 'returns_today', 'overdue_total'],
    flags: ['self_checkout', 'holds', 'fine_waivers'],
    routes: ['login', 'search', 'loans'],
    webhooks: ['sendgrid', 'slack'],
  },
  bookings: {
    cached: ['rooms', 'bookings', 'notices', 'users'],
    queues: [
      { name: 'confirmations', kind: 'booking.confirmed', table: 'bookings' },
      { name: 'reminders', kind: 'booking.reminder', table: 'bookings' },
    ],
    locks: ['calendar_sync', 'notice_board'],
    counters: ['bookings_today', 'rooms_free', 'cancellations_week'],
    flags: ['recurring_bookings', 'public_calendar', 'deposit_required'],
    routes: ['login', 'book', 'calendar'],
    webhooks: ['stripe', 'slack'],
  },
  telemetry: {
    cached: ['devices', 'alerts', 'automations', 'users'],
    queues: [
      { name: 'alerts', kind: 'alert.raised', table: 'alerts' },
      { name: 'ingest', kind: 'reading.batch', table: 'devices' },
    ],
    locks: ['rollup_hourly', 'firmware_poll'],
    counters: ['readings_ingested', 'devices_online', 'alerts_open'],
    flags: ['anomaly_detection', 'push_alerts', 'graph_v2'],
    routes: ['ingest', 'login', 'api'],
    webhooks: ['pushover', 'ifttt'],
  },
  scoreboard: {
    cached: ['teams', 'challenges', 'hints', 'users'],
    queues: [
      { name: 'solves', kind: 'solve.submitted', table: 'challenges' },
      { name: 'announce', kind: 'challenge.released', table: 'challenges' },
    ],
    locks: ['scoreboard_freeze', 'flag_rotate'],
    counters: ['solves_total', 'teams_registered', 'submissions_today'],
    flags: ['dynamic_scoring', 'first_blood', 'hints_enabled'],
    routes: ['login', 'submit', 'scoreboard'],
    webhooks: ['discord', 'matrix'],
  },
  wiki: {
    cached: ['wiki_pages', 'revisions', 'page_tags', 'users'],
    queues: [
      { name: 'index', kind: 'page.reindex', table: 'wiki_pages' },
      { name: 'notify', kind: 'page.watched', table: 'wiki_pages' },
    ],
    locks: ['search_reindex', 'backlink_rebuild'],
    counters: ['pages_total', 'edits_today', 'stale_pages'],
    flags: ['markdown_editor', 'page_locking', 'backlinks'],
    routes: ['login', 'edit', 'search'],
    webhooks: ['matrix', 'discord'],
  },
  cms: {
    cached: ['posts', 'pages', 'categories', 'users'],
    queues: [
      { name: 'publish', kind: 'post.scheduled', table: 'posts' },
      { name: 'moderation', kind: 'comment.held', table: 'comments' },
    ],
    locks: ['sitemap_rebuild', 'cache_purge'],
    counters: ['posts_published', 'comments_pending', 'pageviews_today'],
    flags: ['comments_open', 'scheduled_posts', 'new_editor'],
    routes: ['login', 'admin', 'comments'],
    webhooks: ['slack', 'cloudflare'],
  },
  api: {
    cached: ['api_clients', 'webhooks', 'users'],
    queues: [
      { name: 'deliveries', kind: 'webhook.deliver', table: 'webhooks' },
      { name: 'usage', kind: 'usage.rollup', table: 'api_clients' },
    ],
    locks: ['usage_rollup', 'key_rotation'],
    counters: ['requests_today', 'errors_today', 'clients_active'],
    flags: ['v2_endpoints', 'strict_cors', 'request_signing'],
    routes: ['token', 'v1', 'v2'],
    webhooks: ['stripe', 'github'],
  },
  mail: {
    cached: ['mailboxes', 'aliases', 'spam_rules', 'users'],
    queues: [
      { name: 'outbound', kind: 'message.send', table: 'mailboxes' },
      { name: 'bounces', kind: 'bounce.process', table: 'mailboxes' },
    ],
    locks: ['queue_flush', 'spam_retrain'],
    counters: ['messages_today', 'bounced_today', 'spam_blocked_today'],
    flags: ['greylisting', 'dkim_signing', 'auto_reply'],
    routes: ['smtp', 'imap', 'webmail'],
    webhooks: ['slack', 'pagerduty'],
  },
};
