(async function () {
  print("=== Migration v1.0.1 starting ===");

  // ── Step 1: Promote all pending users to active ──────────────────────────
  const promotionResult = await db.collection("user").updateMany(
    { status: "pending" },
    { $set: { status: "active" } }
  );
  print(`Step 1: Promoted ${promotionResult.modifiedCount} pending → active.`);

  // ── Step 2: Backfill isPaid=false on any orders missing the field ─────────
  // Pipeline-style updateMany (requires MongoDB 4.2+)
  const backfillResult = await db.collection("order").updateMany(
    { isPaid: { $exists: false } },
    [{ $set: { isPaid: false } }]
  );
  print(`Step 2: Backfilled isPaid on ${backfillResult.modifiedCount} order(s).`);

  // ── Step 3: Upsert a welcome order for every active user ──────────────────
  // Reads from one collection to drive writes in another.
  const activeUsers = await db
    .collection("user")
    .find({ status: "active" })
    .toArray();

  if (activeUsers.length > 0) {
    const welcomeOps = activeUsers.map((u) => ({
      updateOne: {
        filter: { orderId: `WELCOME-${u.username}` },
        update: {
          $setOnInsert: {
            orderId: `WELCOME-${u.username}`,
            total: 0.01,
            createdAt: new Date("2026-01-01T00:00:00Z"),
            isPaid: false,
          },
        },
        upsert: true,
      },
    }));

    const bulkResult = await db.collection("order").bulkWrite(welcomeOps);
    print(
      `Step 3: Welcome orders — ${bulkResult.upsertedCount} inserted, ` +
        `${bulkResult.matchedCount} already existed.`
    );
  }

  // ── Step 4: Tag contacts from known corporate domains ────────────────────
  const corporateDomains = ["example.com", "corp.io", "company.com"];

  const contacts = await db.collection("contacts").find().toArray();
  const tagOps = contacts
    .filter((c) => {
      const domain = (c.email || "").split("@")[1] || "";
      return corporateDomains.includes(domain) && !(c.tags || []).includes("corporate");
    })
    .map((c) => ({
      updateOne: {
        filter: { _id: c._id },
        update: { $addToSet: { tags: "corporate" } },
      },
    }));

  if (tagOps.length > 0) {
    const tagResult = await db.collection("contacts").bulkWrite(tagOps);
    print(`Step 4: Tagged ${tagResult.modifiedCount} contact(s) as "corporate".`);
  } else {
    print("Step 4: No contacts required the corporate tag.");
  }

  // ── Step 5: Suspend active users under 18 ────────────────────────────────
  const suspendResult = await db.collection("user").updateMany(
    { status: "active", "dob.age": { $lt: 18 } },
    { $set: { status: "suspended" } }
  );
  print(`Step 5: Suspended ${suspendResult.modifiedCount} underage user(s).`);

  // ── Step 6: Final counts across all collections (parallel) ───────────────
  const [userCount, orderCount, contactCount] = await Promise.all([
    db.collection("user").countDocuments(),
    db.collection("order").countDocuments(),
    db.collection("contacts").countDocuments(),
  ]);
  print(`\nSummary: ${userCount} users | ${orderCount} orders | ${contactCount} contacts`);
  print("=== Migration v1.0.1 complete ===");
})();
