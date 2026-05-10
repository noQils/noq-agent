import 'dotenv/config';
import { provider } from './providers';

// Get the user prompt from command line arguments
const userPrompt = process.argv.slice(2).join(' ');
if (!userPrompt) {
  console.error('Usage: npx ts-node src/index.ts "your prompt"');
  process.exit(1);
}

// Main function to generate content
async function main() {
  if (!provider) {
    throw new Error('Provider is not available.');
  }
  const messages = [{ role: 'user' as const, content: userPrompt }];
  const response = await provider.chat(messages);
  console.log(response.text);
}

main();