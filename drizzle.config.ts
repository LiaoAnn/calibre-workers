import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './migrations',
  schema: './src/shared/db/schema.ts',
  dialect: 'sqlite',
})
