import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skippedDirectories = new Set([
    '.git', 'node_modules', 'sessions', 'backups', 'coverage'
]);

function collectJavaScriptFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (skippedDirectories.has(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...collectJavaScriptFiles(fullPath));
        else if (entry.isFile() && /\.(?:js|cjs|mjs)$/.test(entry.name)) files.push(fullPath);
    }
    return files;
}

const files = collectJavaScriptFiles(root).sort();
let failures = 0;

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
        cwd: root,
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        failures += 1;
        console.error(`\n[CHECK] ${path.relative(root, file)} failed:`);
        console.error(result.stderr || result.stdout);
    }
}

if (failures) {
    console.error(`\n[CHECK] ${failures} file(s) failed syntax validation.`);
    process.exit(1);
}

console.log(`[CHECK] ${files.length} JavaScript files passed syntax validation.`);
