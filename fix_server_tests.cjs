const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const files = execSync('find server -type f -name "*.test.ts"').toString().trim().split('\n');

for (const file of files) {
  if (!file || file.includes('__tests__')) continue;
  
  const content = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file); // e.g. "server/routes"
  
  // Replace imports
  const newContent = content.replace(/from\s+["'](\.[^"']+)["']/g, (match, p1) => {
    const absolutePath = path.resolve(dir, p1); // e.g. "/path/to/project/server/storageService.ts"
    const projectRoot = process.cwd();
    const relativeToRoot = path.relative(projectRoot, absolutePath); // e.g. "server/storageService.ts"
    return `from "@/${relativeToRoot}"`;
  });
  
  const newDir = path.join('server', '__tests__', path.relative('server', dir));
  fs.mkdirSync(newDir, { recursive: true });
  
  const newFile = path.join(newDir, path.basename(file));
  fs.writeFileSync(newFile, newContent, 'utf8');
  fs.unlinkSync(file);
  console.log(`Moved ${file} to ${newFile}`);
}
