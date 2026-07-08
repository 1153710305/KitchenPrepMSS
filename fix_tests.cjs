const fs = require('fs');
const path = require('path');
const glob = require('glob'); // Not available? I'll use child_process find
const { execSync } = require('child_process');

const files = execSync('find src -type f \\( -name "*.test.ts" -o -name "*.test.tsx" \\)').toString().trim().split('\n');

for (const file of files) {
  if (!file || file.includes('__tests__')) continue;
  
  const content = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file); // e.g. "src/components/ledger"
  
  // Replace imports
  const newContent = content.replace(/from\s+["'](\.[^"']+)["']/g, (match, p1) => {
    // p1 is the relative path, e.g. "./ledgerStore.ts" or "../../types/ledgerTypes.ts"
    const absolutePath = path.resolve(dir, p1); // e.g. "/path/to/project/src/services/ledgerStore.ts"
    const projectRoot = process.cwd();
    const relativeToRoot = path.relative(projectRoot, absolutePath); // e.g. "src/services/ledgerStore.ts"
    return `from "@/${relativeToRoot}"`;
  });
  
  const newDir = path.join('src', '__tests__', path.relative('src', dir));
  fs.mkdirSync(newDir, { recursive: true });
  
  const newFile = path.join(newDir, path.basename(file));
  fs.writeFileSync(newFile, newContent, 'utf8');
  fs.unlinkSync(file);
  console.log(`Moved ${file} to ${newFile}`);
}
