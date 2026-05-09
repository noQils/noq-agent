import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { scanDirectory } from './scanner';
import { readFileIfExists } from './fileUtils';
import path from 'node:path';

// Load environment variables
dotenv.config();

// Ensure the API key is available
const apiKey = process.env.API_KEY;
if (!apiKey) {
  throw new Error('API_KEY is not defined in the environment variables.');
}

// Initialize the client and model
const client = new GoogleGenerativeAI(apiKey);
const model = client.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

// Get the user prompt from command line arguments
const prompt = process.argv.slice(2).join(' ');
if (!prompt) {
  console.error('Usage: npx ts-node src/index.ts "your prompt"');
  process.exit(1);
}

// Extract keywords from the prompt
function extractKeywords(prompt: string): string[] {
  const stopwords = new Set(['the','a','an','and','of','to','in','for','on','with','by','at','is','are','was','were','be','been','have','has','had','do','does','did','but','or','so','for','yet','where','what','how','why','which','who','located','function','defined','file','code','this','that','help']);
  const words = prompt.toLowerCase().split(/\s+/)
    .map(w => w.replace(/[^\w]/g, ''))
    .filter(w => w.length > 2 && !stopwords.has(w));
  return [...new Set(words)];
}

// Main function to generate content
async function main() {
    try {
        // Scan the current directory and build a file tree
        const absoluteFiles = scanDirectory(process.cwd());
        const fileTree = absoluteFiles.map(file => path.relative(process.cwd(), file));

        // Read the content of matching files based on keywords in the prompt
        const keywords = extractKeywords(prompt);
        const matchingFileContents = absoluteFiles.map(file => {
            const content = readFileIfExists(file)?.slice(0, 3000);
            const normalizedContent = content ? content.toLowerCase() : '';
            const matchesKeyword = keywords.some(keyword => normalizedContent.includes(keyword));
            return matchesKeyword ? `--- ${file} ---\n${content}\n` : null;
        }).filter(content => content !== null);

        // Prepare the prompt
        const promptText = `
You are a code assistant. Here is the file tree of a project:
${fileTree.join('\n')}

And here is the content of relevant files based on the user's prompt:
${matchingFileContents.join('\n')}

The user asks: "${prompt}"
`;
            
        // Generate content based on the prompt
        const result = await model.generateContent(promptText);
        const response = await result.response;
        const text = response.text();
        console.log(text);
    } catch (error) {
        console.error('Error generating content:', error);
    }
}

main();