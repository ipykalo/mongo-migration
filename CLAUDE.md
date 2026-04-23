# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run migration validation manually against a specific script
npx tsx ./src/validate-migration.ts src/scripts/your_migration.js

# Install Git hooks (run once after cloning)
npm run prepare

# Install dependencies
npm install
```

Validation runs automatically via Husky pre-commit hook on any staged `src/scripts/*.js` file. There is no test suite yet — `npm test` intentionally fails.

## Architecture

This is a **pre-commit MongoDB migration validator**. When a developer stages a `.js` file in `src/scripts/`, the Husky hook runs `validate-migration.ts` against it, which:

1. **Spins up an ephemeral `MongoMemoryServer`** — no external MongoDB needed
2. **Applies collection schemas** from `src/schemas/*.json` using MongoDB's strict validation mode
3. **Seeds the database** from `src/seeds/*.json` (handles BSON `$date` → JS `Date` conversion)
4. **Executes the migration script** inside a Node.js `vm` sandbox where `db` and `print` are the only globals (no `console`)
5. **Exits 0 (allow commit) or 1 (block commit)** based on whether the migration runs without errors or schema violations

### Key files

- `src/validate-migration.ts` — orchestrator; entry point for all validation runs
- `src/schemas/*.json` — MongoDB JSON Schema validators (one per collection: `user`, `contacts`, `order`)
- `src/seeds/*.json` — fixture data pre-loaded before each migration run
- `src/scripts/*.js` — migration scripts; only these files trigger validation on commit
- `.husky/pre-commit` → `lint-staged` → `npx tsx ./src/validate-migration.ts`

### Adding a new migration

Create a `.js` file in `src/scripts/`. The script receives a `db` variable (MongoDB `Db` instance). Stage and commit — validation runs automatically. Example:

```js
await db.collection("users").updateMany({ status: "pending" }, { $set: { status: "active" } });
```

### Adding a new collection

1. Add a JSON Schema validator to `src/schemas/<collection>.json`
2. Add seed data to `src/seeds/<collection>.json` (use `{ "$date": "ISO8601" }` for dates)
3. `setupSchemas()` and `seedDatabase()` auto-discover files in those directories

## Tech stack

- **TypeScript** (strict, ESNext, ESM — `"type": "module"` in package.json)
- **mongodb** driver + **mongodb-memory-server** for in-memory execution
- **tsx** for running `.ts` files directly
- **husky** + **lint-staged** for Git hook integration
