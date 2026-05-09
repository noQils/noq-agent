import { readFileFunction, executeReadFile } from "./readFile";

// Define the tools available to the model
export const allTools = [{
    functionDeclarations: [readFileFunction]
}];

// Execute a tool based on its name
export async function executeTool(functionCall: any): Promise<string> {
    switch (functionCall.name) {
    case "read_file":
      const result = await executeReadFile(functionCall.args);
      return result ?? "";
    default:
      return `Error: Unknown tool ${functionCall.name}`;
  }
}