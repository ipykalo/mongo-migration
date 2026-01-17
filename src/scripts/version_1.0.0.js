(async function () {
  console.log("🚀 Running a DELIBERATELY BROKEN migration...");

  try {
    // This will fail because:
    // 1. "age" is a STRING "30", but the schema requires an INT.
    // 2. "status" is "offline", but the schema enum only allows ["active", "suspended", "pending"].
    await db.collection("user").insertOne({
      username: "broken_user",
      status: "activew",
      dob: {
        age: 20,
        year: 1994,
      },
    });

    console.log("❌ If you see this, validation FAILED to catch the error!");
  } catch (error) {
    console.log("✅ Successfully caught the validation error as expected.");
    // We re-throw the error so the validator exits with code 1
    // and Husky blocks the git commit.
    throw error;
  }
})();
