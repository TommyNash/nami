export const DEFAULT_INGEST = {
  host: '127.0.0.1',
  port: 17321,
  path: '/ingest'
};

export const MESSAGE_SOURCE = {
  MAIN_HOOK: 'nami-collector-main',
  CONTENT: 'nami-collector-content',
  BACKGROUND: 'nami-collector-bg'
};

export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  QUEUE: 'queue',
  STATS: 'stats',
  EVENTS: 'events',
  COLLECTING: 'collecting',
  AUTO_PROGRESS: 'autoProgress'
};

export const MAX_QUEUE = 200;
export const MAX_EVENTS = 40;
export const MAX_BODY_CHARS = 750000;
