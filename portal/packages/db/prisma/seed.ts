import { prisma } from "../src/client.ts";

const MODEL_PROVIDERS = [
  { slug: "anthropic", name: "Anthropic" },
  { slug: "openai", name: "OpenAI" },
];

async function main() {
  for (const provider of MODEL_PROVIDERS) {
    await prisma.modelProvider.upsert({
      where: { slug: provider.slug },
      create: provider,
      update: { name: provider.name },
    });
  }

  console.log("Seeded model providers.");
}

await main();
await prisma.$disconnect();
