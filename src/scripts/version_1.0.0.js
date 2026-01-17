(async function () {
  const users = [];
  const statuses = ["active", "suspended", "pending"];

  console.log("Generating 10 random users...");

  for (let i = 0; i < 10; i++) {
    const randomAge = Math.floor(Math.random() * (60 - 18 + 1)) + 18;
    const currentYear = new Date().getFullYear();
    const birthYear = currentYear - randomAge;

    users.push({
      username: `user_${Math.random().toString(36).substring(7)}`,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      dob: {
        age: randomAge.toString(),
        year: Number.parseInt(birthYear.toString()),
      },
    });
  }

  try {
    const result = await db.collection("user").insertMany(users);
    console.log(`✅ Successfully inserted ${result.insertedCount} users.`);
  } catch (error) {
    console.error("❌ Migration failed validation check:");
    console.error(error.message);
    // Throwing here will stop the validator and block the Git commit
    throw error;
  }
})();
