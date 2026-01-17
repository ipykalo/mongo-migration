import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * PHASE 1: Initialize Collections and Apply Schemas
 */
async function setupSchemas(db: Db, schemasDir: string) {
  const schemaFiles = fs
    .readdirSync(schemasDir)
    .filter((f) => f.endsWith(".json"));

  for (const file of schemaFiles) {
    const colName = path.parse(file).name;
    const schema = JSON.parse(
      fs.readFileSync(path.join(schemasDir, file), "utf8"),
    );

    // Drop it if it exists to ensure a fresh schema apply
    const collections = await db.listCollections({ name: colName }).toArray();
    if (collections.length > 0) {
      await db.collection(colName).drop();
    }

    await db.createCollection(colName, {
      validator: schema,
      validationLevel: "strict",
      validationAction: "error", // This ensures it throws an error, not just a warning
    });
  }

  console.log(
    `🛠  Schemas applied: ${schemaFiles.length} collections created.`,
  );
}

/**
 * PHASE 2: Load Seed Data into Collections
 */
async function seedDatabase(db: Db, seedsDir: string) {
  if (!fs.existsSync(seedsDir)) return;

  const seedFiles = fs.readdirSync(seedsDir).filter((f) => f.endsWith(".json"));

  for (const file of seedFiles) {
    const colName = path.parse(file).name;
    let data = JSON.parse(fs.readFileSync(path.join(seedsDir, file), "utf8"));

    // Handle BSON Date conversion
    const processedData = data.map((doc: any) => {
      if (doc.createdAt && doc.createdAt.$date) {
        return { ...doc, createdAt: new Date(doc.createdAt.$date) };
      }
      return doc;
    });

    if (processedData.length > 0) {
      await db.collection(colName).insertMany(processedData);
      console.log(
        `   🌱 Seeded ${processedData.length} docs into '${colName}'`,
      );
    }
  }
}

/**
 * PHASE 3: Execute the Migration Script in a Sandbox
 */
async function executeMigration(db: Db, filePath: string) {
  const scriptContent = fs.readFileSync(path.resolve(filePath), "utf8");

  const context = vm.createContext({
    db,
    //console,
    print: console.log,
  });

  try {
    // We execute the script. If it's an async IIFE, it returns a Promise.
    const result = vm.runInContext(scriptContent, context);

    // We await the result in case the script returned a Promise
    await result;
  } catch (migrationError: any) {
    // Re-throw so the main 'validate' function catches it and exits with code 1
    throw migrationError;
  }
}

/**
 * MAIN ORCHESTRATOR
 */
async function validate() {
  const stagedFiles = process.argv.slice(2);
  if (stagedFiles.length === 0) return;

  const mongod = await MongoMemoryServer.create();
  const client = new MongoClient(mongod.getUri());

  let hasError = false; // 1. Track the state

  try {
    await client.connect();
    const testDb = client.db("validation_db");

    // 1. Setup
    await setupSchemas(testDb, path.join(__dirname, "schemas"));

    // 2. Seed
    await seedDatabase(testDb, path.join(__dirname, "seeds"));

    // 3. Migrate
    for (const filePath of stagedFiles) {
      console.log(`🚀 Testing: ${path.basename(filePath)}`);
      await executeMigration(testDb, filePath);
    }

    console.log("✅ All migrations passed validation!");
  } catch (error: any) {
    console.error("❌ VALIDATION FAILED:", error.message);
    hasError = true; // 2. Mark as failed if an error occurs
  } finally {
    // 3. Clean up the database FIRST
    await client.close();
    await mongod.stop();

    // 4. Exit with the correct code based on success or failure
    if (hasError) {
      console.log("🚫 Blocking commit due to errors.");
      process.exit(1);
    } else {
      console.log("✅ Validation complete. Proceeding with commit.");
      process.exit(0);
    }
  }
}

validate();
