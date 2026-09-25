import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // The database is shared with LexTrack (in `public`). Restrict drizzle-kit to
  // our own schema so it never introspects — or offers to drop — LexTrack tables.
  schemaFilter: ['threadanalytics'],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
