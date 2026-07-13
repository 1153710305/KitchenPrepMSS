import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

walkDir('./src/__tests__', (filePath) => {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf-8');
    let original = content;

    // 1. Remove reports: ..., from useAppData mocks
    content = content.replace(/reports:\s*\[[\s\S]*?\],?/g, '');
    content = content.replace(/reports:\s*mockReports,?/g, '');
    content = content.replace(/reports\s*,\s*/g, '');
    
    // 2. Add ledgerItemsList={[]} to TableGrid
    content = content.replace(/<TableGrid([\s\S]*?)\/>/g, (match, p1) => {
      if (!p1.includes('ledgerItemsList')) {
        return `<TableGrid${p1} ledgerItemsList={[]} />`;
      }
      return match;
    });

    // 3. Remove PrepReportService.syncFromLedger
    content = content.replace(/PrepReportService\.syncFromLedger\([\s\S]*?\);/g, '');

    // 4. Remove PrepReportService.cascadeDeleteLedgerItem
    content = content.replace(/PrepReportService\.cascadeDeleteLedgerItem\([\s\S]*?\);/g, '');

    if (content !== original) {
      fs.writeFileSync(filePath, content);
      console.log(`Fixed ${filePath}`);
    }
  }
});
