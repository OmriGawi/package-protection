import { seedDatabase } from "../src/lib/seed";
import { prisma } from "../src/lib/prisma";

seedDatabase()
  .then((result) => {
    console.log(
      `Seeded ${result.deliveries} deliveries, ${result.packages} packages, ${result.images} photos.`
    );
  })
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
