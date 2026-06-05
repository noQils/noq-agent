import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packagePaths = [
  path.join(rootDir, 'packages', 'noq-agent', 'package.json'),
  path.join(rootDir, 'packages', 'noq-agent-windows-x64', 'package.json'),
  path.join(rootDir, 'packages', 'noq-agent-darwin-arm64', 'package.json'),
  path.join(rootDir, 'packages', 'noq-agent-darwin-x64', 'package.json'),
  path.join(rootDir, 'packages', 'noq-agent-linux-x64', 'package.json'),
  path.join(rootDir, 'packages', 'noq-agent-linux-arm64', 'package.json'),
];

const rootPackageJsonPath = path.join(rootDir, 'package.json');
const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf8'));
const version = rootPackageJson.version;

for (const packageJsonPath of packagePaths) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.version = version;

  if (packageJson.optionalDependencies) {
    for (const dependencyName of Object.keys(packageJson.optionalDependencies)) {
      packageJson.optionalDependencies[dependencyName] = version;
    }
  }

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

console.log(`Synchronized wrapper and platform package versions to ${version}.`);
