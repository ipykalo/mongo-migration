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

function convertBsonDates(value: any): any {
  if (Array.isArray(value)) return value.map(convertBsonDates);
  if (value !== null && typeof value === "object") {
    if ("$date" in value) return new Date(value.$date);
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, convertBsonDates(v)])
    );
  }
  return value;
}

/**
 * PHASE 2: Load Seed Data into Collections
 */
async function seedDatabase(db: Db, seedsDir: string) {
  if (!fs.existsSync(seedsDir)) return;

  const seedFiles = fs.readdirSync(seedsDir).filter((f) => f.endsWith(".json"));

  for (const file of seedFiles) {
    const colName = path.parse(file).name;
    const data = JSON.parse(fs.readFileSync(path.join(seedsDir, file), "utf8"));
    const processedData = convertBsonDates(data);

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
    console,
    print: console.log,
  });

  const result = vm.runInContext(scriptContent, context);
  await result;
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

    const schemasDir = path.join(__dirname, "schemas");
    const seedsDir = path.join(__dirname, "seeds");

    for (const filePath of stagedFiles) {
      console.log(`🚀 Testing: ${path.basename(filePath)}`);
      await setupSchemas(testDb, schemasDir);
      await seedDatabase(testDb, seedsDir);
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
